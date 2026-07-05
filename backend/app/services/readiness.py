"""Readiness — uses Garmin's own `training_readiness` as the single source
of truth (no custom composite scorer). Missing data is surfaced honestly as
`band="unknown"` rather than guessed; bands are red <40, amber 40-65, green
>65, matching Garmin's convention.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import Activity, GarminMetric

BAND_RED_MAX = 40.0
BAND_AMBER_MAX = 65.0


@dataclass
class Advisory:
    detail: str
    value: float | None = None


@dataclass
class Readiness:
    day: date
    score: float | None  # Garmin training_readiness 0..100; None if missing
    band: str  # "red" | "amber" | "green" | "unknown"
    source: str  # "garmin" | "neutral" (no reading available)
    advisories: dict[str, Advisory]
    inputs: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day.isoformat(),
            "score": round(self.score, 1) if self.score is not None else None,
            "band": self.band,
            "source": self.source,
            "advisories": {k: asdict(v) for k, v in self.advisories.items()},
            "inputs": self.inputs,
        }


# ── helpers ───────────────────────────────────────────────────────────
def _values(db: Session, kind: str, start: date, end: date) -> list[tuple[date, float]]:
    rows = db.execute(
        select(GarminMetric.day, GarminMetric.value)
        .where(
            and_(
                GarminMetric.kind == kind,
                GarminMetric.day >= start,
                GarminMetric.day <= end,
                GarminMetric.value.is_not(None),
            )
        )
        .order_by(GarminMetric.day)
    ).all()
    return [(d, float(v)) for d, v in rows]


def _last(values: list[tuple[date, float]]) -> float | None:
    return values[-1][1] if values else None


def band_for_score(score: float) -> str:
    """Map a Garmin training_readiness 0..100 value to red/amber/green."""
    if score < BAND_RED_MAX:
        return "red"
    if score <= BAND_AMBER_MAX:
        return "amber"
    return "green"


# ── advisories (informational only — not part of score/band) ──────────
def _advise_load(db: Session, day: date) -> Advisory:
    """Acute (7d) vs chronic (28d) training load ratio — informational only."""
    rows_acute = db.execute(
        select(Activity.training_load).where(
            and_(
                Activity.start_time >= day - timedelta(days=7),
                Activity.start_time <= day,
            )
        )
    ).all()
    rows_chronic = db.execute(
        select(Activity.training_load).where(
            and_(
                Activity.start_time >= day - timedelta(days=28),
                Activity.start_time <= day,
            )
        )
    ).all()

    a_sum = sum(float(r[0] or 0.0) for r in rows_acute)
    c_sum = sum(float(r[0] or 0.0) for r in rows_chronic)
    a_avg = a_sum / 7.0 if a_sum else 0.0
    c_avg = c_sum / 28.0 if c_sum else 0.0

    if c_avg <= 0:
        return Advisory(detail="Insufficient load history to compute acute:chronic ratio")
    ratio = a_avg / c_avg
    if ratio > 1.5:
        note = "overreaching — acute load well above chronic average"
    elif ratio < 0.5:
        note = "detraining risk — acute load well below chronic average"
    else:
        note = "within normal range"
    return Advisory(
        detail=f"A:C load ratio {ratio:.2f} (acute {a_avg:.0f} / chronic {c_avg:.0f}) — {note}",
        value=round(ratio, 2),
    )


def _advise_rest(db: Session, day: date) -> Advisory:
    """Consecutive training days without a rest day — informational only."""
    rows = db.execute(
        select(Activity.start_time)
        .where(Activity.start_time <= day)
        .order_by(Activity.start_time.desc())
        .limit(14)
    ).all()
    activity_days = {r[0].date() for r in rows} if rows else set()
    if not activity_days:
        return Advisory(detail="No recent activity history")

    days_since_rest = 0
    cur = day
    while cur in activity_days and days_since_rest < 14:
        days_since_rest += 1
        cur = cur - timedelta(days=1)

    if days_since_rest >= 5:
        note = "consider a rest day soon"
    else:
        note = "within normal range"
    return Advisory(
        detail=f"{days_since_rest} consecutive training day(s) — {note}",
        value=float(days_since_rest),
    )


# ── public api ────────────────────────────────────────────────────────
def compute_readiness(db: Session, day: date | None = None) -> Readiness:
    day = day or athlete_today()

    raw = _last(_values(db, "training_readiness", day, day))
    if raw is None:
        score, band, source = None, "unknown", "neutral"
    else:
        score, band, source = raw, band_for_score(raw), "garmin"

    advisories = {
        "load": _advise_load(db, day),
        "rest": _advise_rest(db, day),
    }
    inputs = {
        "hrv_today": _last(_values(db, "hrv", day, day)),
        "sleep_h": _last(_values(db, "sleep", day, day)),
        "body_battery_max": _last(_values(db, "body_battery", day - timedelta(days=1), day)),
        "rhr": _last(_values(db, "resting_hr", day, day)),
    }
    return Readiness(
        day=day,
        score=score,
        band=band,
        source=source,
        advisories=advisories,
        inputs=inputs,
    )
