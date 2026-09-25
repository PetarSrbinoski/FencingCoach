"""Nutrition logging endpoints."""

from __future__ import annotations

import logging
from datetime import date as Date
from datetime import timedelta
from functools import partial
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.agents.nutrition import estimate_nutrition
from app.core.clock import athlete_today
from app.core.database import get_db
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
from app.services.generation import submit_generation

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
        micros={k: v for k, v in (row.micros or {}).items() if type(v) in (int, float)},
        items=[NutritionEstimateItemOut(**item) for item in (row.items or [])],
        confidence=row.confidence,
        notes=row.notes or "",
        incomplete_micros=(row.micros or {}).get("incomplete_micros", []),
        estimated_by=(row.micros or {}).get("estimated_by", "agent"),
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
    """Kick off macro estimation and return immediately (runs in the
    background); poll `GET /nutrition/estimate/{id}`.
    Does NOT persist as a logged meal — confirm via `POST /nutrition/log`.
    """
    row = NutritionEstimate(raw_text=body.text, status="pending")
    submit_generation(db, background_tasks, row, partial(_estimate_values, text=body.text))

    return NutritionEstimateAccepted(id=row.id)


async def _estimate_values(db: Session, *, text: str) -> dict[str, Any]:
    est = await estimate_nutrition(text, db=db)
    return {
        "kcal": est.kcal,
        "protein_g": est.protein_g,
        "carbs_g": est.carbs_g,
        "fat_g": est.fat_g,
        "fiber_g": est.fiber_g,
        "micros": {
            **est.micros.model_dump(exclude_none=True),
            "incomplete_micros": est.incomplete_micros,
            "estimated_by": est.estimated_by,
        },
        "items": [item.model_dump() for item in est.items],
        "confidence": est.confidence,
        "notes": est.notes,
    }


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
    micros_data["incomplete_micros"] = body.incomplete_micros
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
            if type(v) in (int, float):
                micros[k] = micros.get(k, 0.0) + float(v)
    incomplete = [
        key for key in micros
        if any(
            type((row.micros or {}).get(key)) not in (int, float)
            or key in (row.micros or {}).get("incomplete_micros", [])
            for row in rows
        )
    ]
    return NutritionDayTotals(
        day=day,
        kcal=sum(r.kcal or 0 for r in rows),
        protein_g=sum(r.protein_g or 0 for r in rows),
        carbs_g=sum(r.carbs_g or 0 for r in rows),
        fat_g=sum(r.fat_g or 0 for r in rows),
        fiber_g=sum(r.fiber_g or 0 for r in rows),
        micros=micros,
        entry_count=len(rows),
        incomplete_micros=sorted(incomplete),
    )


@router.delete("/log/{entry_id}", status_code=204)
def delete_log(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(NutritionLog, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    db.delete(entry)
    db.commit()
