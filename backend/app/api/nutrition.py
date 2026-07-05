"""Nutrition logging endpoints."""

from __future__ import annotations

import logging
from datetime import date as Date
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.agents.nutrition import estimate_nutrition
from app.core.clock import athlete_today
from app.core.database import SessionLocal, get_db
from app.models import NutritionEstimate, NutritionLog
from app.schemas import (
    NutritionDayTotals,
    NutritionEstimateAccepted,
    NutritionEstimateItemOut,
    NutritionEstimateOut,
    NutritionEstimateRequest,
    NutritionLogCreate,
    NutritionLogOut,
)
from app.services import usda as usda_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


def _estimate_out(row: NutritionEstimate) -> NutritionEstimateOut:
    return NutritionEstimateOut(
        id=row.id,
        status=row.status,
        error=row.error,
        kcal=row.kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        fiber_g=row.fiber_g,
        micros=row.micros or {},
        items=[NutritionEstimateItemOut(**item) for item in (row.items or [])],
        confidence=row.confidence,
        notes=row.notes or "",
    )


@router.post(
    "/estimate",
    response_model=NutritionEstimateAccepted,
    status_code=202,
)
def estimate(
    body: NutritionEstimateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> NutritionEstimateAccepted:
    """Kick off macro estimation for a free-text food description and
    return immediately — the LLM call runs in the background (see
    `_run_estimate`) and keeps going even if the athlete navigates away
    from `/nutrition` before it finishes. Poll
    `GET /nutrition/estimate/{id}` for the result.

    Does NOT persist as a logged meal — review/edit the polled result,
    then confirm via `POST /nutrition/log`.
    """
    row = NutritionEstimate(raw_text=body.text, status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)

    background_tasks.add_task(_run_estimate, estimate_id=row.id, text=body.text)

    return NutritionEstimateAccepted(id=row.id)


async def _run_estimate(*, estimate_id: int, text: str) -> None:
    """Background job: runs the LLM call and writes the result back to
    `estimate_id`. Opens its own DB session — the request's session that
    created the row above is already closed by the time this runs (see
    `api/chat.py`'s module docstring for why)."""
    db = SessionLocal()
    try:
        est = await estimate_nutrition(text, db=db)
        row = db.get(NutritionEstimate, estimate_id)
        if row is None:
            return
        row.status = "done"
        row.kcal = est.kcal
        row.protein_g = est.protein_g
        row.carbs_g = est.carbs_g
        row.fat_g = est.fat_g
        row.fiber_g = est.fiber_g
        row.micros = est.micros.model_dump()
        row.items = [item.model_dump() for item in est.items]
        row.confidence = est.confidence
        row.notes = est.notes
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("Nutrition estimation failed for estimate %d", estimate_id)
        row = db.get(NutritionEstimate, estimate_id)
        if row is not None:
            row.status = "error"
            row.error = str(e)
            db.commit()
    finally:
        db.close()


@router.get("/estimate/{estimate_id}", response_model=NutritionEstimateOut)
def get_estimate(estimate_id: int, db: Session = Depends(get_db)) -> NutritionEstimateOut:
    """Poll the result of `POST /nutrition/estimate`."""
    row = db.get(NutritionEstimate, estimate_id)
    if row is None:
        raise HTTPException(404, "estimate not found")
    return _estimate_out(row)


@router.post("/log", response_model=NutritionLogOut)
def log_meal(
    body: NutritionLogCreate,
    db: Session = Depends(get_db),
) -> NutritionLogOut:
    """Persist a (possibly user-reviewed/edited) nutrition estimate.

    Does not call the LLM — see `POST /nutrition/estimate` for that step.
    """
    # Cross-reference with USDA data to enrich stored metadata (best-effort).
    usda_refs = []
    try:
        usda_refs = usda_service.cross_reference_meal(db, body.raw_text)
    except Exception as e:  # noqa: BLE001
        log.debug("USDA cross-reference skipped: %s", e)

    micros_data: dict[str, Any] = dict(body.micros or {})
    if body.confidence:
        micros_data["confidence"] = body.confidence
    if body.notes:
        micros_data["notes"] = body.notes
    if body.items:
        micros_data["items"] = [item.model_dump() for item in body.items]
    if usda_refs:
        micros_data["usda_refs"] = [
            {"fdc_id": r["fdc_id"], "matched": r["matched"]} for r in usda_refs
        ]

    entry = NutritionLog(
        day=body.day or athlete_today(),
        meal=body.meal,
        raw_text=body.raw_text,
        kcal=body.kcal,
        protein_g=body.protein_g,
        carbs_g=body.carbs_g,
        fat_g=body.fat_g,
        fiber_g=body.fiber_g,
        micros=micros_data or None,
        estimated_by=f"{body.estimated_by}+usda" if usda_refs else body.estimated_by,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return NutritionLogOut.model_validate(entry, from_attributes=True)


@router.get("/log", response_model=list[NutritionLogOut])
def list_logs(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
) -> list[NutritionLogOut]:
    end = athlete_today()
    start = end - timedelta(days=days - 1)
    rows = db.scalars(
        select(NutritionLog)
        .where(and_(NutritionLog.day >= start, NutritionLog.day <= end))
        .order_by(NutritionLog.logged_at.desc())
    ).all()
    return [NutritionLogOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/totals/{day}", response_model=NutritionDayTotals)
def day_totals(day: Date, db: Session = Depends(get_db)) -> NutritionDayTotals:
    rows = db.scalars(select(NutritionLog).where(NutritionLog.day == day)).all()
    micros: dict[str, float] = {}
    for r in rows:
        if not r.micros:
            continue
        for k, v in r.micros.items():
            if isinstance(v, (int, float)):
                micros[k] = micros.get(k, 0.0) + float(v)
    return NutritionDayTotals(
        day=day,
        kcal=sum(r.kcal or 0 for r in rows),
        protein_g=sum(r.protein_g or 0 for r in rows),
        carbs_g=sum(r.carbs_g or 0 for r in rows),
        fat_g=sum(r.fat_g or 0 for r in rows),
        fiber_g=sum(r.fiber_g or 0 for r in rows),
        micros=micros,
        entry_count=len(rows),
    )


@router.delete("/log/{entry_id}", status_code=204)
def delete_log(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(NutritionLog, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    db.delete(entry)
    db.commit()
