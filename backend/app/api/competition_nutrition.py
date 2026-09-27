"""Preview dated targets for a selected competition."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.database import get_db
from app.models import Competition, CompetitionNutritionPlan, NutritionTargetAssignment
from app.services.competition_nutrition import preview, stage_accepted_plan
from app.services.nutrition_lookup import lookup_targets
from app.services.transactions import lock_nutrition_inputs

router = APIRouter(prefix="/competition-nutrition", tags=["competition nutrition"])


class PreviewInput(BaseModel):
    expected_demand: Literal["low", "moderate", "high"]
    event_format: Literal["single_day", "multi_day"]
    start_time: str | None = None
    resolve_overlaps: bool = False


class AcceptInput(BaseModel):
    event_id: int
    inputs: PreviewInput
    token: str = Field(min_length=64, max_length=64)
    acceptance_id: str = Field(min_length=1, max_length=100)


class DeactivateInput(BaseModel):
    token: str = Field(min_length=64, max_length=64)


@router.get("/targets")
def target_range(
    start: date = Query(...), end: date = Query(...), event_id: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    try:
        return lookup_targets(db, start, end, event_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _plan_out(plan: CompetitionNutritionPlan) -> dict:
    return {"id": plan.id, "event_id": plan.event_id, "event": plan.event_snapshot,
            "inputs": plan.inputs, "input_snapshot": plan.input_snapshot,
            "days": plan.days, "version": plan.version,
            "policy_version": plan.policy_version, "active": plan.active,
            "created_at": plan.created_at.isoformat() if plan.created_at else None}


@router.get("/plans")
def list_plans(db: Session = Depends(get_db)) -> list[dict]:
    return [_plan_out(plan) for plan in db.scalars(
        select(CompetitionNutritionPlan).order_by(CompetitionNutritionPlan.created_at.desc(), CompetitionNutritionPlan.id.desc())
    ).all()]


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Session = Depends(get_db)) -> dict:
    plan = db.get(CompetitionNutritionPlan, plan_id)
    if plan is None:
        raise HTTPException(404, "nutrition plan not found")
    return _plan_out(plan)


@router.post("/preview/{event_id}")
def preview_event(event_id: int, body: PreviewInput, db: Session = Depends(get_db)) -> dict:
    event = db.get(Competition, event_id)
    if event is None:
        raise HTTPException(404, "competition not found")
    try:
        return preview(db, event, body.model_dump())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/accept", status_code=201)
def accept_preview(body: AcceptInput, db: Session = Depends(get_db)) -> dict:
    lock_nutrition_inputs(db)
    existing = db.scalar(select(CompetitionNutritionPlan).where(
        CompetitionNutritionPlan.acceptance_id == body.acceptance_id))
    if existing is not None:
        if existing.event_id != body.event_id or existing.preview_token != body.token:
            raise HTTPException(409, "acceptance request ID was already used")
        return _plan_out(existing)
    event = db.get(Competition, body.event_id)
    if event is None:
        raise HTTPException(404, "competition not found; request a new preview")
    try:
        draft = preview(db, event, body.inputs.model_dump())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    if draft["token"] != body.token:
        raise HTTPException(409, "preview is stale; request a fresh comparison before accepting")
    plan, _, _ = stage_accepted_plan(db, draft, body.acceptance_id)
    db.commit()
    db.refresh(plan)
    return _plan_out(plan)


def _deactivation_data(db: Session, plan: CompetitionNutritionPlan) -> dict:
    affected = db.scalars(select(NutritionTargetAssignment).where(
        NutritionTargetAssignment.plan_id == plan.id,
        NutritionTargetAssignment.day >= athlete_today()).order_by(NutritionTargetAssignment.day)).all()
    days = [{"day": row.day.isoformat(), "old_targets": row.targets} for row in affected]
    payload = {"plan_id": plan.id, "version": plan.version, "days": days}
    payload["token"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return payload


@router.get("/plans/{plan_id}/deactivation-preview")
def deactivation_preview(plan_id: int, db: Session = Depends(get_db)) -> dict:
    plan = db.get(CompetitionNutritionPlan, plan_id)
    if plan is None:
        raise HTTPException(404, "nutrition plan not found")
    return _deactivation_data(db, plan)


@router.post("/plans/{plan_id}/deactivate")
def deactivate_plan(plan_id: int, body: DeactivateInput, db: Session = Depends(get_db)) -> dict:
    lock_nutrition_inputs(db)
    plan = db.get(CompetitionNutritionPlan, plan_id)
    if plan is None:
        raise HTTPException(404, "nutrition plan not found")
    if not plan.active:
        return _plan_out(plan)
    current = _deactivation_data(db, plan)
    if current["token"] != body.token:
        raise HTTPException(409, "deactivation preview is stale; review affected dates again")
    for row in db.scalars(select(NutritionTargetAssignment).where(
        NutritionTargetAssignment.plan_id == plan.id,
        NutritionTargetAssignment.day >= athlete_today())).all():
        db.delete(row)
    plan.active = False
    db.commit()
    db.refresh(plan)
    return _plan_out(plan)
