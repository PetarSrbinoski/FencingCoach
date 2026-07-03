"""Competition calendar CRUD."""

from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.database import get_db
from app.models import Competition
from app.schemas import CompetitionCreate, CompetitionOut

router = APIRouter(prefix="/competitions", tags=["competitions"])


def _to_out(c: Competition) -> CompetitionOut:
    return CompetitionOut(
        id=c.id,
        name=c.name,
        location=c.location,
        event_date=c.event_date,
        end_date=c.end_date,
        level=c.level,
        priority=c.priority,
        notes=c.notes,
        result=c.result,
    )


@router.get("", response_model=list[CompetitionOut])
def list_competitions(
    upcoming_only: bool = False,
    db: Session = Depends(get_db),
) -> list[CompetitionOut]:
    stmt = select(Competition)
    if upcoming_only:
        stmt = stmt.where(Competition.event_date >= athlete_today())
    rows = db.scalars(stmt.order_by(Competition.event_date)).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=CompetitionOut, status_code=201)
def create_competition(
    body: CompetitionCreate, db: Session = Depends(get_db)
) -> CompetitionOut:
    c = Competition(**body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _to_out(c)


@router.get("/{comp_id}", response_model=CompetitionOut)
def get_competition(
    comp_id: int, db: Session = Depends(get_db)
) -> CompetitionOut:
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    return _to_out(c)


@router.put("/{comp_id}", response_model=CompetitionOut)
def update_competition(
    comp_id: int,
    body: CompetitionCreate,
    db: Session = Depends(get_db),
) -> CompetitionOut:
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return _to_out(c)


@router.patch("/{comp_id}/result", response_model=CompetitionOut)
def set_result(
    comp_id: int,
    result: dict,
    db: Session = Depends(get_db),
) -> CompetitionOut:
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    c.result = result
    db.commit()
    db.refresh(c)
    return _to_out(c)


@router.delete("/{comp_id}", status_code=204)
def delete_competition(comp_id: int, db: Session = Depends(get_db)):
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    db.delete(c)
    db.commit()
