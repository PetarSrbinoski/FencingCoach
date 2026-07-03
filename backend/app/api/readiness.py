"""Readiness endpoints."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import ReadinessResponse
from app.services.readiness import compute_readiness

router = APIRouter(prefix="/readiness", tags=["readiness"])


@router.get("/today", response_model=ReadinessResponse)
def today(db: Session = Depends(get_db)) -> ReadinessResponse:
    return ReadinessResponse(**compute_readiness(db).to_dict())


@router.get("/{day}", response_model=ReadinessResponse)
def for_day(
    day: Date, db: Session = Depends(get_db)
) -> ReadinessResponse:
    return ReadinessResponse(**compute_readiness(db, day).to_dict())
