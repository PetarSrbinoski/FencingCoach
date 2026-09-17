"""Coach plan proposals need an explicit, reversible acceptance."""

from __future__ import annotations

import asyncio
from datetime import date
from types import SimpleNamespace
from typing import cast

import pytest
from app.agents.coach import propose_competition_nutrition_plan
from app.agents.deps import CoachDeps
from app.core.database import get_db
from app.main import app
from app.models import AthleteProfile, Competition, NutritionTargetAssignment
from fastapi.testclient import TestClient
from pydantic_ai import RunContext


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def seed(db, monkeypatch):
    monkeypatch.setattr("app.api.competition_nutrition.athlete_today", lambda: date(2026, 7, 20))
    monkeypatch.setattr("app.services.competition_nutrition.athlete_today", lambda: date(2026, 7, 20))
    db.add(AthleteProfile(weight_kg=75))
    db.add(Competition(name="Cup", event_date=date(2026, 7, 25), priority="A"))
    db.commit()


def context(db):
    deps = CoachDeps(db=db)
    deps.extra.update(conversation_id=123, message_id=456)
    return cast("RunContext[CoachDeps]", SimpleNamespace(deps=deps))


def test_coach_preview_apply_and_guarded_undo(client, db, monkeypatch):
    seed(db, monkeypatch)
    result = asyncio.run(propose_competition_nutrition_plan(
        context(db), event_name="Cup", expected_demand="high", event_format="single_day"))
    assert result["status"] == "pending"
    assert db.get(NutritionTargetAssignment, date(2026, 7, 25)) is None
    proposal = client.get("/coach-plan-proposals?conversation_id=123").json()[0]
    assert proposal["message_id"] == 456
    assert proposal["preview"]["days"]
    applied = client.post(f"/coach-plan-proposals/{proposal['id']}/apply")
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"
    assert client.post(f"/coach-plan-proposals/{proposal['id']}/apply").json()["action_id"] == applied.json()["action_id"]
    action = client.get(f"/agent-actions/{applied.json()['action_id']}").json()
    assert action["kind"] == "nutrition_plan"
    assert db.get(NutritionTargetAssignment, date(2026, 7, 25)).plan_id == applied.json()["applied_plan_id"]
    reversed_ = client.post(f"/agent-actions/{action['id']}/undo", json={"request_id": "undo-plan"})
    assert reversed_.status_code == 200, reversed_.text
    assert db.get(NutritionTargetAssignment, date(2026, 7, 25)) is None


def test_changed_event_rejects_coach_proposal(client, db, monkeypatch):
    seed(db, monkeypatch)
    result = asyncio.run(propose_competition_nutrition_plan(
        context(db), event_name="Cup", expected_demand="moderate", event_format="single_day"))
    comp = db.query(Competition).one()
    comp.event_date = date(2026, 7, 26)
    db.commit()
    response = client.post(f"/coach-plan-proposals/{result['proposal_id']}/apply")
    assert response.status_code == 409
    assert client.get("/agent-actions?kind=nutrition_plan").json()["total"] == 0
