"""Meal plan generation honors confirmed hard exclusions."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from app.agents.mealplan import MealPlanOutput
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


def test_prohibited_ingredient_keeps_previous_plan(client, db, monkeypatch):
    db.add(AthleteProfile(weight_kg=75, dietary_restrictions="no peanuts", food_budget="low",
                          food_preferences="quick meals"))
    old = {"plan": {"meals": [{"name": "Safe lunch"}]}}
    db.add(NutritionPlan(day=date(2026, 9, 28), plan=old, targets={}))
    db.commit()
    prompts = []

    def proposed(prompt, **kwargs):
        prompts.append(prompt)
        return SimpleNamespace(output=MealPlanOutput.model_validate({
            "meals": [{"slot": "lunch", "time": "12:00", "name": "Peanut bowl",
                       "ingredients": [{"name": "peanut butter", "qty_g": 30}]}],
        }))

    monkeypatch.setattr("app.agents.mealplan.mealplan_agent.run_sync", proposed)
    response = client.post("/mealplan/2026-09-28")
    assert response.status_code == 409
    assert "peanut" in response.json()["detail"].lower()
    assert client.get("/mealplan/2026-09-28").json()["plan"] == old
    assert any("quick meals" in prompt and "low" in prompt for prompt in prompts)


def test_ambiguous_restriction_requires_clarification(client, db):
    db.add(AthleteProfile(weight_kg=75, dietary_restrictions="avoid inflammatory foods"))
    db.commit()
    response = client.post("/mealplan/2026-09-28")
    assert response.status_code == 409
    assert "clarify" in response.json()["detail"].lower()


@pytest.mark.parametrize(("restriction", "ingredient"), [
    ("no peanuts", "Peanuts"), ("no eggs", "Eggs"), ("vegan", "Mussels"), ("vegetarian", "Oysters"),
])
def test_plural_ingredient_names_cannot_bypass_exclusions(client, db, monkeypatch, restriction, ingredient):
    db.add(AthleteProfile(weight_kg=75, dietary_restrictions=restriction))
    db.commit()

    def proposed(prompt, **kwargs):
        return SimpleNamespace(output=MealPlanOutput.model_validate({
            "meals": [{"slot": "lunch", "time": "12:00", "name": "Lunch",
                       "ingredients": [{"name": ingredient, "qty_g": 100}]}],
        }))

    monkeypatch.setattr("app.agents.mealplan.mealplan_agent.run_sync", proposed)
    response = client.post("/mealplan/2026-09-28")
    assert response.status_code == 409
    assert "conflicts" in response.json()["detail"]
    assert client.get("/mealplan/2026-09-28").json() is None
