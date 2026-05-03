"""Daily brief endpoints."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models import DailyBrief
from app.schemas import BriefOut
from app.agents.brief import generate_brief

router = APIRouter(prefix="/brief", tags=["brief"])


@router.post("/today", response_model=BriefOut)
def generate_today(_user: CurrentUser, db: Session = Depends(get_db)) -> BriefOut:
    try:
        brief = generate_brief(db)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"brief generation failed: {e}") from e
    return BriefOut.model_validate(brief, from_attributes=True)


@router.get("/today", response_model=BriefOut | None)
def get_today(_user: CurrentUser, db: Session = Depends(get_db)) -> BriefOut | None:
    brief = db.scalar(select(DailyBrief).where(DailyBrief.day == Date.today()))
    if not brief:
        return None
    return BriefOut.model_validate(brief, from_attributes=True)


@router.get("/{day}", response_model=BriefOut | None)
def get_day(
    day: Date, _user: CurrentUser, db: Session = Depends(get_db)
) -> BriefOut | None:
    brief = db.scalar(select(DailyBrief).where(DailyBrief.day == day))
    if not brief:
        return None
    return BriefOut.model_validate(brief, from_attributes=True)
