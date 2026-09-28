"""Read-only competition nutrition preview through the public API."""

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


def test_preview_includes_rest_preparation_and_all_event_days(client, db):
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="performance"))
    event = Competition(name="Open", event_date=date(2026, 7, 25),
                        end_date=date(2026, 7, 26), priority="B")
    db.add(event)
    db.commit()
    db.refresh(event)
    response = client.post(f"/competition-nutrition/preview/{event.id}", json={
        "expected_demand": "high", "event_format": "multi_day",
    })
    assert response.status_code == 200
    days = response.json()["days"]
    assert len(days) == 10
    assert days[0]["day"] == "2026-07-18"
    assert days[-1]["day"] == "2026-07-27"
    assert days[5]["context"] == "preparation"
    assert days[5]["training_type"] != "competition"
    assert [day["context"] for day in days[7:9]] == ["event", "event"]
    assert days[7]["carbs_g"] == 525
    assert response.json()["policy_version"] == "competition-2026-09-v1"


def test_preview_requires_overlap_choice(client, db):
    db.add(AthleteProfile(weight_kg=75))
    db.add_all([
        Competition(name="First", event_date=date(2026, 7, 25), priority="A"),
        Competition(name="Second", event_date=date(2026, 7, 24), priority="C"),
    ])
    db.commit()
    response = client.post("/competition-nutrition/preview/1", json={
        "expected_demand": "moderate", "event_format": "single_day",
    })
    assert response.status_code == 409
    accepted = client.post("/competition-nutrition/preview/1", json={
        "expected_demand": "moderate", "event_format": "single_day", "resolve_overlaps": True,
    })
    assert accepted.status_code == 200
    assert accepted.json()["competing_events"]
