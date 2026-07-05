"""API-level tests for the nutrition estimate/log split (confirm-before-save).

`POST /nutrition/estimate` now returns `202` immediately and runs the LLM
call in a background task (see `app/api/nutrition.py`) — poll
`GET /nutrition/estimate/{id}` for the result.
"""

from __future__ import annotations

import pytest
from app.agents.nutrition import NutritionEstimateOutput, NutritionMicros
from app.core.database import get_db
from app.main import app
from app.models import NutritionLog
from fastapi.testclient import TestClient


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    # The background job opens its own `SessionLocal()` (see
    # api/nutrition.py) — in tests, point that at the same in-memory
    # session the `db` fixture uses instead of the real module-level
    # engine (which has no tables in the test environment).
    monkeypatch.setattr("app.api.nutrition.SessionLocal", lambda: db)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_estimate_accepted_then_poll_returns_result_without_persisting_log(client, db, monkeypatch):
    fake_estimate = NutritionEstimateOutput(
        kcal=650,
        protein_g=45,
        carbs_g=70,
        fat_g=18,
        fiber_g=8,
        micros=NutritionMicros(iron_mg=4),
        items=[],
        confidence="high",
        notes="test estimate",
    )

    async def fake(text, db=None):
        return fake_estimate

    monkeypatch.setattr("app.api.nutrition.estimate_nutrition", fake)

    res = client.post("/nutrition/estimate", json={"text": "200g chicken, rice"})
    assert res.status_code == 202
    estimate_id = res.json()["id"]
    assert res.json()["status"] == "pending"

    # TestClient runs FastAPI BackgroundTasks synchronously before
    # returning, so the job has already completed by this point.
    poll = client.get(f"/nutrition/estimate/{estimate_id}")
    assert poll.status_code == 200
    body = poll.json()
    assert body["status"] == "done"
    assert body["kcal"] == 650
    assert body["confidence"] == "high"

    # Nothing should be written to nutrition_log by /estimate — only
    # /nutrition/log (a separate, explicit confirm step) does that.
    assert db.query(NutritionLog).count() == 0


def test_estimate_failure_marks_estimate_as_error(client, monkeypatch):
    async def fail(text, db=None):
        raise RuntimeError("nutrition estimation failed: upstream timeout")

    monkeypatch.setattr("app.api.nutrition.estimate_nutrition", fail)

    res = client.post("/nutrition/estimate", json={"text": "something"})
    assert res.status_code == 202
    estimate_id = res.json()["id"]

    poll = client.get(f"/nutrition/estimate/{estimate_id}")
    body = poll.json()
    assert body["status"] == "error"
    assert "upstream timeout" in body["error"]


def test_get_estimate_404_for_unknown_id(client):
    res = client.get("/nutrition/estimate/999999")
    assert res.status_code == 404


def test_log_persists_reviewed_values_without_calling_llm(client, db, monkeypatch):
    # If /nutrition/log accidentally called the LLM, this would raise.
    async def boom(*a, **kw):
        raise AssertionError("log_meal must not call the LLM")

    monkeypatch.setattr("app.api.nutrition.estimate_nutrition", boom)

    res = client.post(
        "/nutrition/log",
        json={
            "raw_text": "200g chicken, rice",
            "meal": "lunch",
            "kcal": 620,  # user-edited down from an estimate
            "protein_g": 45,
            "carbs_g": 65,
            "fat_g": 15,
            "fiber_g": 6,
            "confidence": "high",
            "notes": "user-confirmed",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kcal"] == 620
    assert body["raw_text"] == "200g chicken, rice"

    row = db.query(NutritionLog).one()
    assert row.kcal == 620
    assert row.micros["confidence"] == "high"
    assert row.micros["notes"] == "user-confirmed"


def test_log_low_confidence_is_preserved_for_ui_flagging(client, db):
    res = client.post(
        "/nutrition/log",
        json={
            "raw_text": "mystery meal",
            "kcal": 400,
            "protein_g": 20,
            "carbs_g": 40,
            "fat_g": 10,
            "confidence": "low",
        },
    )
    assert res.status_code == 200
    row = db.query(NutritionLog).one()
    assert row.micros["confidence"] == "low"
