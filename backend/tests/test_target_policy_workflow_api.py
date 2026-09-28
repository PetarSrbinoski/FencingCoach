"""Profile-based target policy exposed by the targets API."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile, GarminMetric
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_missing_weight_requires_profile_without_hiding_diary(client):
    response = client.get("/targets/2026-09-28")
    assert response.status_code == 409
    assert "weight" in response.json()["detail"].lower()
    assert client.get("/nutrition/log?day=2026-09-28").status_code == 200


@pytest.mark.parametrize("goal,expected", [
    ("performance", "performance"), ("maintain", "maintain"),
    ("cutting", "cutting"), ("lean", "cutting"),
    ("lean_bulk", "lean_bulk"), ("gain", "lean_bulk"),
    ("recomp", "recomp"),
])
def test_goals_are_explicit_and_energy_reconciles(client, db, goal, expected):
    db.add(AthleteProfile(weight_kg=75, body_comp_goal=goal))
    db.commit()
    response = client.get("/targets/2026-09-28")
    assert response.status_code == 200
    target = response.json()
    assert target["goal"] == expected
    assert target["policy_version"]
    assert target["kcal"] == round(4 * target["protein_g"] + 4 * target["carbs_g"] + 9 * target["fat_g"])


def test_future_target_uses_available_garmin_baseline(client, db, monkeypatch):
    today = date(2026, 9, 27)
    monkeypatch.setattr("app.services.targets.athlete_today", lambda: today)
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="maintain"))
    for i in range(1, 8):
        db.add(GarminMetric(kind="calories", day=today - timedelta(days=i), value=3000, status="ok"))
    db.commit()
    target = client.get("/targets/2026-10-10").json()
    assert target["data_cutoff"] == "2026-09-26"
    assert target["baseline_source"] == "garmin"
    assert target["baseline_kcal"] == 3000


def test_unknown_goal_is_explicit_error(client, db):
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="mystery"))
    db.commit()
    response = client.get("/targets/2026-09-28")
    assert response.status_code == 409
    assert "goal" in response.json()["detail"].lower()
