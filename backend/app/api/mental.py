"""Mental training endpoints."""

from __future__ import annotations

from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import MentalEntry
from app.schemas import MentalEntryCreate, MentalEntryOut, MentalInsightOut
from app.services import mental as mental_service

router = APIRouter(prefix="/mental", tags=["mental"])


@router.post("/entry", response_model=MentalEntryOut)
def create_entry(
    body: MentalEntryCreate,
    db: Session = Depends(get_db),
) -> MentalEntryOut:
    entry = MentalEntry(
        day=body.day or Date.today(),
        entry_type=body.entry_type,
        mood_score=body.mood_score,
        energy_score=body.energy_score,
        focus_score=body.focus_score,
        confidence_score=body.confidence_score,
        content=body.content,
        tags=body.tags if body.tags else None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return MentalEntryOut.model_validate(entry, from_attributes=True)


@router.get("/entries", response_model=list[MentalEntryOut])
def list_entries(
    days: int = Query(14, ge=1, le=90),
    entry_type: str | None = None,
    db: Session = Depends(get_db),
) -> list[MentalEntryOut]:
    end = Date.today()
    start = end - timedelta(days=days - 1)
    stmt = select(MentalEntry).where(
        and_(MentalEntry.day >= start, MentalEntry.day <= end)
    )
    if entry_type:
        stmt = stmt.where(MentalEntry.entry_type == entry_type)
    rows = db.scalars(stmt.order_by(MentalEntry.created_at.desc())).all()
    return [MentalEntryOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/insight", response_model=MentalInsightOut)
def get_insight(
    days: int = Query(14, ge=3, le=90),
    db: Session = Depends(get_db),
) -> MentalInsightOut:
    result = mental_service.compute_insight(db, period_days=days)
    return MentalInsightOut(**result)


@router.delete("/entry/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(MentalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    db.delete(entry)
    db.commit()
