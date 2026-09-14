"""Competition meals are reviewed against accepted targets before persistence."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile, Competition, NutritionLog, SavedFood
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def seed(client, db, monkeypatch):
    monkeypatch.setattr("app.api.competition_nutrition.athlete_today", lambda: date(2026, 7, 20))
    monkeypatch.setattr("app.services.competition_nutrition.athlete_today", lambda: date(2026, 7, 20))
    db.add(AthleteProfile(weight_kg=75, dietary_restrictions="no peanuts", food_preferences="rice"))
    event = Competition(name="Cup", event_date=date(2026, 7, 25), priority="A")
    db.add(event)
    db.commit()
    db.refresh(event)
    foods = [
        ("Rice", 360, 7, 80, 1), ("Eggs", 150, 13, 1, 11),
        ("Banana", 90, 1, 23, 0), ("Yogurt", 70, 6, 5, 3),
    ]
    for name, kcal, protein, carbs, fat in foods:
        db.add(SavedFood(name=name, name_key=name.casefold(), kcal=kcal,
                         protein_g=protein, carbs_g=carbs, fat_g=fat, micros=[]))
    db.commit()
    inputs = {"expected_demand": "high", "event_format": "single_day", "start_time": "09:00"}
    preview = client.post(f"/competition-nutrition/preview/{event.id}", json=inputs).json()
    accepted = client.post("/competition-nutrition/accept", json={
        "event_id": event.id, "inputs": inputs, "token": preview["token"], "acceptance_id": "target-1",
    }).json()
    return accepted


def test_draft_uses_ingredient_sources_and_accepts_without_logging(client, db, monkeypatch):
    plan = seed(client, db, monkeypatch)
    body = {"start": "2026-07-24", "end": "2026-07-25", "start_time": "09:00", "break_times": ["12:00"]}
    response = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=body)
    assert response.status_code == 200, response.text
    draft = response.json()
    assert len(draft["days"]) == 2
    event = draft["days"][1]
    assert {meal["slot"] for meal in event["meals"]} >= {"before_event", "event_break", "after_event"}
    assert all(ingredient["source"] == "saved" for meal in event["meals"] for ingredient in meal["ingredients"])
    assert event["totals"]["kcal"] == pytest.approx(sum(meal["totals"]["kcal"] for meal in event["meals"]))
    assert event["target_version"] == plan["version"]
    assert db.query(NutritionLog).count() == 0
    saved = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/accept", json={
        "inputs": body, "token": draft["token"], "acceptance_id": "meals-1",
    })
    assert saved.status_code == 201, saved.text
    assert len(saved.json()) == 2
    assert client.post(f"/competition-nutrition/plans/{plan['id']}/meals/accept", json={
        "inputs": body, "token": draft["token"], "acceptance_id": "meals-1",
    }).status_code == 201
    assert db.query(NutritionLog).count() == 0


def test_changed_food_stales_draft_and_replacement_preserves_other_slots(client, db, monkeypatch):
    plan = seed(client, db, monkeypatch)
    body = {"start": "2026-07-25", "end": "2026-07-25", "start_time": "09:00"}
    draft = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=body).json()
    rice = db.query(SavedFood).filter_by(name="Rice").one()
    rice.kcal = 350
    db.commit()
    assert client.post(f"/competition-nutrition/plans/{plan['id']}/meals/accept", json={
        "inputs": body, "token": draft["token"], "acceptance_id": "stale",
    }).status_code == 409
    fresh = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=body).json()
    accepted = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/accept", json={
        "inputs": body, "token": fresh["token"], "acceptance_id": "fresh",
    }).json()[0]
    replacement_input = {**body, "replace_slot": "event_break"}
    replacement = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=replacement_input).json()
    assert replacement["days"][0]["meals"][0] == accepted["meals"][0]
    response = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/accept", json={
        "inputs": replacement_input, "token": replacement["token"], "acceptance_id": "replace",
    })
    assert response.status_code == 201
    history = client.get(f"/competition-nutrition/plans/{plan['id']}/meals").json()
    assert len(history) == 2 and sum(item["active"] for item in history) == 1


def test_preparation_time_constraint_needs_known_food_times(client, db, monkeypatch):
    plan = seed(client, db, monkeypatch)
    body = {"start": "2026-07-25", "end": "2026-07-25", "prep_limit_minutes": 10}
    blocked = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=body)
    assert blocked.status_code == 409
    assert "preparation" in blocked.json()["detail"].lower()
    for food in db.query(SavedFood).all():
        food.prep_time_min = 5
    db.commit()
    allowed = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json=body)
    assert allowed.status_code == 200
    assert allowed.json()["days"][0]["meals"]


def test_single_meal_replacement_rejects_changed_break_layout(client, db, monkeypatch):
    plan = seed(client, db, monkeypatch)
    url = f"/competition-nutrition/plans/{plan['id']}/meals"
    body = {"start": "2026-07-25", "end": "2026-07-25", "break_times": ["12:00"]}
    draft = client.post(f"{url}/preview", json=body).json()
    accepted = client.post(f"{url}/accept", json={
        "inputs": body, "token": draft["token"], "acceptance_id": "original",
    }).json()[0]
    response = client.post(f"{url}/preview", json={
        **body, "break_times": ["12:00", "15:00"], "replace_slot": "event_break",
    })
    assert response.status_code == 409
    assert "regenerate" in response.json()["detail"].lower()
    history = client.get(url).json()
    assert history[0]["id"] == accepted["id"] and history[0]["active"]


def test_meal_choices_use_soft_preferences_with_available_alternatives(client, db, monkeypatch):
    plan = seed(client, db, monkeypatch)
    assert client.put("/profile", json={
        "weight_kg": 75, "food_preferences": "prefer rice; dislike eggs", "food_budget": "low",
    }).status_code == 200
    response = client.post(f"/competition-nutrition/plans/{plan['id']}/meals/preview", json={
        "start": "2026-07-24", "end": "2026-07-24",
    })
    assert response.status_code == 200
    day = response.json()["days"][0]
    names = {ingredient["name"] for meal in day["meals"] for ingredient in meal["ingredients"]}
    assert "Rice" in names and "Eggs" not in names
    assert any("preferences" in warning.casefold() for warning in day["warnings"])
