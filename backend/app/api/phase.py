"""Periodization phase endpoint."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.schemas import PhaseOut
from app.services.periodization import compute_phase

router = APIRouter(prefix="/phase", tags=["phase"])


@router.get("/today", response_model=PhaseOut)
def today(_user: CurrentUser, db: Session = Depends(get_db)) -> PhaseOut:
    return PhaseOut(**compute_phase(db).to_dict())


@router.get("/{day}", response_model=PhaseOut)
def for_day(day: Date, _user: CurrentUser, db: Session = Depends(get_db)) -> PhaseOut:
    return PhaseOut(**compute_phase(db, day).to_dict())
