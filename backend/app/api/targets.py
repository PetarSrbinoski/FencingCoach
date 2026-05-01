"""Nutrition target endpoint (periodized macros/micros)."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.schemas import TargetsOut
from app.services.targets import compute_targets

router = APIRouter(prefix="/targets", tags=["targets"])


@router.get("/today", response_model=TargetsOut)
def today(_user: CurrentUser, db: Session = Depends(get_db)) -> TargetsOut:
    return TargetsOut(**compute_targets(db).to_dict())


@router.get("/{day}", response_model=TargetsOut)
def for_day(day: Date, _user: CurrentUser, db: Session = Depends(get_db)) -> TargetsOut:
    return TargetsOut(**compute_targets(db, day).to_dict())
