import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from testing.backend.test_recipes import accept, food, recipe_input, review


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr("app.api.voice.SessionLocal", sessionmaker(bind=db.get_bind()))
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_voice_changes_only_rice_and_keeps_saved_recipe(client, monkeypatch):
    rice = food(client, "Rice", kcal=100, protein_g=2, carbs_g=20, fat_g=0)
    chicken = food(client, "Chicken", kcal=200, protein_g=30, carbs_g=0, fat_g=5)
    receipt = accept(client, review(client, recipe_input(rice, name="Chicken and rice", portions=1,
        ingredients=[{"food_id": rice["id"], "qty_g": 200, "basis": "cooked"},
                     {"food_id": chicken["id"], "qty_g": 100, "basis": "cooked"}]))).json()
    recipe = client.get(f"/nutrition/recipes/{receipt['resource_id']}").json()

    async def transcribe(*args):
        return "Lunch was chicken and rice, but half the rice"

    async def interpret(*args):
        return {"intent": "log_consumption", "recipe": {
            "recipe_id": recipe["id"], "expected_revision": recipe["revision"], "portions": 1,
        }, "ingredient_changes": [{"ingredient_index": 0, "multiplier": 0.5}]}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    started = client.post("/nutrition/voice", content=b"speech", headers={"Content-Type": "audio/webm"}).json()
    draft = client.get(f"/nutrition/voice/{started['id']}").json()
    assert draft["status"] == "done", draft
    assert draft["interpretation"]["preview"]["kcal"] == 300
    assert draft["interpretation"]["preview"]["protein_g"] == 32
    assert client.get("/nutrition/log?days=90").json() == []
    body = {"expected_revision": draft["revision"], "action": "log_consumption",
            "request_id": "variation", "day": "2026-10-05", "meal": "lunch"}
    result = client.post(f"/nutrition/voice/{draft['id']}/accept", json=body)
    assert result.status_code == 200, result.text
    assert client.post(f"/nutrition/voice/{draft['id']}/accept", json=body).json()["id"] == result.json()["id"]
    logged = client.get("/nutrition/log?days=90").json()[0]
    assert [item["qty_g"] for item in logged["micros"]["items"]] == [100, 100]
    assert client.get(f"/nutrition/recipes/{recipe['id']}").json() == recipe


def test_voice_historical_composition_uses_snapshot_and_stale_source_blocks_acceptance(client, monkeypatch):
    rice = food(client)
    saved = accept(client, review(client, recipe_input(rice))).json()
    recipe = client.get(f"/nutrition/recipes/{saved['resource_id']}").json()
    client.post(f"/nutrition/recipes/{recipe['id']}/log", json={"expected_revision": recipe["revision"],
        "portions": 1, "day": "2026-10-04", "meal": "dinner", "request_id": "original"}).json()
    source = client.get("/nutrition/log?day=2026-10-04").json()[0]
    client.put(f"/nutrition/foods/{rice['id']}", json={"name": "Rice", "kcal": 900})

    async def transcribe(*args):
        return "Half the rice from yesterday's dinner"

    async def interpret(*args):
        return {"intent": "log_consumption", "recipe": {"source_log_id": source["id"],
            "expected_source_version": source["version"], "portions": 1},
            "ingredient_changes": [{"ingredient_index": 0, "multiplier": 0.5}]}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    started = client.post("/nutrition/voice", content=b"speech", headers={"Content-Type": "audio/webm"}).json()
    draft = client.get(f"/nutrition/voice/{started['id']}").json()
    assert draft["interpretation"]["preview"]["kcal"] == 250
    client.delete(f"/nutrition/log/{source['id']}")
    result = client.post(f"/nutrition/voice/{draft['id']}/accept", json={"expected_revision": draft["revision"],
        "action": "log_consumption", "request_id": "stale-history", "day": "2026-10-05", "meal": "lunch"})
    assert result.status_code == 404
    assert client.get("/nutrition/log?day=2026-10-05").json() == []


def test_ambiguous_familiar_meal_stays_a_draft_until_source_is_selected(client, monkeypatch):
    rice = food(client)
    saved = accept(client, review(client, recipe_input(rice))).json()
    recipe = client.get(f"/nutrition/recipes/{saved['resource_id']}").json()

    async def transcribe(*args):
        return "My usual lunch"

    async def interpret(*args):
        return {"intent": "clarify", "question": "Which known meal and amount?"}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    started = client.post("/nutrition/voice", content=b"speech", headers={"Content-Type": "audio/webm"}).json()
    draft = client.get(f"/nutrition/voice/{started['id']}").json()
    corrected = client.put(f"/nutrition/voice/{draft['id']}/review", json={"expected_revision": draft["revision"],
        "interpretation": {"intent": "log_consumption", "recipe": {"recipe_id": recipe["id"],
            "expected_revision": recipe["revision"], "portions": 0.5}}})
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["interpretation"]["preview"]["kcal"] == 250
    assert client.get("/nutrition/log?day=2026-10-05").json() == []
