"""Accepted targets survive reload, reject stale previews, and preserve diary history."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile, Competition
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_acceptance_is_explicit_idempotent_and_stale_safe(client, db, monkeypatch):
    today = date(2026, 7, 20)
    monkeypatch.setattr("app.services.competition_nutrition.athlete_today", lambda: today)
    monkeypatch.setattr("app.api.competition_nutrition.athlete_today", lambda: today)
    monkeypatch.setattr("app.services.targets.athlete_today", lambda: today)
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="performance"))
    event = Competition(name="Open", event_date=date(2026, 7, 25), priority="A")
    db.add(event)
    db.commit()
    db.refresh(event)
    request = {"expected_demand": "high", "event_format": "single_day"}
    preview = client.post(f"/competition-nutrition/preview/{event.id}", json=request).json()
    before = client.get("/targets/2026-07-25").json()
    assert before["target_source"] == "ordinary"
    acceptance = {"event_id": event.id, "inputs": request, "token": preview["token"],
                  "acceptance_id": "test-accept-1"}
    accepted = client.post("/competition-nutrition/accept", json=acceptance)
    assert accepted.status_code == 201
    assert client.post("/competition-nutrition/accept", json=acceptance).json()["id"] == accepted.json()["id"]
    current = client.get("/targets/2026-07-25").json()
    assert current["target_source"] == "accepted"
    assert current["plan_id"] == accepted.json()["id"]
    assert current["carbs_g"] == 525
    lookup = client.get("/competition-nutrition/targets?start=2026-07-25&end=2026-07-25").json()
    assert lookup["days"][0]["plan_url"] == f"/nutrition?competition={event.id}&plan={accepted.json()['id']}"
    assert client.post("/competition-nutrition/accept", json={**acceptance, "acceptance_id": "test-accept-2"}).status_code == 409


def test_changed_event_makes_preview_stale(client, db, monkeypatch):
    today = date(2026, 7, 20)
    monkeypatch.setattr("app.services.competition_nutrition.athlete_today", lambda: today)
    monkeypatch.setattr("app.api.competition_nutrition.athlete_today", lambda: today)
    db.add(AthleteProfile(weight_kg=75))
    event = Competition(name="Open", event_date=date(2026, 7, 25), priority="A")
    db.add(event)
    db.commit()
    db.refresh(event)
    inputs = {"expected_demand": "moderate", "event_format": "single_day"}
    draft = client.post(f"/competition-nutrition/preview/{event.id}", json=inputs).json()
    event.event_date = date(2026, 7, 26)
    db.commit()
    response = client.post("/competition-nutrition/accept", json={
        "event_id": event.id, "inputs": inputs, "token": draft["token"], "acceptance_id": "changed",
    })
    assert response.status_code == 409


def test_training_change_marks_saved_target_for_review(client, db, monkeypatch):
    today = date(2026, 7, 20)
    monkeypatch.setattr("app.services.competition_nutrition.athlete_today", lambda: today)
    monkeypatch.setattr("app.api.competition_nutrition.athlete_today", lambda: today)
    db.add(AthleteProfile(weight_kg=75))
    event = Competition(name="Open", event_date=date(2026, 7, 25), priority="A")
    db.add(event)
    db.commit()
    inputs = {"expected_demand": "high", "event_format": "single_day"}
    draft = client.post(f"/competition-nutrition/preview/{event.id}", json=inputs).json()
    client.post("/competition-nutrition/accept", json={
        "event_id": event.id, "inputs": inputs, "token": draft["token"], "acceptance_id": "training-snapshot",
    })
    day = "2026-07-23"
    assert client.get(f"/targets/{day}").json()["needs_review"] is False
    changed = client.put(f"/training/session/{day}/override", json={
        "session_name": "Custom", "exercises": [{"exercise": "Squat", "sets": 3, "reps": 5}],
    })
    assert changed.status_code == 200
    assert client.get(f"/targets/{day}").json()["needs_review"] is True
