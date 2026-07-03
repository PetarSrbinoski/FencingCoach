"""Per-metric extraction coverage / staleness diagnostics.

Surfaces the gaps `services.garmin_extract` records (ok / missing /
implausible) so data problems are visible instead of silently degrading
downstream computed numbers (readiness, targets, context, coach grounding).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import GarminMetric
from app.services.garmin_extract import EXTRACTORS

# A metric is considered stale if its last successfully-extracted value is
# older than this many days relative to "today".
STALE_AFTER_DAYS = 3


@dataclass
class MetricDiagnostic:
    kind: str
    last_ok_day: date | None
    last_ok_value: float | None
    last_fetched_at: datetime | None
    coverage_days: int  # count of days in the window with status="ok"
    window_days: int
    days_since_ok: int | None  # None if never successfully extracted
    stale: bool


def compute_diagnostics(
    db: Session, window_days: int = 30, today: date | None = None
) -> list[MetricDiagnostic]:
    """One diagnostic per known metric kind, covering the last `window_days`."""
    today = today or athlete_today()
    start = today - timedelta(days=window_days - 1)

    out: list[MetricDiagnostic] = []
    for kind in EXTRACTORS:
        rows = db.scalars(
            select(GarminMetric)
            .where(
                GarminMetric.kind == kind,
                GarminMetric.day >= start,
                GarminMetric.day <= today,
            )
            .order_by(GarminMetric.day)
        ).all()

        ok_rows = [r for r in rows if r.status == "ok"]
        last_ok = ok_rows[-1] if ok_rows else None
        last_row = rows[-1] if rows else None
        days_since_ok = (today - last_ok.day).days if last_ok else None
        stale = days_since_ok is None or days_since_ok > STALE_AFTER_DAYS

        out.append(
            MetricDiagnostic(
                kind=kind,
                last_ok_day=last_ok.day if last_ok else None,
                last_ok_value=last_ok.value if last_ok else None,
                last_fetched_at=last_row.fetched_at if last_row else None,
                coverage_days=len(ok_rows),
                window_days=window_days,
                days_since_ok=days_since_ok,
                stale=stale,
            )
        )
    return out
