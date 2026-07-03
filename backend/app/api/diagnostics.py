"""Garmin data-coverage diagnostics endpoint."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import DiagnosticsResponse, MetricDiagnosticOut
from app.services.diagnostics import compute_diagnostics

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("", response_model=DiagnosticsResponse)
def diagnostics(
    window_days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> DiagnosticsResponse:
    metrics = compute_diagnostics(db, window_days=window_days)
    return DiagnosticsResponse(
        generated_at=datetime.now(timezone.utc),
        window_days=window_days,
        metrics=[
            MetricDiagnosticOut(
                kind=m.kind,
                last_ok_day=m.last_ok_day,
                last_ok_value=m.last_ok_value,
                last_fetched_at=m.last_fetched_at,
                coverage_days=m.coverage_days,
                window_days=m.window_days,
                days_since_ok=m.days_since_ok,
                stale=m.stale,
            )
            for m in metrics
        ],
    )
