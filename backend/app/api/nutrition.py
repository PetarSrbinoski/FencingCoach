"""Nutrition logging endpoints."""

from __future__ import annotations

import logging
from copy import deepcopy
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
    NutritionLogEdit,
    NutritionLogOut,
    NutritionLogRepeat,
)
from app.services import usda as usda_service
from app.services.generation import cancel_generation, submit_generation

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


@router.post("/estimate/{estimate_id}/cancel", response_model=NutritionEstimateOut)
async def cancel_estimate(estimate_id: int, db: Session = Depends(get_db)) -> NutritionEstimateOut:
    row = db.get(NutritionEstimate, estimate_id)
    if row is None:
        raise HTTPException(404, "estimate not found")
    await cancel_generation(db, row)
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
    day: Date | None = None,
    db: Session = Depends(get_db),
) -> list[NutritionLogOut]:
    if day is not None:
        condition = NutritionLog.day == day
    else:
        end = athlete_today()
        start = end - timedelta(days=days - 1)
        condition = and_(NutritionLog.day >= start, NutritionLog.day <= end)
    rows = db.scalars(select(NutritionLog).where(condition).order_by(NutritionLog.logged_at.desc())).all()
    return [NutritionLogOut.model_validate(r, from_attributes=True) for r in rows]


@router.put("/log/{entry_id}", response_model=NutritionLogOut)
def edit_log(entry_id: int, body: NutritionLogEdit, db: Session = Depends(get_db)) -> NutritionLogOut:
    entry = db.scalar(select(NutritionLog).where(NutritionLog.id == entry_id).with_for_update())
    if entry is None:
        raise HTTPException(404, "entry not found; refresh the diary")
    if entry.version != body.expected_version:
        raise HTTPException(409, "entry changed since editing began; refresh before saving")
    nutrients = ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")
    changed_nutrients = any(getattr(entry, key) != getattr(body, key) for key in nutrients)
    for key, value in body.model_dump(exclude={"expected_version"}).items():
        setattr(entry, key, value)
    if changed_nutrients:
        meta = dict(entry.micros or {})
        meta["totals_edited"] = True
        entry.micros = meta
        entry.estimated_by = "manual"
    entry.version += 1
    db.commit()
    db.refresh(entry)
    return NutritionLogOut.model_validate(entry, from_attributes=True)


def _is_nutrient_key(key: str) -> bool:
    return key == "kcal" or key.casefold().endswith(("_g", "_mg", "_mcg", "_iu"))


def _scaled_snapshot(micros: dict[str, Any] | None, multiplier: float) -> dict[str, Any]:
    result = deepcopy(micros or {})
    for key, value in result.items():
        if _is_nutrient_key(key) and type(value) in (int, float):
            result[key] = round(value * multiplier, 3)
    for item in result.get("items", []):
        if not isinstance(item, dict):
            continue
        if type(item.get("qty_g")) in (int, float):
            item["qty_g"] = round(item["qty_g"] * multiplier, 3)
        for key, value in item.get("nutrients", {}).items():
            if _is_nutrient_key(key) and type(value) in (int, float):
                item["nutrients"][key] = round(value * multiplier, 3)
    return result


@router.post("/log/{entry_id}/repeat", response_model=NutritionLogOut, status_code=201)
def repeat_log(entry_id: int, body: NutritionLogRepeat, db: Session = Depends(get_db)) -> NutritionLogOut:
    previous = db.scalar(select(NutritionLog).where(NutritionLog.repeat_request_id == body.request_id))
    if previous is not None:
        meta = previous.micros or {}
        if (meta.get("repeat_source_id") != entry_id or previous.day != body.day
                or previous.meal != body.meal or meta.get("repeat_multiplier") != body.multiplier):
            raise HTTPException(409, "repeat request was already used for a different copy")
        return NutritionLogOut.model_validate(previous, from_attributes=True)
    source = db.get(NutritionLog, entry_id)
    if source is None:
        raise HTTPException(404, "source meal not found")
    meta = _scaled_snapshot(source.micros, body.multiplier)
    meta["repeat_source_id"] = source.id
    meta["repeat_multiplier"] = body.multiplier
    copy = NutritionLog(
        day=body.day,
        meal=body.meal,
        raw_text=source.raw_text,
        micros=meta,
        estimated_by="repeat",
        repeat_request_id=body.request_id,
        **{key: round(getattr(source, key) * body.multiplier, 3)
           if getattr(source, key) is not None else None
           for key in ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")},
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return NutritionLogOut.model_validate(copy, from_attributes=True)


@router.get("/totals/{day}", response_model=NutritionDayTotals)
def day_totals(day: Date, db: Session = Depends(get_db)) -> NutritionDayTotals:
    rows = db.scalars(select(NutritionLog).where(NutritionLog.day == day)).all()
    micros: dict[str, float] = {}
    for r in rows:
        if not r.micros:
            continue
        for k, v in r.micros.items():
            if _is_nutrient_key(k) and type(v) in (int, float):
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
