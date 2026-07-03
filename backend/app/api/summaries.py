"""Data summarization endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import DataSummaryOut
from app.services import summarization

router = APIRouter(prefix="/summaries", tags=["summaries"])


@router.post("/generate")
def generate_summaries(
    db: Session = Depends(get_db),
) -> dict:
    """Trigger summary generation for all domains."""
    weekly = summarization.generate_weekly_summaries(db)
    monthly = summarization.generate_monthly_summaries(db)
    return {
        "weekly_created": weekly,
        "monthly_created": monthly,
    }


@router.get("/", response_model=list[DataSummaryOut])
def list_summaries(
    domain: str | None = None,
    period: str | None = None,
    limit: int = Query(52, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[DataSummaryOut]:
    """Retrieve stored summaries."""
    rows = summarization.get_summaries(db, domain=domain, period=period, limit=limit)
    return [DataSummaryOut.model_validate(r, from_attributes=True) for r in rows]
