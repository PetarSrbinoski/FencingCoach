"""Training: adaptive gym session + workout logging + progress."""

from __future__ import annotations

from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models import WorkoutLog
from app.schemas import (
    ExerciseProgress,
    TrainingSessionOut,
    WorkoutLogCreate,
    WorkoutLogOut,
)
from app.services.training import (
    THU_TEMPLATE,
    TUE_TEMPLATE,
    build_session,
    detect_plateau,
    epley_1rm,
)

router = APIRouter(prefix="/training", tags=["training"])


# ── session ───────────────────────────────────────────────────────────
@router.get("/today", response_model=TrainingSessionOut)
def session_today(
    _user: CurrentUser, db: Session = Depends(get_db)
) -> TrainingSessionOut:
    return TrainingSessionOut(**build_session(db))


@router.get("/session/{day}", response_model=TrainingSessionOut)
def session_for_day(
    day: Date, _user: CurrentUser, db: Session = Depends(get_db)
) -> TrainingSessionOut:
    return TrainingSessionOut(**build_session(db, day))


@router.get("/exercises", response_model=list[str])
def exercises(_user: CurrentUser) -> list[str]:
    """All exercises the system knows from the default templates."""
    seen: list[str] = []
    for tpl in (TUE_TEMPLATE, THU_TEMPLATE):
        for item in tpl:
            if item["exercise"] not in seen:
                seen.append(item["exercise"])
    return seen


# ── workout logging ───────────────────────────────────────────────────
@router.post("/log", response_model=WorkoutLogOut)
def log_set(
    body: WorkoutLogCreate, _user: CurrentUser, db: Session = Depends(get_db)
) -> WorkoutLogOut:
    entry = WorkoutLog(
        day=body.day or Date.today(),
        exercise=body.exercise.strip(),
        set_number=body.set_number,
        reps=body.reps,
        weight_kg=body.weight_kg,
        rpe=body.rpe,
        notes=body.notes,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return WorkoutLogOut.model_validate(entry, from_attributes=True)


@router.get("/log", response_model=list[WorkoutLogOut])
def list_log(
    _user: CurrentUser,
    days: int = Query(14, ge=1, le=365),
    exercise: str | None = None,
    db: Session = Depends(get_db),
) -> list[WorkoutLogOut]:
    end = Date.today()
    start = end - timedelta(days=days - 1)
    stmt = select(WorkoutLog).where(
        and_(WorkoutLog.day >= start, WorkoutLog.day <= end)
    )
    if exercise:
        stmt = stmt.where(WorkoutLog.exercise == exercise)
    rows = db.scalars(stmt.order_by(WorkoutLog.day.desc(), WorkoutLog.set_number)).all()
    return [WorkoutLogOut.model_validate(r, from_attributes=True) for r in rows]


@router.delete("/log/{entry_id}", status_code=204)
def delete_log(entry_id: int, _user: CurrentUser, db: Session = Depends(get_db)):
    entry = db.get(WorkoutLog, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    db.delete(entry)
    db.commit()


# ── progressive overload ──────────────────────────────────────────────
@router.get("/progress/{exercise}", response_model=ExerciseProgress)
def progress(
    exercise: str,
    _user: CurrentUser,
    days: int = Query(180, ge=14, le=730),
    db: Session = Depends(get_db),
) -> ExerciseProgress:
    end = Date.today()
    start = end - timedelta(days=days)
    rows = db.scalars(
        select(WorkoutLog)
        .where(
            and_(
                WorkoutLog.exercise == exercise,
                WorkoutLog.day >= start,
                WorkoutLog.weight_kg.is_not(None),
                WorkoutLog.reps.is_not(None),
            )
        )
        .order_by(WorkoutLog.day, WorkoutLog.set_number)
    ).all()

    # Best estimated 1RM per day
    best_by_day: dict[Date, dict] = {}
    for r in rows:
        est = epley_1rm(float(r.weight_kg), int(r.reps))
        if est is None:
            continue
        cur = best_by_day.get(r.day)
        if cur is None or est > cur["est_1rm"]:
            best_by_day[r.day] = {
                "day": r.day.isoformat(),
                "est_1rm": round(est, 1),
                "weight_kg": float(r.weight_kg),
                "reps": int(r.reps),
            }
    points = [best_by_day[d] for d in sorted(best_by_day)]
    return ExerciseProgress(
        exercise=exercise,
        points=points,
        plateau=detect_plateau(db, exercise),
    )
