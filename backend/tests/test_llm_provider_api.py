"""API-level tests for the manual LLM provider toggle (local vs cloud).

Covers `GET/PUT /settings/llm-provider`, `services/llm_provider.py`
persistence, and that `agents.deps.get_active_provider()` reflects a `PUT`
immediately (no restart needed).
"""

from __future__ import annotations

import pytest
from app.agents.deps import get_active_provider, set_active_provider
from app.core.database import get_db
from app.main import app
from app.models import AppSetting
from app.services.llm_provider import DEFAULT_PROVIDER, get_llm_provider, set_llm_provider
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _reset_active_provider():
    """Don't let one test's toggle leak into another via the module-level
    in-process cache in agents.deps."""
    set_active_provider(DEFAULT_PROVIDER)
    yield
    set_active_provider(DEFAULT_PROVIDER)


def test_get_llm_provider_defaults_to_local(db):
    assert get_llm_provider(db) == "local"


def test_set_llm_provider_persists_and_round_trips(db):
    set_llm_provider(db, "cloud")
    assert get_llm_provider(db) == "cloud"

    row = db.get(AppSetting, "llm_provider")
    assert row is not None
    assert row.value == "cloud"


def test_set_llm_provider_rejects_invalid_value(db):
    with pytest.raises(ValueError):
        set_llm_provider(db, "bogus")


def test_set_llm_provider_upserts_on_repeat_call(db):
    set_llm_provider(db, "cloud")
    set_llm_provider(db, "local")
    assert get_llm_provider(db) == "local"
    # Still exactly one row for the key, not a duplicate.
    assert db.get(AppSetting, "llm_provider").value == "local"


def test_get_endpoint_returns_active_provider(client):
    res = client.get("/settings/llm-provider")
    assert res.status_code == 200
    assert res.json() == {"provider": "local"}


def test_put_endpoint_persists_and_updates_in_process_state(client, db):
    res = client.put("/settings/llm-provider", json={"provider": "cloud"})
    assert res.status_code == 200
    assert res.json() == {"provider": "cloud"}

    # Persisted...
    assert get_llm_provider(db) == "cloud"
    # ...and live in-process, no restart needed.
    assert get_active_provider() == "cloud"

    # GET reflects it too.
    res = client.get("/settings/llm-provider")
    assert res.json() == {"provider": "cloud"}


def test_put_endpoint_rejects_invalid_provider(client):
    res = client.put("/settings/llm-provider", json={"provider": "bogus"})
    assert res.status_code == 422
