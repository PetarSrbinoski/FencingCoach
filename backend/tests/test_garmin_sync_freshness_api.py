"""Sync completion and current-day readiness through public endpoints."""

from __future__ import annotations

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from app.models import GarminMetric
from app.services.garmin import GarminService
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_repeated_sync_exposes_new_completion_and_current_readiness(client, db, monkeypatch):
    day = date(2026, 9, 27)
    monkeypatch.setattr("app.services.readiness.athlete_today", lambda: day)
    row = GarminMetric(kind="training_readiness", day=day, value=35, status="ok")
    db.add(row)
    db.commit()

    class FakeGarmin:
        value = 75

        def sync_recent(self, session, days):
            row.value = self.value
            session.commit()
            return {"days_synced": days}

    fake = FakeGarmin()
    monkeypatch.setattr("app.api.garmin.get_garmin", lambda: fake)
    before = client.get("/garmin/status").json()
    first = client.post("/garmin/sync/recent?days=1")
    assert first.status_code == 200
    after = client.get("/garmin/status").json()
    assert after["last_sync_at"] != before["last_sync_at"]
    assert after["last_sync_ok"] is True
    assert client.get("/readiness/today").json()["band"] == "green"
    fake.value = 25
    client.post("/garmin/sync/recent?days=1")
    second = client.get("/garmin/status").json()
    assert second["last_sync_at"] != after["last_sync_at"]
    assert client.get("/readiness/today").json()["band"] == "red"


def test_endpoint_fetch_failure_is_reported_as_partial_sync(client, monkeypatch, tmp_path):
    class FakeClient:
        def __getattr__(self, name):
            def fetch(*args):
                if name == "get_training_readiness":
                    raise RuntimeError("readiness endpoint unavailable")
                return [] if name == "get_activities" else {}
            return fetch

    monkeypatch.setattr("app.services.garmin.settings.GARMIN_TOKEN_DIR", str(tmp_path))
    service = GarminService()
    monkeypatch.setattr(service, "_client_or_login", lambda: FakeClient())
    monkeypatch.setattr("app.api.garmin.get_garmin", lambda: service)
    result = client.post("/garmin/sync/recent?days=1")
    assert result.status_code == 200
    assert result.json()["outcome"] == "partial"
    assert result.json()["ok"] is False
    assert "training_readiness" in str(result.json()["fetched"]["fetch_failures"])
    assert client.get("/garmin/status").json()["last_sync_outcome"] == "partial"
