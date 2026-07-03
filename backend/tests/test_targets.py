"""Tests for day-type detection, in particular the MMA→fencing reconciliation."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.models import Activity, AthleteProfile, GarminMetric
from app.services.targets import (
    DEFAULT_WEIGHT_KG,
    FORMULA_KCAL_PER_KG,
    MIN_GARMIN_DAYS_FOR_MAINTENANCE,
    _maintenance_kcal,
    compute_targets,
    detect_day_type,
)


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


# ── maintenance kcal: Garmin rolling avg vs formula fallback ────────────
def _seed_calories(db, day: date, n_days: int, kcal: float, status: str = "ok"):
    for i in range(1, n_days + 1):
        db.add(
            GarminMetric(
                kind="calories",
                day=day - timedelta(days=i),
                value=kcal,
                status=status,
            )
        )
    db.commit()


def test_maintenance_falls_back_to_formula_with_insufficient_garmin_data(db):
    day = date(2026, 7, 8)
    # Fewer than MIN_GARMIN_DAYS_FOR_MAINTENANCE valid days
    _seed_calories(db, day, n_days=MIN_GARMIN_DAYS_FOR_MAINTENANCE - 1, kcal=3000)
    maintenance, source = _maintenance_kcal(db, day, weight=90.0)
    assert maintenance == 90.0 * FORMULA_KCAL_PER_KG
    assert "formula" in source


def test_maintenance_uses_garmin_rolling_average_when_sufficient_data(db):
    day = date(2026, 7, 8)
    _seed_calories(db, day, n_days=MIN_GARMIN_DAYS_FOR_MAINTENANCE + 2, kcal=3200)
    maintenance, source = _maintenance_kcal(db, day, weight=90.0)
    assert maintenance == 3200
    assert "garmin" in source


def test_maintenance_ignores_non_ok_status_rows(db):
    day = date(2026, 7, 8)
    # All rows present but marked as implausible/missing -> shouldn't count
    _seed_calories(
        db,
        day,
        n_days=MIN_GARMIN_DAYS_FOR_MAINTENANCE + 2,
        kcal=9999,
        status="implausible",
    )
    maintenance, source = _maintenance_kcal(db, day, weight=90.0)
    assert maintenance == 90.0 * FORMULA_KCAL_PER_KG
    assert "formula" in source


def test_maintenance_excludes_today(db):
    day = date(2026, 7, 8)
    # A row for "today" itself should never count toward the rolling window
    db.add(GarminMetric(kind="calories", day=day, value=5000, status="ok"))
    db.commit()
    maintenance, source = _maintenance_kcal(db, day, weight=90.0)
    assert maintenance == 90.0 * FORMULA_KCAL_PER_KG  # today's row alone isn't enough


# ── compute_targets: end-to-end sanity ──────────────────────────────────
def test_compute_targets_uses_default_weight_without_profile(db):
    day = _mon()
    t = compute_targets(db, day)
    assert t.weight_kg == DEFAULT_WEIGHT_KG
    assert t.protein_g == round(DEFAULT_WEIGHT_KG * 2.2, 1)


def test_compute_targets_uses_profile_weight_when_set(db):
    db.add(AthleteProfile(weight_kg=75.0))
    db.commit()
    t = compute_targets(db, _mon())
    assert t.weight_kg == 75.0


def test_compute_targets_reflects_garmin_maintenance_in_notes(db):
    day = _mon()
    _seed_calories(db, day, n_days=MIN_GARMIN_DAYS_FOR_MAINTENANCE + 2, kcal=3100)
    t = compute_targets(db, day)
    assert "garmin" in t.notes
