"""Nutrition target endpoint (periodized macros/micros)."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import DayTypeOverride
from app.schemas import DayTypeOverrideRequest, TargetsOut
from app.services.targets import VALID_DAY_TYPES, resolve_effective_targets
from app.services.transactions import lock_nutrition_inputs

router = APIRouter(prefix="/targets", tags=["targets"])


@router.get("/today", response_model=TargetsOut)
def today(db: Session = Depends(get_db)) -> TargetsOut:
    try:
        return TargetsOut(**resolve_effective_targets(db).to_dict())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{day}", response_model=TargetsOut)
def for_day(day: Date, db: Session = Depends(get_db)) -> TargetsOut:
    try:
        return TargetsOut(**resolve_effective_targets(db, day).to_dict())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.put("/day-type/{day}")
def set_day_type_override(
    day: Date,
    body: DayTypeOverrideRequest,
    db: Session = Depends(get_db),
) -> dict:
    lock_nutrition_inputs(db)
    if body.day_type not in VALID_DAY_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid day_type '{body.day_type}'. Must be one of: {sorted(VALID_DAY_TYPES)}",
        )
    stmt = pg_insert(DayTypeOverride).values(day=day, override_type=body.day_type)
    stmt = stmt.on_conflict_do_update(
        index_elements=["day"],
        set_={"override_type": stmt.excluded.override_type},
    )
    db.execute(stmt)
    db.commit()
    return {"day": day.isoformat(), "day_type": body.day_type, "source": "manual"}


@router.delete("/day-type/{day}")
def clear_day_type_override(
    day: Date,
    db: Session = Depends(get_db),
) -> dict:
    lock_nutrition_inputs(db)
    db.execute(delete(DayTypeOverride).where(DayTypeOverride.day == day))
    db.commit()
    return {"day": day.isoformat(), "source": "auto"}
