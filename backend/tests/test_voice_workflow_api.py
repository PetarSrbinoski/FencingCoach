"""Voice drafts through the public nutrition API; external speech and text providers are controlled."""

import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr("app.api.voice.SessionLocal", sessionmaker(bind=db.get_bind()))
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_reviewed_dictated_serving_saves_without_logging(client, monkeypatch):
    async def transcribe(data, filename):
        return "Save yogurt pot, 150 grams, 90 calories, 6 grams protein, 12 grams carbs, 2 grams fat"

    async def interpret(transcript, catalog):
        return {
            "intent": "save_food", "question": None, "food": {
                "name": "Yogurt pot", "basis": "per_serving", "basis_grams": 150,
                "serving_name": "pot", "serving_size_g": 150,
                "kcal": 90, "protein_g": 6, "carbs_g": 12, "fat_g": 2,
                "fiber_g": None, "micros": [],
            }, "portions": [], "other_foods": "",
        }

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    created = client.post("/nutrition/voice", content=b"recorded speech", headers={
        "Content-Type": "audio/webm", "X-Audio-Filename": "meal.webm",
    })
    assert created.status_code == 202, created.text
    draft = client.get(f"/nutrition/voice/{created.json()['id']}").json()
    assert draft["status"] == "done"
    assert draft["transcript"].startswith("Save yogurt")
    assert draft["interpretation"]["food"]["fiber_g"] is None
    accepted = client.post(f"/nutrition/voice/{draft['id']}/accept", json={
        "expected_revision": draft["revision"], "action": "save_food",
        "request_id": "voice-save-1",
    })
    assert accepted.status_code == 200, accepted.text
    food = client.get("/nutrition/foods").json()[0]
    assert food["kcal"] == 60
    assert food["protein_g"] == 4
    assert food["carbs_g"] == 8
    assert food["fat_g"] == pytest.approx(4 / 3)
    assert food["fiber_g"] is None
    assert client.get("/nutrition/log").json() == []
    assert client.post(f"/nutrition/voice/{draft['id']}/accept", json={
        "expected_revision": draft["revision"], "action": "save_food",
        "request_id": "voice-save-1",
    }).json()["resource_id"] == food["id"]
    assert client.get("/agent-actions?kind=food_create").json()["total"] == 1


def test_correction_reinterprets_saved_food_and_log_has_guarded_undo(client, monkeypatch):
    saved = client.post("/nutrition/foods", json={
        "name": "Rice", "kcal": 130, "protein_g": 2.7, "carbs_g": 28,
        "fat_g": 0.3, "fiber_g": None,
    }).json()
    async def transcribe(data, filename):
        return "Lunch was 200 grams of ice"

    async def interpret(transcript, catalog):
        if "rice" not in transcript.lower():
            return {"intent": "clarify", "question": "Which food did you mean?"}
        assert catalog[0]["id"] == saved["id"]
        return {"intent": "log_consumption", "portions": [{"food_id": saved["id"], "grams": 200}]}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    created = client.post("/nutrition/voice", content=b"audio", headers={"Content-Type": "audio/webm"})
    first = client.get(f"/nutrition/voice/{created.json()['id']}").json()
    assert first["interpretation"]["intent"] == "clarify"
    assert client.post(f"/nutrition/voice/{first['id']}/accept", json={
        "expected_revision": first["revision"], "action": "log_consumption", "request_id": "wrong",
        "day": "2026-10-01", "meal": "lunch",
    }).status_code == 422
    corrected = client.put(f"/nutrition/voice/{first['id']}/transcript", json={
        "expected_revision": first["revision"], "transcript": "Lunch was 200 grams of rice",
    })
    assert corrected.status_code == 202
    second = client.get(f"/nutrition/voice/{first['id']}").json()
    assert second["revision"] != first["revision"]
    assert second["interpretation"]["preview"]["kcal"] == 260
    assert client.post(f"/nutrition/voice/{first['id']}/accept", json={
        "expected_revision": first["revision"], "action": "log_consumption", "request_id": "stale",
        "day": "2026-10-01", "meal": "lunch",
    }).status_code == 409
    body = {"expected_revision": second["revision"], "action": "log_consumption",
            "request_id": "log-1", "day": "2026-10-01", "meal": "lunch"}
    receipt = client.post(f"/nutrition/voice/{first['id']}/accept", json=body)
    assert receipt.status_code == 200, receipt.text
    assert client.post(f"/nutrition/voice/{first['id']}/accept", json=body).json()["id"] == receipt.json()["id"]
    logs = client.get("/nutrition/log?day=2026-10-01").json()
    assert len(logs) == 1
    assert logs[0]["kcal"] == 260
    assert logs[0]["fiber_g"] is None
    assert logs[0]["micros"]["items"][0]["food_id"] == saved["id"]
    assert client.post(f"/agent-actions/{receipt.json()['id']}/undo", json={
        "request_id": "undo-voice",
    }).status_code == 200
    assert client.get("/nutrition/log?day=2026-10-01").json() == []


def test_invalid_audio_and_cancelled_draft_do_not_write(client, monkeypatch):
    assert client.post("/nutrition/voice", content=b"image", headers={
        "Content-Type": "image/png",
    }).status_code == 415
    async def transcribe(data, filename):
        raise RuntimeError("Provider unavailable")
    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    created = client.post("/nutrition/voice", content=b"audio", headers={"Content-Type": "audio/webm"})
    row = client.get(f"/nutrition/voice/{created.json()['id']}").json()
    assert row["status"] == "error"
    assert "Provider unavailable" in row["error"]
    assert client.post(f"/nutrition/voice/{row['id']}/cancel").json()["status"] == "cancelled"
    assert client.post(f"/nutrition/voice/{row['id']}/accept", json={
        "expected_revision": row["revision"], "action": "save_food", "request_id": "cancelled",
    }).status_code == 409
    assert client.get("/nutrition/foods").json() == []
    assert client.get("/nutrition/log").json() == []


def test_review_edits_are_recalculated_and_source_changes_require_renewed_review(client, monkeypatch):
    saved = client.post("/nutrition/foods", json={
        "name": "Milk", "kcal": 60, "protein_g": 3, "carbs_g": 5, "fat_g": 3,
    }).json()

    async def transcribe(data, filename):
        return "I drank 100 grams of milk"

    async def interpret(transcript, catalog):
        return {"intent": "log_consumption", "portions": [{"food_id": saved["id"], "grams": 100}]}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    created = client.post("/nutrition/voice", content=b"audio", headers={"Content-Type": "audio/webm"})
    original = client.get(f"/nutrition/voice/{created.json()['id']}").json()
    edited = {"intent": "log_consumption", "portions": [{"food_id": saved["id"], "grams": 250}]}
    reviewed = client.put(f"/nutrition/voice/{original['id']}/review", json={
        "expected_revision": original["revision"], "interpretation": edited,
    }).json()
    assert reviewed["interpretation"]["preview"]["kcal"] == 150
    assert client.post(f"/nutrition/voice/{original['id']}/accept", json={
        "expected_revision": original["revision"], "action": "log_consumption",
        "request_id": "old", "day": "2026-10-01", "meal": "snack",
    }).status_code == 409
    changed = client.put(f"/nutrition/foods/{saved['id']}", json={
        "name": "Milk", "kcal": 70, "protein_g": 3, "carbs_g": 5, "fat_g": 3,
    })
    assert changed.status_code == 200
    assert client.post(f"/nutrition/voice/{original['id']}/accept", json={
        "expected_revision": reviewed["revision"], "action": "log_consumption",
        "request_id": "stale-food", "day": "2026-10-01", "meal": "snack",
    }).status_code == 409
    assert client.get("/nutrition/log?day=2026-10-01").json() == []


def test_duplicate_dictated_food_requires_a_distinct_name(client, monkeypatch):
    client.post("/nutrition/foods", json={"name": "Yogurt", "kcal": 70})

    async def transcribe(data, filename):
        return "Save yogurt, 90 calories per 100 grams"

    async def interpret(transcript, catalog):
        return {"intent": "save_food", "food": {"name": "Yogurt", "basis": "per_100g",
                "kcal": 90, "protein_g": None, "carbs_g": 0, "fat_g": None, "fiber_g": None}}

    monkeypatch.setattr("app.api.voice.transcribe_audio", transcribe)
    monkeypatch.setattr("app.api.voice.interpret_voice", interpret)
    created = client.post("/nutrition/voice", content=b"audio", headers={"Content-Type": "audio/webm"})
    draft = client.get(f"/nutrition/voice/{created.json()['id']}").json()
    duplicate = client.post(f"/nutrition/voice/{draft['id']}/accept", json={
        "expected_revision": draft["revision"], "action": "save_food", "request_id": "duplicate",
    })
    assert duplicate.status_code == 409
    assert len(client.get("/nutrition/foods").json()) == 1
    assert client.get("/agent-actions?kind=food_create").json()["total"] == 0
