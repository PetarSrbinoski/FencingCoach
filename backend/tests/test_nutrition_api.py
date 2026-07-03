"""API-level tests for the nutrition estimate/log split (confirm-before-save)."""

from __future__ import annotations

import pytest
from app.agents.nutrition import NutritionEstimateOutput, NutritionMicros
from app.core.database import get_db
from app.main import app
from app.models import NutritionLog
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_estimate_does_not_persist_anything(client, db, monkeypatch):
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
    monkeypatch.setattr(
        "app.api.nutrition.estimate_nutrition", lambda text, db=None: fake_estimate
    )

    res = client.post("/nutrition/estimate", json={"text": "200g chicken, rice"})
    assert res.status_code == 200
    body = res.json()
    assert body["kcal"] == 650
    assert body["confidence"] == "high"

    # Nothing should be written to the DB by /estimate
    assert db.query(NutritionLog).count() == 0


def test_estimate_failure_returns_502_not_zeros(client, monkeypatch):
    def fail(text, db=None):
        raise RuntimeError("nutrition estimation failed: upstream timeout")

    monkeypatch.setattr("app.api.nutrition.estimate_nutrition", fail)

    res = client.post("/nutrition/estimate", json={"text": "something"})
    assert res.status_code == 502
    assert "upstream timeout" in res.json()["detail"]


def test_log_persists_reviewed_values_without_calling_llm(client, db, monkeypatch):
    # If /nutrition/log accidentally called the LLM, this would raise.
    def boom(*a, **kw):
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
