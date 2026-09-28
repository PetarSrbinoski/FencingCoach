"""The coach's date-range lookup matches the shared effective target resolver."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_range_lookup_matches_daily_endpoint_without_writing(client, db):
    db.add(AthleteProfile(weight_kg=75, body_comp_goal="performance"))
    db.commit()
    response = client.get("/competition-nutrition/targets?start=2026-07-23&end=2026-07-25")
    assert response.status_code == 200
    rows = response.json()["days"]
    assert len(rows) == 3
    assert rows[0]["day"] == date(2026, 7, 23).isoformat()
    assert rows[0]["kcal"] == client.get("/targets/2026-07-23").json()["kcal"]
    assert rows[0]["target_source"] == "ordinary"
    assert rows[0]["diary_url"] == "/nutrition?day=2026-07-23"
    assert client.get("/competition-nutrition/plans").json() == []


def test_range_lookup_is_bounded(client, db):
    db.add(AthleteProfile(weight_kg=75))
    db.commit()
    assert client.get("/competition-nutrition/targets?start=2026-07-01&end=2026-08-01").status_code == 422
