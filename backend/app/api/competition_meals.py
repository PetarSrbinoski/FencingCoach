"""Draft and accept dated meals for an accepted competition target version."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import CompetitionMealPlan, CompetitionNutritionPlan, NutritionTargetAssignment
from app.services.competition_meals import preview_meals
from app.services.transactions import lock_meal_inputs, lock_nutrition_inputs

router = APIRouter(prefix="/competition-nutrition/plans", tags=["competition meals"])


class MealDraftInput(BaseModel):
    start: date
    end: date
    start_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    break_times: list[str] = Field(default_factory=list, max_length=5)
    replace_slot: str | None = Field(default=None, max_length=40)
    prep_limit_minutes: int | None = Field(default=None, ge=0, le=240)


class MealAcceptInput(BaseModel):
    inputs: MealDraftInput
    token: str = Field(min_length=64, max_length=64)
    acceptance_id: str = Field(min_length=1, max_length=100)


def _get_plan(db: Session, plan_id: int) -> CompetitionNutritionPlan:
    plan = db.get(CompetitionNutritionPlan, plan_id)
    if plan is None:
        raise HTTPException(404, "Accepted target plan not found")
    return plan


def _out(row: CompetitionMealPlan, db: Session) -> dict[str, Any]:
    assignment = db.get(NutritionTargetAssignment, row.day)
    return {"id": row.id, "day": row.day.isoformat(), "target_plan_id": row.target_plan_id,
            "target_version": row.target_version, "version": row.version,
            "meals": row.meals, "totals": row.totals, "warnings": row.warnings,
            "inputs": row.inputs, "active": row.active,
            "needs_review": assignment is None or assignment.plan_id != row.target_plan_id,
            "created_at": row.created_at.isoformat() if row.created_at else None}


@router.get("/{plan_id}/meals")
def list_meal_history(plan_id: int, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    _get_plan(db, plan_id)
    return [_out(row, db) for row in db.scalars(select(CompetitionMealPlan).where(
        CompetitionMealPlan.target_plan_id == plan_id).order_by(
            CompetitionMealPlan.day, CompetitionMealPlan.version.desc())).all()]


@router.post("/{plan_id}/meals/preview")
def preview_plan_meals(plan_id: int, body: MealDraftInput, db: Session = Depends(get_db)) -> dict[str, Any]:
    plan = _get_plan(db, plan_id)
    for value in body.break_times:
        if len(value) != 5 or value[2] != ":" or not value[:2].isdigit() or not value[3:].isdigit() or int(value[:2]) > 23 or int(value[3:]) > 59:
            raise HTTPException(422, "Break times must use HH:MM")
    try:
        return preview_meals(db, plan, body.model_dump(mode="json"))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{plan_id}/meals/accept", status_code=201)
def accept_plan_meals(plan_id: int, body: MealAcceptInput, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    lock_nutrition_inputs(db)
    lock_meal_inputs(db)
    existing = db.scalars(select(CompetitionMealPlan).where(
        CompetitionMealPlan.acceptance_id == body.acceptance_id).order_by(CompetitionMealPlan.day)).all()
    if existing:
        if any(row.target_plan_id != plan_id or row.preview_token != body.token for row in existing):
            raise HTTPException(409, "Acceptance ID was already used for a different meal draft")
        return [_out(row, db) for row in existing]
    plan = _get_plan(db, plan_id)
    try:
        draft = preview_meals(db, plan, body.inputs.model_dump(mode="json"))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    if draft["token"] != body.token:
        raise HTTPException(409, "Meal draft is stale; regenerate and review the dates before accepting")
    saved = []
    for day in draft["days"]:
        parsed_day = date.fromisoformat(day["day"])
        old = db.scalars(select(CompetitionMealPlan).where(
            CompetitionMealPlan.day == parsed_day, CompetitionMealPlan.active.is_(True)).with_for_update()).all()
        version = (db.scalar(select(func.max(CompetitionMealPlan.version)).where(
            CompetitionMealPlan.day == parsed_day)) or 0) + 1
        for row in old:
            row.active = False
        row = CompetitionMealPlan(day=parsed_day, target_plan_id=plan_id,
                                  target_version=plan.version, version=version,
                                  meals=day["meals"], totals=day["totals"], warnings=day["warnings"],
                                  inputs=draft["inputs"], preview_token=draft["token"],
                                  acceptance_id=body.acceptance_id, active=True)
        db.add(row)
        saved.append(row)
    db.commit()
    return [_out(row, db) for row in saved]
