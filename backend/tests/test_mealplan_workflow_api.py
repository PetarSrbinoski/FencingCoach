"""Public meal-plan and shopping endpoints for saved and failed plans."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile, NutritionPlan
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_shopping_uses_grams_from_nested_and_legacy_plans_and_reports_bad_day(client, db):
    start = date(2026, 9, 28)
    db.add_all(
        [
            NutritionPlan(
                day=start,
                targets={},
                plan={"plan": {"meals": [{"name": "Rice", "ingredients": [
                    {"name": "rice", "qty_g": 120}, {"name": "egg", "qty_g": 60}
                ]}]}},
            ),
            NutritionPlan(
                day=date(2026, 9, 29),
                targets={},
                plan={"meals": [{"name": "Rice again", "ingredients": [
                    {"name": "Rice", "qty_g": 80}
                ]}]},
            ),
            NutritionPlan(day=date(2026, 9, 30), targets={}, plan={"plan": {"meals": []}}),
        ]
    )
    db.commit()

    response = client.get("/shopping/range?start=2026-09-28&end=2026-09-30")
    assert response.status_code == 200
    result = response.json()
    assert result["days_covered"] == ["2026-09-28", "2026-09-29"]
    assert result["missing_days"] == ["2026-09-30"]
    assert {item["name"]: item["qty_g"] for item in result["items"]} == {
        "rice": 200, "egg": 60
    }


def test_failed_regeneration_preserves_saved_plan(client, db, monkeypatch):
    saved = {"plan": {"meals": [{"name": "Usable lunch"}]}}
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="performance"))
    db.add(NutritionPlan(day=date(2026, 9, 28), targets={}, plan=saved))
    db.commit()

    def fail(*args, **kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr("app.agents.mealplan.mealplan_agent.run_sync", fail)
    response = client.post("/mealplan/2026-09-28")
    assert response.status_code == 502
    assert "preserved" in response.json()["detail"]
    assert client.get("/mealplan/2026-09-28").json()["plan"] == saved
