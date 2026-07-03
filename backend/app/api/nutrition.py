"""Nutrition logging endpoints."""

from __future__ import annotations

import logging
from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import NutritionLog
from app.schemas import NutritionDayTotals, NutritionLogCreate, NutritionLogOut
from app.agents.nutrition import estimate_nutrition
from app.services import usda as usda_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


@router.post("/log", response_model=NutritionLogOut)
def log_meal(
    body: NutritionLogCreate,
    db: Session = Depends(get_db),
) -> NutritionLogOut:
    try:
        est = estimate_nutrition(body.text, db=db)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Nutrition estimation failed: {e}") from e

    # Cross-reference with USDA data to improve estimation
    usda_refs = []
    try:
        usda_refs = usda_service.cross_reference_meal(db, body.text)
    except Exception as e:  # noqa: BLE001
        log.debug("USDA cross-reference skipped: %s", e)

    micros_data = {
        **est.micros.model_dump(),
        "items": [item.model_dump() for item in est.items],
        "confidence": est.confidence,
        "notes": est.notes,
    }
    if usda_refs:
        micros_data["usda_refs"] = [
            {"fdc_id": r["fdc_id"], "matched": r["matched"]} for r in usda_refs
        ]

    entry = NutritionLog(
        day=body.day or Date.today(),
        meal=body.meal,
        raw_text=body.text,
        kcal=est.kcal,
        protein_g=est.protein_g,
        carbs_g=est.carbs_g,
        fat_g=est.fat_g,
        fiber_g=est.fiber_g,
        micros=micros_data,
        estimated_by="agent+usda" if usda_refs else "agent",
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
    end = Date.today()
    start = end - timedelta(days=days - 1)
    rows = db.scalars(
        select(NutritionLog)
        .where(and_(NutritionLog.day >= start, NutritionLog.day <= end))
        .order_by(NutritionLog.logged_at.desc())
    ).all()
    return [NutritionLogOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/totals/{day}", response_model=NutritionDayTotals)
def day_totals(
    day: Date, db: Session = Depends(get_db)
) -> NutritionDayTotals:
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
