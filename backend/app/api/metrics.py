"""Time-series metric endpoints for charts."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.database import get_db
from app.models import GarminMetric
from app.schemas import MetricPoint, MetricSeries

router = APIRouter(prefix="/metrics", tags=["metrics"])

ALLOWED_KINDS = {
    "hrv",
    "hrv_weekly",
    "sleep",
    "sleep_score",
    "body_battery",
    "stress_daily",
    "resting_hr",
    "steps",
    "calories",
    "vo2max",
    "training_readiness",
}


@router.get("/{kind}", response_model=MetricSeries)
def series(
    kind: str,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> MetricSeries:
    if kind not in ALLOWED_KINDS:
        return MetricSeries(kind=kind, points=[])
    end = athlete_today()
    start = end - timedelta(days=days - 1)
    rows = db.execute(
        select(GarminMetric.day, GarminMetric.value)
        .where(
            and_(
                GarminMetric.kind == kind,
                GarminMetric.day >= start,
                GarminMetric.day <= end,
            )
        )
        .order_by(GarminMetric.day)
    ).all()
    return MetricSeries(
        kind=kind,
        points=[
            MetricPoint(day=d, value=(float(v) if v is not None else None))
            for d, v in rows
        ],
    )
