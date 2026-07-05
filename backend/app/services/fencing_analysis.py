"""Fencing-session analysis — per-session HR-zone characterization and
training-load trends. Garmin only returns session-level avg/max HR (no
per-minute breakdown), so sessions are zoned by avg/max rather than a
fabricated time-in-zone figure.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import Activity, AthleteProfile
from app.services.activity_types import is_fencing

# Standard 5-zone %HRmax bands (lower bound inclusive, upper bound exclusive).
ZONE_BOUNDS: list[tuple[str, float, float]] = [
    ("Z1", 0.50, 0.60),
    ("Z2", 0.60, 0.70),
    ("Z3", 0.70, 0.80),
    ("Z4", 0.80, 0.90),
    ("Z5", 0.90, 1.5),
]

# A trend is only reported once there are enough sessions to split into
# a meaningful early/recent comparison; below this, say so explicitly.
MIN_SESSIONS_FOR_TREND = 6
TREND_THRESHOLD = 0.15  # +/-15% average load change


@dataclass
class SessionAnalysis:
    activity_id: int
    day: date
    duration_min: float | None
    avg_hr: int | None
    max_hr: int | None
    avg_hr_zone: str | None
    max_hr_zone: str | None
    training_load: float | None
    calories: int | None


@dataclass
class FencingAnalysis:
    window_days: int
    session_count: int
    max_hr_estimate: float | None
    max_hr_source: str
    sessions: list[SessionAnalysis]
    avg_duration_min: float | None
    avg_training_load: float | None
    weekly_session_counts: dict[str, int]  # ISO week-start date -> session count
    training_load_trend: str  # "increasing" | "decreasing" | "stable" | "insufficient_data"


def _estimate_max_hr(db: Session, fencing_activities: list[Activity]) -> tuple[float | None, str]:
    """Best-effort max HR estimate, plus how it was derived (for transparency)."""
    profile = db.scalar(select(AthleteProfile).limit(1))
    if profile and profile.age:
        # Tanaka et al. 2001 (208 - 0.7*age) — better-fit than the crude
        # "220 minus age" rule of thumb, especially for trained adults.
        return 208.0 - 0.7 * profile.age, f"Tanaka formula (age {profile.age})"
    observed = [a.max_hr for a in fencing_activities if a.max_hr]
    if observed:
        return float(max(observed)), "highest observed max HR in window"
    return None, "unavailable (set athlete age in profile for an estimate)"


def _zone_for(hr: float | None, max_hr: float | None) -> str | None:
    if hr is None or not max_hr:
        return None
    pct = hr / max_hr
    if pct < ZONE_BOUNDS[0][1]:
        return "below Z1"
    for name, lo, hi in ZONE_BOUNDS:
        if lo <= pct < hi:
            return name
    return "Z5+"


def _trend(loads: list[float]) -> str:
    """Compare the average load of the most recent third of sessions to the
    earliest third (loads must already be in chronological order)."""
    if len(loads) < MIN_SESSIONS_FOR_TREND:
        return "insufficient_data"
    third = len(loads) // 3
    early_avg = sum(loads[:third]) / third
    recent_avg = sum(loads[-third:]) / third
    if early_avg <= 0:
        return "insufficient_data"
    delta = (recent_avg - early_avg) / early_avg
    if delta > TREND_THRESHOLD:
        return "increasing"
    if delta < -TREND_THRESHOLD:
        return "decreasing"
    return "stable"


def analyze_fencing_sessions(
    db: Session, window_days: int = 90, today: date | None = None
) -> FencingAnalysis:
    today = today or athlete_today()
    start = datetime.combine(
        today - timedelta(days=window_days - 1),
        datetime.min.time(),
        tzinfo=UTC,
    )
    end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=UTC)

    rows = db.scalars(
        select(Activity)
        .where(and_(Activity.start_time >= start, Activity.start_time < end))
        .order_by(Activity.start_time)
    ).all()
    fencing = [a for a in rows if is_fencing(a.activity_type)]

    max_hr, max_hr_source = _estimate_max_hr(db, fencing)

    sessions: list[SessionAnalysis] = []
    weekly_counts: dict[str, int] = {}
    for a in fencing:
        day = a.start_time.date()
        week_start = (day - timedelta(days=day.weekday())).isoformat()
        weekly_counts[week_start] = weekly_counts.get(week_start, 0) + 1

        sessions.append(
            SessionAnalysis(
                activity_id=a.id,
                day=day,
                duration_min=round(a.duration_s / 60.0, 1) if a.duration_s else None,
                avg_hr=a.avg_hr,
                max_hr=a.max_hr,
                avg_hr_zone=_zone_for(a.avg_hr, max_hr),
                max_hr_zone=_zone_for(a.max_hr, max_hr),
                training_load=a.training_load,
                calories=a.calories,
            )
        )

    durations = [s.duration_min for s in sessions if s.duration_min is not None]
    loads = [s.training_load for s in sessions if s.training_load is not None]

    return FencingAnalysis(
        window_days=window_days,
        session_count=len(sessions),
        max_hr_estimate=max_hr,
        max_hr_source=max_hr_source,
        sessions=sessions,
        avg_duration_min=round(sum(durations) / len(durations), 1) if durations else None,
        avg_training_load=round(sum(loads) / len(loads), 1) if loads else None,
        weekly_session_counts=weekly_counts,
        training_load_trend=_trend(loads),
    )
