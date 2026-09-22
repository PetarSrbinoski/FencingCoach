"""SCH-01/02 generated behavior with 100 examples per pure property."""

import pytest
from app.core.config import settings
from app.services.schedule import day_type_for_weekday, schedule_description, weekly_schedule
from hypothesis import given
from hypothesis import settings as hypothesis_settings
from hypothesis import strategies as st

TYPES = ("rest", "gym", "fencing", "double", "competition")
schedule_values = st.lists(st.sampled_from(TYPES), min_size=7, max_size=7)


@pytest.mark.property
@hypothesis_settings(max_examples=100, derandomize=True)
@given(schedule_values)
def test_every_valid_week_preserves_order(values: list[str]) -> None:
    original = settings.WEEKLY_SCHEDULE
    try:
        settings.WEEKLY_SCHEDULE = ",".join(values)
        assert weekly_schedule() == dict(enumerate(values))
        assert [day_type_for_weekday(day) for day in range(7)] == values
        description = schedule_description()
        assert description.startswith(f"Mon={values[0]}")
        assert description.endswith(f"Sun={values[6]}")
    finally:
        settings.WEEKLY_SCHEDULE = original


@pytest.mark.property
@hypothesis_settings(max_examples=100, derandomize=True)
@given(schedule_values)
def test_supported_case_and_space_changes_preserve_lookup(values: list[str]) -> None:
    original = settings.WEEKLY_SCHEDULE
    try:
        settings.WEEKLY_SCHEDULE = ",".join(f" {value.upper()} " for value in values)
        assert [day_type_for_weekday(day) for day in range(7)] == values
    finally:
        settings.WEEKLY_SCHEDULE = original


@pytest.mark.property
@hypothesis_settings(max_examples=100, derandomize=True)
@given(
    st.lists(st.sampled_from(TYPES), min_size=7, max_size=7),
    st.integers(min_value=0, max_value=6),
    st.sampled_from(("", "unknown", "fence", "7")),
)
def test_generated_invalid_token_is_rejected(values: list[str], index: int, invalid: str) -> None:
    original = settings.WEEKLY_SCHEDULE
    try:
        values[index] = invalid
        settings.WEEKLY_SCHEDULE = ",".join(values)
        with pytest.raises(ValueError, match="invalid day type"):
            weekly_schedule()
    finally:
        settings.WEEKLY_SCHEDULE = original


@pytest.mark.property
@hypothesis_settings(max_examples=100, derandomize=True)
@given(st.lists(st.sampled_from(TYPES), min_size=0, max_size=6) | st.lists(st.sampled_from(TYPES), min_size=8, max_size=10))
def test_generated_wrong_lengths_are_rejected(values: list[str]) -> None:
    original = settings.WEEKLY_SCHEDULE
    try:
        settings.WEEKLY_SCHEDULE = ",".join(values)
        with pytest.raises(ValueError, match="exactly 7"):
            weekly_schedule()
    finally:
        settings.WEEKLY_SCHEDULE = original
