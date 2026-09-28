"""Competition event ranges as training and nutrition days."""

from __future__ import annotations

import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_multiday_competition_precedes_gym_and_manual_work_remains_accessible(client):
    assert client.put("/profile", json={"weight_kg": 75}).status_code == 200
    created = client.post("/competitions", json={
        "name": "Open", "event_date": "2026-07-21", "end_date": "2026-07-23",
        "priority": "A", "location": "Skopje",
    })
    assert created.status_code == 201
    event_id = created.json()["id"]
    client.put("/training/session/2026-07-21/override", json={
        "session_name": "Light mobility", "exercises": [{"exercise": "Stretch", "sets": 2, "reps": 10}],
    })
    first = client.get("/training/session/2026-07-21").json()
    last = client.get("/training/session/2026-07-23").json()
    assert first["activity_type"] == "competition"
    assert first["competitions"][0]["id"] == event_id
    assert first["session"]["name"] == "Light mobility"
    assert last["activity_type"] == "competition"
    assert client.get("/targets/2026-07-23").json()["day_type"] == "competition"
    assert client.get("/targets/2026-07-23").json()["phase"] != "recovery"
    assert client.get("/targets/2026-07-24").json()["phase"] == "recovery"
    client.delete(f"/competitions/{event_id}")
    restored = client.get("/training/session/2026-07-21").json()
    assert restored["activity_type"] == "gym"
    assert restored["session"]["name"] == "Light mobility"


def test_reversed_event_dates_rejected(client):
    response = client.post("/competitions", json={
        "name": "Bad", "event_date": "2026-07-23", "end_date": "2026-07-21", "priority": "A",
    })
    assert response.status_code == 422
