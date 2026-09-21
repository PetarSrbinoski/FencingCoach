"""NUT-01..04 and DAY-01/02 on migrated, disposable PostgreSQL."""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from app.models import Activity, AthleteProfile, Competition, DayTypeOverride, GarminMetric
from app.services.targets import compute_targets, detect_day_type
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

DAY = date(2026, 9, 27)  # Sunday: configured rest day


def _calorie_row(day: date, value: float | None, status: str = "ok") -> GarminMetric:
    return GarminMetric(kind="calories", day=day, value=value, status=status)


@pytest.mark.baseline
def test_missing_profile_fallback_and_two_profile_weights(migrated_db: Session) -> None:
    db = migrated_db
    db.execute(delete(AthleteProfile))
    db.commit()
    fallback = compute_targets(db, DAY)
    assert fallback.weight_kg == 89.0
    assert fallback.protein_g == 195.8
    assert abs(fallback.kcal - (fallback.protein_g * 4 + fallback.carbs_g * 4 + fallback.fat_g * 9)) <= 0.55

    profile = AthleteProfile(weight_kg=60, body_comp_goal="lean")
    db.add(profile)
    db.commit()
    light = compute_targets(db, DAY)
    profile.weight_kg = 80
    db.commit()
    heavy = compute_targets(db, DAY)
    assert (light.weight_kg, light.protein_g, light.carbs_g) == (60, 132.0, 210.0)
    assert (heavy.weight_kg, heavy.protein_g, heavy.carbs_g) == (80, 176.0, 280.0)
    assert heavy.kcal > light.kcal


@pytest.mark.baseline
def test_phase_and_day_type_change_targets(migrated_db: Session) -> None:
    db = migrated_db
    general = compute_targets(db, DAY)
    db.add(Competition(name="Future A", event_date=DAY + timedelta(days=28), priority="A"))
    db.commit()
    build = compute_targets(db, DAY)
    db.add(DayTypeOverride(day=DAY, override_type="competition"))
    db.commit()
    competition_day_type = compute_targets(db, DAY)
    assert general.phase == "general"
    assert build.phase == "build"
    assert build.protein_g > general.protein_g
    assert build.carbs_g > general.carbs_g
    assert competition_day_type.day_type == "competition"
    assert competition_day_type.carbs_g > build.carbs_g
    for target in (general, build, competition_day_type):
        assert abs(target.kcal - (4 * target.protein_g + 4 * target.carbs_g + 9 * target.fat_g)) <= 0.55


@pytest.mark.baseline
def test_four_vs_five_usable_history_days_and_window_endpoints(migrated_db: Session) -> None:
    db = migrated_db
    db.add_all(_calorie_row(DAY - timedelta(days=i), 3600) for i in range(1, 5))
    db.add_all(
        [
            _calorie_row(DAY - timedelta(days=5), None),
            _calorie_row(DAY - timedelta(days=6), 9000, "implausible"),
            _calorie_row(DAY - timedelta(days=15), 9000),
            _calorie_row(DAY, 9000),
        ]
    )
    db.commit()
    four = compute_targets(db, DAY)
    assert "formula 38 kcal/kg" in four.notes
    assert "only 4/5" in four.notes
    assert four.kcal == 2527.0  # 70 kg × 38 × the observed lean-goal dial

    db.add(_calorie_row(DAY - timedelta(days=14), 3600))
    db.commit()
    five = compute_targets(db, DAY)
    assert "garmin 5d rolling avg (3600 kcal)" in five.notes
    assert five.kcal == 3420.0
    assert five.kcal > four.kcal


@pytest.mark.baseline
def test_manual_selection_precedes_competition_and_activity_only_on_its_day(
    migrated_db: Session,
) -> None:
    db = migrated_db
    db.add(Competition(name="Sunday Cup", event_date=DAY, priority="A"))
    db.add(
        Activity(
            source="manual",
            activity_type="strength_training",
            start_time=datetime.combine(DAY, time(9), tzinfo=UTC),
        )
    )
    db.commit()
    assert detect_day_type(db, DAY) == ("competition", "auto")

    db.add(DayTypeOverride(day=DAY, override_type="rest"))
    db.commit()
    assert detect_day_type(db, DAY) == ("rest", "manual")
    assert compute_targets(db, DAY).override_source == "manual"
    assert detect_day_type(db, DAY + timedelta(days=1))[1] == "auto"
    assert db.scalar(select(DayTypeOverride).where(DayTypeOverride.day == DAY + timedelta(days=1))) is None
