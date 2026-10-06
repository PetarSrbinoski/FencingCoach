import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from app.core.database import Base, get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from testing.backend.test_recipes import food, recipe_input, review


@pytest.fixture
def pg_client():
    url = os.environ.get("TEST_RECIPE_DATABASE_URL")
    if not url:
        pytest.skip("Run testing/scripts/run_future_ai_checks.sh for isolated PostgreSQL acceptance.")
    if "/coachapp_testing" not in url or "coach_test:" not in url or "127.0.0.1:15439/" not in url:
        pytest.fail("Refusing a database outside the disposable recipe test stack.")
    engine = create_engine(url)
    with engine.begin() as connection:
        tables = ", ".join(engine.dialect.identifier_preparer.quote(table.name) for table in Base.metadata.sorted_tables)
        connection.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
    sessions = sessionmaker(bind=engine)

    def database():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = database
    try:
        yield TestClient(app, raise_server_exceptions=False), engine
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def concurrent(operation):
    gate = Barrier(2)

    def run(_):
        gate.wait(timeout=10)
        return operation()

    with ThreadPoolExecutor(max_workers=2) as workers:
        return list(workers.map(run, range(2)))


def test_concurrent_recipe_acceptance_and_portion_logging_commit_once(pg_client):
    client, _ = pg_client
    product = food(client)
    draft = review(client, recipe_input(product))
    body = {"expected_revision": draft["revision"], "request_id": "concurrent-save"}
    replies = concurrent(lambda: client.post(f"/nutrition/recipes/drafts/{draft['id']}/accept", json=body))
    assert [response.status_code for response in replies] == [200, 200]
    assert replies[0].json()["id"] == replies[1].json()["id"]
    assert len(client.get("/nutrition/recipes").json()) == 1
    assert client.get("/agent-actions?kind=recipe").json()["total"] == 1
    recipe = client.get("/nutrition/recipes").json()[0]
    log = {"expected_revision": recipe["revision"], "request_id": "concurrent-log", "portions": 0.5,
           "day": "2026-10-05", "meal": "lunch"}
    replies = concurrent(lambda: client.post(f"/nutrition/recipes/{recipe['id']}/log", json=log))
    assert [response.status_code for response in replies] == [200, 200]
    assert replies[0].json()["id"] == replies[1].json()["id"]
    assert len(client.get("/nutrition/log?days=90").json()) == 1
    assert client.get("/agent-actions?kind=meal").json()["total"] == 1


def test_receipt_failure_rolls_back_recipe_resource(pg_client):
    client, engine = pg_client
    draft = review(client, recipe_input(food(client)))
    with engine.begin() as connection:
        connection.execute(text("""CREATE FUNCTION fail_recipe_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.kind = 'recipe' THEN RAISE EXCEPTION 'controlled receipt failure'; END IF; RETURN NEW; END $$"""))
        connection.execute(text("CREATE TRIGGER reject_recipe_receipt BEFORE INSERT ON agent_actions FOR EACH ROW EXECUTE FUNCTION fail_recipe_receipt()"))
    try:
        result = client.post(f"/nutrition/recipes/drafts/{draft['id']}/accept", json={"expected_revision": draft["revision"], "request_id": "atomic"})
        assert result.status_code == 500
        assert client.get("/nutrition/recipes").json() == []
        assert client.get("/agent-actions?kind=recipe").json()["total"] == 0
        assert client.get(f"/nutrition/recipes/drafts/{draft['id']}").json()["accepted_actions"] == {}
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP TRIGGER reject_recipe_receipt ON agent_actions"))
            connection.execute(text("DROP FUNCTION fail_recipe_receipt()"))


def test_concurrent_suggestion_acceptance_logs_once(pg_client, monkeypatch):
    client, engine = pg_client
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr("app.services.meal_suggestions.SessionLocal", sessions)
    client.put("/profile", json={"weight_kg": 70})
    product = food(client)

    async def generate(*args):
        return {"options": [recipe_input(product, name="Rice option", portions=1, prep_time_min=5)]}

    monkeypatch.setattr("app.services.meal_suggestions.generate_options", generate)
    started = client.post("/nutrition/suggestions", json={"day": "2026-10-05", "available_foods": ["Rice"], "prep_limit_min": 10}).json()
    draft = client.get(f"/nutrition/suggestions/{started['id']}").json()
    assert draft["status"] == "done", draft
    body = {"expected_revision": draft["revision"], "option_index": 0, "action": "log_consumption",
            "meal": "lunch", "request_id": "concurrent-option"}
    replies = concurrent(lambda: client.post(f"/nutrition/suggestions/{draft['id']}/accept", json=body))
    assert [response.status_code for response in replies] == [200, 200]
    assert replies[0].json()["id"] == replies[1].json()["id"]
    assert len(client.get("/nutrition/log?days=90").json()) == 1
    assert client.get("/agent-actions?kind=meal").json()["total"] == 1
