"""Diary behavior through the public API."""

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


def _log(client, day="2026-01-03"):
    response = client.post("/nutrition/log", json={
        "day": day, "meal": "lunch", "raw_text": "Rice bowl",
        "kcal": 500, "protein_g": 20, "carbs_g": 80, "fat_g": 10,
        "micros": {"iron_mg": 2}, "incomplete_micros": ["zinc_mg"],
        "items": [{"name": "Rice", "qty_g": 200, "nutrients": {"kcal": 260}}],
    })
    assert response.status_code == 200
    return response.json()


def test_selected_day_can_be_loaded_outside_recent_window(client):
    original = _log(client)
    result = client.get("/nutrition/log?day=2026-01-03")
    assert result.status_code == 200
    assert [entry["id"] for entry in result.json()] == [original["id"]]
    assert client.get("/nutrition/log?day=2026-01-04").json() == []


def test_edit_moves_entry_and_rejects_stale_version(client):
    original = _log(client)
    edit = {
        "expected_version": original["version"], "day": "2026-01-04",
        "meal": "dinner", "raw_text": "Larger rice bowl", "kcal": 600,
        "protein_g": 25, "carbs_g": 90, "fat_g": 12, "fiber_g": None,
    }
    result = client.put(f"/nutrition/log/{original['id']}", json=edit)
    assert result.status_code == 200
    assert result.json()["id"] == original["id"]
    assert result.json()["estimated_by"] == "manual"
    assert client.get("/nutrition/totals/2026-01-03").json()["entry_count"] == 0
    assert client.get("/nutrition/totals/2026-01-04").json()["kcal"] == 600
    assert client.put(f"/nutrition/log/{original['id']}", json=edit).status_code == 409
    assert result.json()["micros"]["incomplete_micros"] == ["zinc_mg"]


def test_repeat_scales_snapshot_once_per_request(client):
    original = _log(client)
    body = {"day": "2026-01-10", "meal": "snack", "multiplier": 1.5,
            "request_id": "test-repeat-1"}
    first = client.post(f"/nutrition/log/{original['id']}/repeat", json=body)
    assert first.status_code == 201
    assert first.json()["id"] != original["id"]
    assert first.json()["kcal"] == 750
    assert first.json()["micros"]["iron_mg"] == 3
    assert first.json()["micros"]["items"][0]["qty_g"] == 300
    again = client.post(f"/nutrition/log/{original['id']}/repeat", json=body)
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert client.get("/nutrition/totals/2026-01-10").json()["entry_count"] == 1
