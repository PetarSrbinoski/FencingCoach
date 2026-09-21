from datetime import date, timedelta

import pytest
from app.core.database import SessionLocal
from app.models import AthleteProfile, DayTypeOverride, GarminMetric
from app.services.targets import compute_targets
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy import select

from testing.support.reset_db import reset_and_seed

DAY = date(2026, 9, 27)
TYPES = ("rest", "gym", "fencing", "double", "competition")


@pytest.mark.property
@settings(max_examples=20, derandomize=True, deadline=None)
@given(st.integers(min_value=40, max_value=100), st.integers(min_value=1, max_value=40), st.sampled_from(TYPES))
def test_valid_weights_and_types_keep_outputs_finite_and_monotone(
    lower: int, increase: int, kind: str
) -> None:
    reset_and_seed()  # Hypothesis calls this body for every generated example.
    with SessionLocal() as db:
        profile = db.scalar(select(AthleteProfile).limit(1))
        assert profile is not None
        profile.weight_kg = lower
        db.add(DayTypeOverride(day=DAY, override_type=kind))
        db.commit()
        small = compute_targets(db, DAY)
        profile.weight_kg = lower + increase
        db.commit()
        large = compute_targets(db, DAY)
        assert small.day_type == large.day_type == kind
        assert large.protein_g >= small.protein_g
        assert large.carbs_g >= small.carbs_g
        for target in (small, large):
            values = (target.kcal, target.protein_g, target.carbs_g, target.fat_g)
            assert all(0 <= value < float("inf") for value in values)
            assert abs(target.kcal - (4 * target.protein_g + 4 * target.carbs_g + 9 * target.fat_g)) <= 0.55


@pytest.mark.property
@settings(max_examples=15, derandomize=True, deadline=None)
@given(st.lists(st.integers(min_value=3200, max_value=4000), min_size=5, max_size=5))
def test_irrelevant_history_and_row_order_leave_maintenance_unchanged(values: list[int]) -> None:
    reset_and_seed()
    with SessionLocal() as db:
        db.add(DayTypeOverride(day=DAY, override_type="rest"))
        for i, kcal in enumerate(values, 1):
            db.add(GarminMetric(kind="calories", day=DAY - timedelta(days=i), value=kcal, status="ok"))
        db.commit()
        original = compute_targets(db, DAY)
        assert "garmin 5d" in original.notes
        db.add_all([
            GarminMetric(kind="calories", day=DAY, value=9000, status="ok"),
            GarminMetric(kind="calories", day=DAY - timedelta(days=15), value=9000, status="ok"),
            GarminMetric(kind="calories", day=DAY - timedelta(days=6), value=9000, status="implausible"),
        ])
        db.commit()
        changed = compute_targets(db, DAY)
        assert changed.kcal == original.kcal
        assert changed.notes == original.notes

    reset_and_seed()
    with SessionLocal() as db:
        db.add(DayTypeOverride(day=DAY, override_type="rest"))
        for i, kcal in reversed(list(enumerate(values, 1))):
            db.add(GarminMetric(kind="calories", day=DAY - timedelta(days=i), value=kcal, status="ok"))
        db.commit()
        assert compute_targets(db, DAY).kcal == original.kcal


@pytest.mark.property
@settings(max_examples=15, derandomize=True, deadline=None)
@given(st.sampled_from(TYPES), st.integers(min_value=1, max_value=7))
def test_unrelated_date_override_does_not_change_selected_day(kind: str, offset: int) -> None:
    reset_and_seed()
    with SessionLocal() as db:
        before = compute_targets(db, DAY)
        db.add(DayTypeOverride(day=DAY + timedelta(days=offset), override_type=kind))
        db.commit()
        after = compute_targets(db, DAY)
        assert (after.day_type, after.override_source, after.kcal) == (
            before.day_type, before.override_source, before.kcal
        )
