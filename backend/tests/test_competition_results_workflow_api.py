"""Results are validated and preserve historical fields through the API."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import Competition
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_result_edit_validation_and_clear_keep_event(client, db):
    event = Competition(name="Open", event_date=date(2026, 7, 21), priority="A",
                        result={"legacy_score": "12-10", "placing": 4})
    db.add(event)
    db.commit()
    db.refresh(event)
    bad = client.patch(f"/competitions/{event.id}/result", json={"placing": 9, "field_size": 8})
    assert bad.status_code == 422
    saved = client.patch(f"/competitions/{event.id}/result", json={
        "field_size": 64, "pool_wins": 4, "pool_losses": 1, "reflection": "Good footwork",
    })
    assert saved.status_code == 200
    assert saved.json()["result"]["legacy_score"] == "12-10"
    assert saved.json()["result"]["placing"] == 4
    assert saved.json()["result"]["pool_wins"] == 4
    assert client.delete(f"/competitions/{event.id}/result").status_code == 204
    assert client.get(f"/competitions/{event.id}").json()["result"] is None
