"""Competition calendar CRUD."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.database import get_db
from app.models import Competition
from app.schemas import CompetitionCreate, CompetitionOut, CompetitionResultPatch
from app.services.transactions import lock_nutrition_inputs, lock_resource

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
    lock_nutrition_inputs(db)
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
    lock_resource(db, "competition", comp_id)
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
    result: CompetitionResultPatch,
    db: Session = Depends(get_db),
) -> CompetitionOut:
    lock_resource(db, "competition", comp_id)
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    updated = {**(c.result or {}), **result.model_dump(exclude_unset=True)}
    placing = updated.get("placing")
    field_size = updated.get("field_size")
    if isinstance(placing, int) and isinstance(field_size, int) and placing > field_size:
        raise HTTPException(422, "placing cannot exceed field size")
    c.result = updated or None
    db.commit()
    db.refresh(c)
    return _to_out(c)


@router.delete("/{comp_id}/result", status_code=204)
def clear_result(comp_id: int, db: Session = Depends(get_db)) -> None:
    lock_resource(db, "competition", comp_id)
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    c.result = None
    db.commit()


@router.delete("/{comp_id}", status_code=204)
def delete_competition(comp_id: int, db: Session = Depends(get_db)):
    lock_resource(db, "competition", comp_id)
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "not found")
    db.delete(c)
    db.commit()
