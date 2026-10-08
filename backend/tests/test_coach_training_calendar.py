"""The coach reads the same planned sessions as the Training calendar."""

from __future__ import annotations

import asyncio
from datetime import date
from types import SimpleNamespace
from typing import cast

import pytest
from app.agents.coach import (
    coach_agent,
    coach_agent_search,
    training_sessions_for_dates,
    update_day_workout,
)
from app.agents.deps import CoachDeps
from app.core.database import get_db
from app.main import app
from app.models import AgentAction, Competition, WorkoutLog, WorkoutOverride
from app.schemas import ExerciseOverrideIn
from fastapi.testclient import TestClient
from pydantic_ai import RunContext
from pydantic_ai.exceptions import ModelRetry
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel


@pytest.fixture
def ctx(db, monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.WEEKLY_SCHEDULE",
        "fencing,gym,fencing,gym,fencing,fencing,rest",
    )
    return cast("RunContext[CoachDeps]", SimpleNamespace(deps=CoachDeps(db=db)))


def read(ctx, start_day, end_day=None):
    return [row.model_dump(mode="json") for row in asyncio.run(
        training_sessions_for_dates(ctx, start_day, end_day)
    )]


def test_week_matches_calendar_with_manual_and_competition_days(ctx, db):
    exercises = [{"exercise": "Snatch", "sets": 5, "reps": 2, "load_kg": 60,
                  "target_rpe": 7, "intent": "power", "notes": "Full reset"}]
    db.add(WorkoutOverride(day=date(2026, 7, 21), session_name="Custom power",
                           exercises=exercises, notes="Keep it crisp"))
    db.add(Competition(name="Cup", event_date=date(2026, 7, 24),
                       end_date=date(2026, 7, 25), priority="A"))
    db.commit()

    days = read(ctx, "2026-07-20", "2026-07-26")
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        response = client.get("/training/week?start=2026-07-20")
        assert response.status_code == 200
        assert days == response.json()
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert len(days) == 7
    assert days[0]["activity_type"] == "fencing"
    assert days[0]["session"] is None
    assert days[1]["source"] == "manual"
    assert days[1]["session"] == {
        "name": "Custom power", "exercises": exercises, "rationale": "Keep it crisp",
    }
    assert days[3]["source"] == "auto"
    assert days[3]["session"]["exercises"]
    for day in days[4:6]:
        assert day["activity_type"] == "competition"
        assert day["competitions"][0]["name"] == "Cup"
        assert day["session"] is None
    assert days[6]["activity_type"] == "rest"
    assert days[6]["session"] is None
    assert not ctx.deps.side_effect_committed
    assert db.query(WorkoutOverride).count() == 1
    assert db.query(WorkoutLog).count() == 0
    assert db.query(AgentAction).count() == 0


def test_single_day_and_fresh_reads_after_calendar_edit(ctx, db):
    day = "2026-07-21"
    assert read(ctx, day)[0]["source"] == "auto"
    db.add(WorkoutOverride(day=date.fromisoformat(day), session_name="Updated",
                           exercises=[{"exercise": "Squat", "sets": 3, "reps": 5}]))
    db.commit()
    rows = read(ctx, day)
    assert len(rows) == 1
    assert rows[0]["day"] == day
    assert rows[0]["source"] == "manual"
    assert rows[0]["session"]["name"] == "Updated"


def test_write_tool_updates_and_resets_plan_seen_by_read_tool_and_calendar(ctx, db):
    day = "2026-07-21"
    original = read(ctx, day)
    asyncio.run(update_day_workout(
        ctx, day, exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)],
        session_name="Strength", notes="Requested change",
    ))
    updated = read(ctx, day)
    assert updated[0]["source"] == "manual"
    assert updated[0]["session"]["exercises"][0]["exercise"] == "Squat"
    assert updated[0]["session"]["rationale"] == "Requested change"
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        assert client.get(f"/training/session/{day}").json() == updated[0]
        asyncio.run(update_day_workout(ctx, day, exercises=[]))
        assert read(ctx, day) == original
        assert client.get(f"/training/session/{day}").json() == original[0]
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert ctx.deps.side_effect_committed
    assert db.query(AgentAction).count() == 2


@pytest.mark.parametrize(("start", "end", "error"), [
    ("not-a-date", None, "Invalid start_day"),
    ("2026-07-21", "2026-02-30", "Invalid end_day"),
    ("2026-07-21", "", "Invalid end_day"),
    ("2026-07-21", "2026-07-20", "on or after"),
    ("2026-07-01", "2026-08-01", "at most 31"),
])
def test_invalid_ranges_ask_model_to_retry(ctx, start, end, error):
    with pytest.raises(ModelRetry, match=error):
        read(ctx, start, end)
    assert not ctx.deps.side_effect_committed


def test_inclusive_31_day_limit(ctx):
    days = read(ctx, "2026-07-01", "2026-07-31")
    assert len(days) == 31
    assert days[-1]["day"] == "2026-07-31"


@pytest.mark.parametrize("agent", [coach_agent, coach_agent_search])
def test_both_coach_agents_can_call_calendar_tool(ctx, agent):
    def model(messages, info):
        assert "training_sessions_for_dates" in {tool.name for tool in info.function_tools}
        results = [part for message in messages for part in message.parts
                   if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse(parts=[ToolCallPart(
                "training_sessions_for_dates", {"start_day": "2026-07-21"},
            )])
        assert results[-1].tool_name == "training_sessions_for_dates"
        content = results[-1].model_response_str()
        assert "2026-07-21" in content
        assert "Trap Bar Deadlift" in content
        return ModelResponse(parts=[TextPart("Your plan includes Trap Bar Deadlift.")])

    with agent.override(model=FunctionModel(model)):
        result = agent.run_sync("What is planned for July 21, 2026?", deps=ctx.deps)
    assert result.output == "Your plan includes Trap Bar Deadlift."
    assert not ctx.deps.side_effect_committed
