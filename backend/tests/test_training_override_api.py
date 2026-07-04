"""API-level tests for manual workout-session overrides.

Covers `PUT/DELETE /training/session/{day}/override` and the
`build_session()` precedence logic that backs them.
"""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import WorkoutOverride
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_set_override_replaces_session_for_day(client, db):
    day = date(2026, 7, 21).isoformat()  # Tuesday (normally strength_unilateral)
    res = client.put(
        f"/training/session/{day}/override",
        json={
            "session_name": "custom power day",
            "exercises": [{"exercise": "Snatch", "sets": 5, "reps": 2, "load_kg": 60}],
            "notes": "Requested via chat",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "manual"
    assert body["session"]["name"] == "custom power day"
    assert body["session"]["exercises"][0]["exercise"] == "Snatch"

    row = db.get(WorkoutOverride, date.fromisoformat(day))
    assert row is not None
    assert row.exercises[0]["exercise"] == "Snatch"


def test_set_override_on_normally_rest_day(client):
    day = date(2026, 7, 20).isoformat()  # Monday — not a gym day by default
    res = client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Bench Press", "sets": 3, "reps": 8}]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "manual"
    assert body["session"]["exercises"][0]["exercise"] == "Bench Press"


def test_clear_override_reverts_to_auto(client, db):
    day = date(2026, 7, 21).isoformat()
    client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Snatch", "sets": 5, "reps": 2}]},
    )
    res = client.delete(f"/training/session/{day}/override")
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "auto"
    assert body["session"]["exercises"][0]["exercise"] != "Snatch"

    assert db.get(WorkoutOverride, date.fromisoformat(day)) is None


def test_session_for_day_reflects_override(client):
    day = date(2026, 7, 22).isoformat()
    client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Push Press", "sets": 4, "reps": 4}]},
    )
    res = client.get(f"/training/session/{day}")
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "manual"
    assert body["session"]["exercises"][0]["exercise"] == "Push Press"


def test_put_with_empty_exercises_clears_override_instead_of_persisting(client, db):
    """Mirrors the coach chat tool's `update_day_workout` behavior: an
    empty `exercises` list means "revert to auto", not "persist a
    zero-exercise manual session" (see agents/coach.py)."""
    day = date(2026, 7, 23).isoformat()
    client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Snatch", "sets": 5, "reps": 2}]},
    )
    assert db.get(WorkoutOverride, date.fromisoformat(day)) is not None

    res = client.put(f"/training/session/{day}/override", json={"exercises": []})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "auto"
    assert db.get(WorkoutOverride, date.fromisoformat(day)) is None


def test_repeat_put_bumps_updated_at(client, db):
    day = date(2026, 7, 24).isoformat()
    client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Snatch", "sets": 5, "reps": 2}]},
    )
    row = db.get(WorkoutOverride, date.fromisoformat(day))
    first_updated_at = row.updated_at

    client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Clean", "sets": 4, "reps": 3}]},
    )
    db.refresh(row)
    assert row.updated_at >= first_updated_at
    assert row.exercises[0]["exercise"] == "Clean"


def test_invalid_exercise_fields_rejected(client):
    day = date(2026, 7, 25).isoformat()
    res = client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Snatch", "sets": -1, "reps": 2}]},
    )
    assert res.status_code == 422

    res = client.put(
        f"/training/session/{day}/override",
        json={"exercises": [{"exercise": "Snatch", "sets": 3, "reps": 2, "intent": "bogus"}]},
    )
    assert res.status_code == 422
