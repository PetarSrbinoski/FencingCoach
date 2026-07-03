"""Tests for fencing-session analysis (HR zone estimate, duration, load trend)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.models import Activity, AthleteProfile
from app.services.fencing_analysis import (
    ZONE_BOUNDS,
    _trend,
    _zone_for,
    analyze_fencing_sessions,
)

TODAY = date(2026, 7, 3)


def _fencing_activity(db, day: date, avg_hr=None, max_hr=None, duration_s=None, load=None):
    a = Activity(
        activity_type="mma",  # Garmin logs fencing as MMA
        start_time=datetime.combine(day, datetime.min.time(), tzinfo=UTC),
        source="garmin",
        avg_hr=avg_hr,
        max_hr=max_hr,
        duration_s=duration_s,
        training_load=load,
    )
    db.add(a)
    return a


def _non_fencing_activity(db, day: date):
    a = Activity(
        activity_type="strength_training",
        start_time=datetime.combine(day, datetime.min.time(), tzinfo=UTC),
        source="garmin",
    )
    db.add(a)
    return a


# ── zone classification ──────────────────────────────────────────────────
def test_zone_for_none_inputs():
    assert _zone_for(None, 180) is None
    assert _zone_for(150, None) is None
    assert _zone_for(150, 0) is None


def test_zone_boundaries():
    max_hr = 190
    assert _zone_for(0.55 * max_hr, max_hr) == "Z1"
    assert _zone_for(0.65 * max_hr, max_hr) == "Z2"
    assert _zone_for(0.75 * max_hr, max_hr) == "Z3"
    assert _zone_for(0.85 * max_hr, max_hr) == "Z4"
    assert _zone_for(0.95 * max_hr, max_hr) == "Z5"
    assert _zone_for(0.40 * max_hr, max_hr) == "below Z1"


def test_all_zone_bounds_are_contiguous():
    # Sanity check on the static table itself.
    for i in range(1, len(ZONE_BOUNDS)):
        assert ZONE_BOUNDS[i - 1][2] == ZONE_BOUNDS[i][1]


# ── trend ─────────────────────────────────────────────────────────────
def test_trend_insufficient_data_below_minimum():
    assert _trend([100, 100, 100]) == "insufficient_data"


def test_trend_increasing():
    loads = [50.0, 50.0, 50.0, 90.0, 90.0, 90.0]
    assert _trend(loads) == "increasing"


def test_trend_decreasing():
    loads = [90.0, 90.0, 90.0, 50.0, 50.0, 50.0]
    assert _trend(loads) == "decreasing"


def test_trend_stable():
    loads = [80.0, 82.0, 79.0, 81.0, 80.0, 78.0]
    assert _trend(loads) == "stable"


# ── analyze_fencing_sessions ────────────────────────────────────────────
def test_only_fencing_activities_counted(db):
    _fencing_activity(db, TODAY, avg_hr=150, max_hr=175, duration_s=7200, load=120)
    _non_fencing_activity(db, TODAY)
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.session_count == 1
    assert result.sessions[0].activity_id is not None


def test_max_hr_from_profile_age_uses_tanaka_formula(db):
    db.add(AthleteProfile(age=30))
    _fencing_activity(db, TODAY, avg_hr=150, max_hr=175, duration_s=7200, load=100)
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.max_hr_estimate == 208.0 - 0.7 * 30
    assert "Tanaka" in result.max_hr_source


def test_max_hr_falls_back_to_observed_max_without_profile_age(db):
    _fencing_activity(db, TODAY, avg_hr=150, max_hr=180, duration_s=7200, load=100)
    _fencing_activity(
        db, TODAY - timedelta(days=2), avg_hr=140, max_hr=170, duration_s=7200, load=90
    )
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.max_hr_estimate == 180.0
    assert "observed" in result.max_hr_source


def test_max_hr_unavailable_with_no_data(db):
    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.max_hr_estimate is None
    assert result.session_count == 0


def test_duration_and_load_averages(db):
    _fencing_activity(db, TODAY, avg_hr=150, max_hr=175, duration_s=7200, load=100)
    _fencing_activity(
        db, TODAY - timedelta(days=2), avg_hr=140, max_hr=165, duration_s=3600, load=80
    )
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.avg_duration_min == 90.0  # (120 + 60) / 2
    assert result.avg_training_load == 90.0  # (100 + 80) / 2


def test_weekly_session_counts_grouped_by_iso_week_start(db):
    monday = date(2026, 6, 29)
    _fencing_activity(db, monday, load=100)
    _fencing_activity(db, monday + timedelta(days=2), load=100)  # same week (Wed)
    _fencing_activity(db, monday + timedelta(days=8), load=100)  # next week
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=monday + timedelta(days=10))
    assert result.weekly_session_counts[monday.isoformat()] == 2
    assert result.weekly_session_counts[(monday + timedelta(days=7)).isoformat()] == 1


def test_window_days_excludes_older_sessions(db):
    _fencing_activity(db, TODAY - timedelta(days=100), load=100)
    db.commit()

    result = analyze_fencing_sessions(db, window_days=30, today=TODAY)
    assert result.session_count == 0
