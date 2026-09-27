"""Public action history and guarded reversal for coach changes."""

from __future__ import annotations

import asyncio
from datetime import date
from types import SimpleNamespace
from typing import Any, cast

import pytest
from app.agents.coach import (
    add_competition,
    log_saved_foods,
    save_personal_food,
    update_day_workout,
)
from app.agents.deps import CoachDeps
from app.core.database import get_db
from app.main import app
from app.models import Competition, NutritionLog, SavedFood, WorkoutOverride
from app.schemas import ExerciseOverrideIn
from app.schemas.foods import FoodPortion, SavedFoodInput
from fastapi.testclient import TestClient
from pydantic_ai import RunContext


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def ctx(db) -> RunContext[CoachDeps]:
    deps = CoachDeps(db=db)
    deps.extra["conversation_id"] = 123
    deps.extra["message_id"] = 456
    return cast("RunContext[CoachDeps]", SimpleNamespace(deps=deps))


def actions(client, kind: str) -> list[dict[str, Any]]:
    response = client.get(f"/agent-actions?kind={kind}")
    assert response.status_code == 200
    return response.json()["items"]


def undo(client, action_id: int):
    return client.post(f"/agent-actions/{action_id}/undo", json={"request_id": f"undo-{action_id}"})


def test_workout_action_restores_prior_override_and_refuses_later_edit(client, db):
    day = "2026-10-06"
    first = [ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)]
    second = [ExerciseOverrideIn(exercise="Lunge", sets=2, reps=8)]
    asyncio.run(update_day_workout(ctx(db), day=day, exercises=first))
    asyncio.run(update_day_workout(ctx(db), day=day, exercises=second))
    rows = actions(client, "workout")
    assert [row["status"] for row in rows] == ["committed", "committed"]
    assert rows[0]["conversation_id"] == 123
    assert rows[0]["after"]["exercises"][0]["exercise"] == "Lunge"
    response = undo(client, rows[0]["id"])
    assert response.status_code == 200
    assert db.get(WorkoutOverride, date.fromisoformat(day)).exercises[0]["exercise"] == "Squat"
    assert undo(client, rows[0]["id"]).status_code == 200
    assert undo(client, rows[1]["id"]).status_code == 409


def test_competition_action_refuses_edited_event_and_removes_untouched_event(client, db):
    asyncio.run(add_competition(ctx(db), name="Cup", event_date="2026-11-01"))
    row = actions(client, "competition")[0]
    comp_id = row["resource_id"]
    assert client.put(f"/competitions/{comp_id}", json={
        "name": "Edited Cup", "event_date": "2026-11-01", "priority": "A",
    }).status_code == 200
    assert undo(client, row["id"]).status_code == 409
    assert db.get(Competition, comp_id) is not None
    asyncio.run(add_competition(ctx(db), name="Second Cup", event_date="2026-11-02"))
    fresh = actions(client, "competition")[0]
    assert undo(client, fresh["id"]).status_code == 200
    assert db.get(Competition, fresh["resource_id"]) is None


def test_food_and_meal_actions_keep_logged_snapshot(client, db):
    food = SavedFoodInput(name="Rice", kcal=360, protein_g=7, carbs_g=80, fat_g=1)
    saved = asyncio.run(save_personal_food(ctx(db), food=food))
    logged = asyncio.run(log_saved_foods(ctx(db), portions=[FoodPortion(food_id=saved.id, grams=100)], day="2026-10-01"))
    meal_action = actions(client, "meal")[0]
    food_action = actions(client, "food_create")[0]
    assert meal_action["resource_id"] == logged["log_id"]
    assert undo(client, food_action["id"]).status_code == 200
    assert db.get(SavedFood, saved.id) is None
    assert db.get(NutritionLog, logged["log_id"]).kcal == 360
    assert undo(client, meal_action["id"]).status_code == 200
    assert db.get(NutritionLog, logged["log_id"]) is None


def test_later_direct_workout_and_diary_edits_block_undo(client, db):
    day = "2026-10-06"
    asyncio.run(update_day_workout(ctx(db), day=day,
                                   exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)]))
    action = actions(client, "workout")[0]
    assert client.put(f"/training/session/{day}/override", json={
        "exercises": [{"exercise": "Deadlift", "sets": 3, "reps": 5}],
    }).status_code == 200
    assert undo(client, action["id"]).status_code == 409
    assert actions(client, "workout")[0]["status"] == "conflict"

    saved = asyncio.run(save_personal_food(ctx(db), food=SavedFoodInput(
        name="Rice", kcal=360, protein_g=7, carbs_g=80, fat_g=1)))
    log = asyncio.run(log_saved_foods(ctx(db), portions=[FoodPortion(food_id=saved.id, grams=100)], day=day))
    meal = actions(client, "meal")[0]
    entry = db.get(NutritionLog, log["log_id"])
    entry.kcal = 350
    entry.version += 1
    db.commit()
    assert undo(client, meal["id"]).status_code == 409
    assert db.get(NutritionLog, log["log_id"]) is not None


def test_clear_workout_restores_prior_override(client, db):
    day = "2026-10-06"
    asyncio.run(update_day_workout(ctx(db), day=day,
                                   exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)]))
    asyncio.run(update_day_workout(ctx(db), day=day, exercises=None))
    clearing = actions(client, "workout")[0]
    assert clearing["after"] is None
    assert undo(client, clearing["id"]).status_code == 200
    assert db.get(WorkoutOverride, date.fromisoformat(day)).exercises[0]["exercise"] == "Squat"


def test_workout_clear_cannot_undo_over_a_later_set_and_reset(client, db):
    day = "2026-10-06"
    asyncio.run(update_day_workout(ctx(db), day=day,
                                   exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)]))
    asyncio.run(update_day_workout(ctx(db), day=day, exercises=None))
    clearing = actions(client, "workout")[0]
    assert client.put(f"/training/session/{day}/override", json={
        "exercises": [{"exercise": "Lunge", "sets": 2, "reps": 8}],
    }).status_code == 200
    assert client.delete(f"/training/session/{day}/override").status_code == 200
    assert undo(client, clearing["id"]).status_code == 409
    session = client.get(f"/training/session/{day}").json()
    assert session["source"] == "auto"


def test_food_update_restores_unknown_values(client, db):
    original = asyncio.run(save_personal_food(ctx(db), food=SavedFoodInput(
        name="Rice", kcal=360, protein_g=7, carbs_g=80, fat_g=1, fiber_g=None)))
    asyncio.run(save_personal_food(ctx(db), food=SavedFoodInput(
        name="Brown rice", kcal=350, protein_g=8, carbs_g=70, fat_g=2, fiber_g=3), food_id=original.id))
    update = actions(client, "food_update")[0]
    assert undo(client, update["id"]).status_code == 200
    restored = db.get(SavedFood, original.id)
    assert restored.name == "Rice" and restored.fiber_g is None
