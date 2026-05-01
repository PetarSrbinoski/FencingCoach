"""Readiness scoring.

Composite 0-100 score from Garmin metrics, blended with the athlete's
own rolling baselines. Designed to be transparent: each component score
and its weight are returned alongside the final score so the LLM (and the
UI) can show *why* the day looks the way it does.

Composition (default weights):
    HRV trend vs 28-day baseline      35%
    Sleep duration & efficiency       25%
    Body Battery (yesterday's max)    15%
    Recent training load (acute:chronic) 15%
    Days since last rest day          10%

Output domain: 0..100. Bands: red <40, amber 40-65, green >65.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import Activity, GarminMetric


# ── tunables ──────────────────────────────────────────────────────────
WEIGHTS = {
    "hrv": 0.35,
    "sleep": 0.25,
    "body_battery": 0.15,
    "load": 0.15,
    "rest": 0.10,
}
SLEEP_TARGET_H = 8.0
SLEEP_FLOOR_H = 5.0


@dataclass
class Component:
    score: float  # 0..100
    weight: float
    detail: str


@dataclass
class Readiness:
    day: date
    score: float  # 0..100
    band: str  # red|amber|green
    components: dict[str, Component]
    inputs: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day.isoformat(),
            "score": round(self.score, 1),
            "band": self.band,
            "components": {k: asdict(v) for k, v in self.components.items()},
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


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _last(values: list[tuple[date, float]]) -> float | None:
    return values[-1][1] if values else None


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


# ── component scorers ─────────────────────────────────────────────────
def _score_hrv(db: Session, day: date) -> Component:
    """Today's HRV vs 28-day rolling mean. ±15% maps to ±50 points around 70."""
    today_vals = _values(db, "hrv", day, day)
    today = _last(today_vals)
    baseline_vals = [
        v
        for _, v in _values(
            db, "hrv", day - timedelta(days=28), day - timedelta(days=1)
        )
    ]
    baseline = _mean(baseline_vals)

    if today is None or baseline is None or baseline == 0:
        return Component(
            score=60.0,
            weight=WEIGHTS["hrv"],
            detail="HRV baseline insufficient — neutral 60",
        )
    delta = (today - baseline) / baseline
    score = _clamp(70 + delta * 200)  # +15% → 100, -15% → 40
    return Component(
        score=score,
        weight=WEIGHTS["hrv"],
        detail=f"HRV {today:.0f} vs {baseline:.0f} baseline ({delta * 100:+.1f}%)",
    )


def _score_sleep(db: Session, day: date) -> Component:
    """Last night's sleep hours toward 8h. Linear under floor."""
    hours = _last(_values(db, "sleep", day, day))
    if hours is None:
        return Component(
            score=55.0, weight=WEIGHTS["sleep"], detail="No sleep data — neutral 55"
        )
    if hours >= SLEEP_TARGET_H:
        score = 100.0
    elif hours <= SLEEP_FLOOR_H:
        score = 25.0
    else:
        score = 25 + (hours - SLEEP_FLOOR_H) / (SLEEP_TARGET_H - SLEEP_FLOOR_H) * 75
    return Component(
        score=_clamp(score),
        weight=WEIGHTS["sleep"],
        detail=f"{hours:.1f}h sleep",
    )


def _score_body_battery(db: Session, day: date) -> Component:
    bb = _last(_values(db, "body_battery", day - timedelta(days=1), day))
    if bb is None:
        return Component(
            score=60.0,
            weight=WEIGHTS["body_battery"],
            detail="No Body Battery — neutral 60",
        )
    # BB max already 0..100 ⇒ use directly with mild floor at 30
    score = _clamp(max(bb, 30.0))
    return Component(
        score=score, weight=WEIGHTS["body_battery"], detail=f"Body Battery max {bb:.0f}"
    )


def _score_load(db: Session, day: date) -> Component:
    """Acute (last 7d) vs chronic (last 28d) training load.

    Sweet spot 0.8-1.3 → 80+. Above 1.5 (overreach) drops fast. Below 0.5
    (detraining-ish) softer drop.
    """
    acute = db.scalar(
        select(Activity.training_load).where(
            and_(
                Activity.start_time >= day - timedelta(days=7),
                Activity.start_time <= day,
            )
        )
    )
    # SQLAlchemy will return only the first; we want the sum.
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
        return Component(
            score=60.0,
            weight=WEIGHTS["load"],
            detail="Insufficient load history — neutral 60",
        )
    ratio = a_avg / c_avg
    # Gaussian-ish around 1.0
    score = 100 * math.exp(-((ratio - 1.0) ** 2) / 0.25)
    return Component(
        score=_clamp(score),
        weight=WEIGHTS["load"],
        detail=f"A:C load ratio {ratio:.2f} (acute {a_avg:.0f} / chronic {c_avg:.0f})",
    )


def _score_rest(db: Session, day: date) -> Component:
    """Days since last rest day (no activities). 1-2 days great, 5+ poor."""
    rows = db.execute(
        select(Activity.start_time)
        .where(Activity.start_time <= day)
        .order_by(Activity.start_time.desc())
        .limit(14)
    ).all()
    activity_days = {r[0].date() for r in rows} if rows else set()
    if not activity_days:
        return Component(
            score=70.0, weight=WEIGHTS["rest"], detail="No recent activity history"
        )

    days_since_rest = 0
    cur = day
    while cur in activity_days and days_since_rest < 14:
        days_since_rest += 1
        cur = cur - timedelta(days=1)

    if days_since_rest <= 2:
        score = 100.0
    elif days_since_rest <= 4:
        score = 80.0
    elif days_since_rest <= 6:
        score = 55.0
    else:
        score = 30.0
    return Component(
        score=score,
        weight=WEIGHTS["rest"],
        detail=f"{days_since_rest} consecutive training day(s)",
    )


# ── public api ────────────────────────────────────────────────────────
def compute_readiness(db: Session, day: date | None = None) -> Readiness:
    day = day or date.today()
    components = {
        "hrv": _score_hrv(db, day),
        "sleep": _score_sleep(db, day),
        "body_battery": _score_body_battery(db, day),
        "load": _score_load(db, day),
        "rest": _score_rest(db, day),
    }
    score = sum(c.score * c.weight for c in components.values())
    band = "green" if score > 65 else ("amber" if score >= 40 else "red")

    inputs = {
        "hrv_today": _last(_values(db, "hrv", day, day)),
        "sleep_h": _last(_values(db, "sleep", day, day)),
        "body_battery_max": _last(
            _values(db, "body_battery", day - timedelta(days=1), day)
        ),
        "rhr": _last(_values(db, "resting_hr", day, day)),
    }
    return Readiness(
        day=day, score=score, band=band, components=components, inputs=inputs
    )
