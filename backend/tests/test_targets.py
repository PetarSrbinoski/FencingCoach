"""Tests for day-type detection, in particular the MMA→fencing reconciliation."""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.models import Activity
from app.services.targets import detect_day_type


def _mon(week_offset: int = 0) -> date:
    """A Monday (default weekday pattern: fencing)."""
    d = date(2026, 7, 6)  # a Monday
    return d


def _tue() -> date:
    return date(2026, 7, 7)  # Tuesday -> default gym


def test_default_pattern_no_activities(db):
    day_type, source = detect_day_type(db, _mon())
    assert day_type == "fencing"
    assert source == "auto"


def test_gym_day_upgraded_to_double_by_logged_mma_activity(db):
    """Garmin logs fencing as MMA — this must upgrade a gym day to 'double'."""
    day = _tue()
    db.add(
        Activity(
            activity_type="mma",
            start_time=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            source="garmin",
        )
    )
    db.commit()
    day_type, source = detect_day_type(db, day)
    assert day_type == "double"
    assert source == "auto"


def test_fencing_day_upgraded_to_double_by_strength_activity(db):
    day = _mon()
    db.add(
        Activity(
            activity_type="strength_training",
            start_time=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            source="garmin",
        )
    )
    db.commit()
    day_type, source = detect_day_type(db, day)
    assert day_type == "double"
    assert source == "auto"


def test_unrelated_activity_type_does_not_change_day_type(db):
    day = _mon()
    db.add(
        Activity(
            activity_type="walking",
            start_time=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            source="garmin",
        )
    )
    db.commit()
    day_type, source = detect_day_type(db, day)
    assert day_type == "fencing"
    assert source == "auto"
