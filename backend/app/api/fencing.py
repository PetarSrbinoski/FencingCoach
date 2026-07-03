"""Fencing-session analysis endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import FencingAnalysisOut, FencingSessionOut
from app.services.fencing_analysis import analyze_fencing_sessions

router = APIRouter(prefix="/fencing", tags=["fencing"])


@router.get("/analysis", response_model=FencingAnalysisOut)
def analysis(
    window_days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
) -> FencingAnalysisOut:
    result = analyze_fencing_sessions(db, window_days=window_days)
    return FencingAnalysisOut(
        window_days=result.window_days,
        session_count=result.session_count,
        max_hr_estimate=result.max_hr_estimate,
        max_hr_source=result.max_hr_source,
        sessions=[
            FencingSessionOut(
                activity_id=s.activity_id,
                day=s.day,
                duration_min=s.duration_min,
                avg_hr=s.avg_hr,
                max_hr=s.max_hr,
                avg_hr_zone=s.avg_hr_zone,
                max_hr_zone=s.max_hr_zone,
                training_load=s.training_load,
                calories=s.calories,
            )
            for s in result.sessions
        ],
        avg_duration_min=result.avg_duration_min,
        avg_training_load=result.avg_training_load,
        weekly_session_counts=result.weekly_session_counts,
        training_load_trend=result.training_load_trend,
    )
