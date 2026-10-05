"""Migration compatibility against a disposable PostgreSQL database."""

import os
from concurrent.futures import ThreadPoolExecutor

from alembic import command
from alembic.config import Config
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

assert os.environ["DATABASE_URL"].endswith("/coach_memory_testing"), "Use the disposable migration runner"
config = Config("alembic.ini")
engine = create_engine(os.environ["DATABASE_URL"])
command.upgrade(config, "0014_workout_day_revisions")
with engine.begin() as connection:
    connection.execute(text("INSERT INTO athlete_profile (id, name, sport, level) VALUES (1, 'Migration athlete', 'fencing-epee', 'elite')"))
    connection.execute(text("INSERT INTO coach_conversations (id, title) VALUES (1, 'Previous conversation')"))
    connection.execute(text("INSERT INTO coach_messages (conversation_id, role, content) VALUES (1, 'user', 'Existing history')"))
    connection.execute(text("INSERT INTO agent_actions (kind, status, resource_id, summary) VALUES ('meal', 'committed', '1', 'Existing receipt')"))
command.upgrade(config, "head")
with engine.connect() as connection:
    assert connection.scalar(text("SELECT name FROM athlete_profile WHERE id=1")) == "Migration athlete"
    assert connection.scalar(text("SELECT content FROM coach_messages WHERE conversation_id=1")) == "Existing history"
    assert connection.scalar(text("SELECT count(*) FROM coach_memories")) == 0
    assert connection.scalar(text("SELECT summary FROM agent_actions WHERE id=1")) == "Existing receipt"

with TestClient(app) as client:
    response = client.post("/coach-memory", json={"content": "No squat rack", "request_id": "migration-check"})
    assert response.status_code == 200, response.text
    assert client.post("/coach-memory", json={"content": "No squat rack", "request_id": "migration-check"}).json()["id"] == response.json()["id"]
    receipt = client.get("/agent-actions?kind=memory").json()["items"][0]
    assert client.post(f"/agent-actions/{receipt['id']}/undo", json={"request_id": "undo"}).status_code == 200
    assert client.get("/coach-memory").json()["items"] == []
with TestClient(app) as client:
    def create_retry(_):
        return client.post("/coach-memory", json={"content": "Concurrent retry", "request_id": "parallel"})

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(create_retry, range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert len(client.get("/coach-memory").json()["items"]) == 1
    assert client.get("/agent-actions?kind=memory").json()["total"] == 2

with engine.begin() as connection:
    connection.execute(text("""CREATE FUNCTION reject_probe_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.summary LIKE '%rollback probe%' THEN RAISE EXCEPTION 'receipt rejected'; END IF;
        RETURN NEW; END $$"""))
    connection.execute(text("""CREATE TRIGGER reject_probe BEFORE INSERT ON agent_actions
        FOR EACH ROW EXECUTE FUNCTION reject_probe_receipt()"""))
with TestClient(app, raise_server_exceptions=False) as client:
    response = client.post("/coach-memory", json={"content": "rollback probe", "request_id": "rollback"})
    assert response.status_code == 500
    assert [item["content"] for item in client.get("/coach-memory").json()["items"]] == ["Concurrent retry"]
    assert client.get("/agent-actions?kind=memory").json()["total"] == 2
with engine.begin() as connection:
    connection.execute(text("DROP TRIGGER reject_probe ON agent_actions"))
    connection.execute(text("DROP FUNCTION reject_probe_receipt()"))
command.downgrade(config, "0014_workout_day_revisions")
assert "coach_memories" not in inspect(engine).get_table_names()
command.upgrade(config, "head")
print("Migration upgrade, existing data, API writes/undo, downgrade and re-upgrade passed.")
