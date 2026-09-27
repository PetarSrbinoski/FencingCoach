"""Atomic coach write receipts and guarded resource reversal."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AgentAction,
    CoachConversation,
    Competition,
    CompetitionNutritionPlan,
    NutritionLog,
    NutritionTargetAssignment,
    SavedFood,
    WorkoutOverride,
)
from app.services.foods import normalized_name
from app.services.training import clear_workout_override, set_workout_override, workout_revision
from app.services.transactions import lock_nutrition_inputs, lock_resource

WORKOUT_FIELDS = ("session_name", "exercises", "notes", "revision")
COMPETITION_FIELDS = ("name", "location", "event_date", "end_date", "level", "priority", "notes", "result", "revision")
FOOD_FIELDS = ("name", "name_key", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "micros", "serving_name", "serving_size_g", "prep_time_min", "revision")
MEAL_FIELDS = ("day", "meal", "raw_text", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "micros", "estimated_by", "version")


def snapshot(row: Any, kind: str) -> dict[str, Any] | None:
    if row is None:
        return None
    fields = {"workout": WORKOUT_FIELDS, "competition": COMPETITION_FIELDS,
              "food_create": FOOD_FIELDS, "food_update": FOOD_FIELDS, "meal": MEAL_FIELDS}[kind]
    return {key: value.isoformat() if isinstance(value, date) else value
            for key in fields for value in [getattr(row, key)]}


def record_action(
    db: Session, kind: str, resource_id: str | int, summary: str,
    before: dict[str, Any] | None, after: dict[str, Any] | None,
    *, conversation_id: int | None = None, message_id: int | None = None,
    status: str = "committed", error: str | None = None,
) -> AgentAction:
    row = AgentAction(kind=kind, resource_id=str(resource_id), summary=summary,
                      before=before, after=after, conversation_id=conversation_id,
                      message_id=message_id, status=status, error=error)
    if kind == "workout" and status == "committed":
        row.resource_revision = workout_revision(db, date.fromisoformat(str(resource_id)))
    db.add(row)
    db.flush()
    return row


def _resource(db: Session, action: AgentAction) -> Any:
    model: Any
    key: Any
    if action.kind == "workout":
        model, key = WorkoutOverride, date.fromisoformat(action.resource_id)
    elif action.kind == "competition":
        model, key = Competition, int(action.resource_id)
    elif action.kind in {"food_create", "food_update"}:
        model, key = SavedFood, int(action.resource_id)
    elif action.kind == "meal":
        model, key = NutritionLog, int(action.resource_id)
    else:
        raise ValueError("This action cannot be reversed")
    return db.scalar(select(model).where(model.__mapper__.primary_key[0] == key).with_for_update())


def present(db: Session, row: AgentAction) -> dict[str, Any]:
    conversation = db.get(CoachConversation, row.conversation_id) if row.conversation_id else None
    try:
        resource_id: str | int = int(row.resource_id)
    except ValueError:
        resource_id = row.resource_id
    return {"id": row.id, "kind": row.kind, "status": row.status,
            "resource_id": resource_id,
            "summary": row.summary, "before": row.before, "after": row.after,
            "conversation_id": row.conversation_id, "conversation_available": conversation is not None,
            "message_id": row.message_id, "error": row.error,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "undone_at": row.undone_at.isoformat() if row.undone_at else None}


def undo(db: Session, action_id: int) -> tuple[dict[str, Any], bool]:
    action = db.scalar(select(AgentAction).where(AgentAction.id == action_id).with_for_update())
    if action is None:
        raise LookupError("Action not found")
    if action.status == "undone":
        return present(db, action), True
    if action.status == "failed":
        raise ValueError("A failed attempt made no change and cannot be undone")
    if action.kind == "nutrition_plan":
        return _undo_nutrition_plan(db, action)
    if action.kind not in {"workout", "competition", "food_create", "food_update", "meal"}:
        raise ValueError("This action cannot be reversed")
    lock_resource(db, action.kind, action.resource_id)
    current = _resource(db, action)
    current_snapshot = snapshot(current, action.kind)
    revision_conflict = action.kind == "workout" and (
        action.resource_revision is None
        or workout_revision(db, date.fromisoformat(action.resource_id)) != action.resource_revision
    )
    if current_snapshot != action.after or revision_conflict:
        action.error = ("The item is no longer present; nothing was changed" if current is None
                        else "The item has changed since this coach action; inspect the newer version")
        action.status = "conflict" if revision_conflict or current is not None else "missing"
        if revision_conflict:
            action.error = "The workout date changed since this action; inspect the newer version"
        db.commit()
        return present(db, action), False
    if action.kind == "competition" and db.scalar(select(CompetitionNutritionPlan.id).where(
        CompetitionNutritionPlan.event_id == int(action.resource_id)).limit(1)) is not None:
        action.error = "This event has a nutrition plan; review dependent records before deleting it"
        action.status = "conflict"
        db.commit()
        return present(db, action), False
    if action.kind in {"competition", "food_create", "meal"}:
        db.delete(current)
    elif action.kind == "workout":
        day = date.fromisoformat(action.resource_id)
        if action.before is None:
            clear_workout_override(db, day, commit=False)
        else:
            set_workout_override(db, day, action.before["exercises"],
                                 action.before["session_name"], action.before["notes"], commit=False)
    elif action.kind == "food_update":
        assert current is not None and action.before is not None
        collision = db.scalar(select(SavedFood.id).where(
            SavedFood.name_key == normalized_name(action.before["name"]), SavedFood.id != current.id))
        if collision is not None:
            action.error = "The previous food name now belongs to another library entry"
            action.status = "conflict"
            db.commit()
            return present(db, action), False
        for key in FOOD_FIELDS[:-1]:
            setattr(current, key, action.before[key])
    action.status = "undone"
    action.error = None
    action.undone_at = datetime.now(UTC)
    db.flush()
    record_action(db, "reversal", action.resource_id, f"Undid action {action.id}: {action.summary}",
                  action.after, {"reversal_of": action.id, "restored": action.before},
                  conversation_id=action.conversation_id, message_id=action.message_id)
    db.commit()
    return present(db, action), True


def _undo_nutrition_plan(db: Session, action: AgentAction) -> tuple[dict[str, Any], bool]:
    lock_nutrition_inputs(db)
    assert action.before is not None and action.after is not None
    plan = db.get(CompetitionNutritionPlan, int(action.resource_id))
    after = action.after["assignments"]
    before = action.before["assignments"]
    for expected in after:
        current = db.scalar(select(NutritionTargetAssignment).where(
            NutritionTargetAssignment.day == date.fromisoformat(expected["day"])).with_for_update())
        if current is None or current.plan_id != expected["plan_id"] or current.targets != expected["targets"]:
            action.status = "conflict"
            action.error = f"Targets on {expected['day']} changed since this action; review the newer plan"
            db.commit()
            return present(db, action), False
    if plan is None or not plan.active:
        action.status = "missing"
        action.error = "Applied plan is no longer active; review current target history"
        db.commit()
        return present(db, action), False
    for previous in before:
        day = date.fromisoformat(previous["day"])
        current = db.get(NutritionTargetAssignment, day)
        if previous["plan_id"] is None:
            db.delete(current)
        else:
            assert current is not None
            current.plan_id = previous["plan_id"]
            current.targets = previous["targets"]
    plan.active = False
    action.status = "undone"
    action.error = None
    action.undone_at = datetime.now(UTC)
    db.flush()
    record_action(db, "reversal", action.resource_id, f"Undid action {action.id}: {action.summary}",
                  action.after, {"reversal_of": action.id, "restored": action.before},
                  conversation_id=action.conversation_id, message_id=action.message_id)
    db.commit()
    return present(db, action), True
