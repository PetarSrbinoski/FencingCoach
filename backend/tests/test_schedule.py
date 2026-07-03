"""Tests for the single-source weekly training schedule config."""

from __future__ import annotations

import pytest
from app.services.schedule import (
    VALID_DAY_TYPES,
    _parse_schedule,
    day_type_for_weekday,
    is_gym_day,
    schedule_description,
    weekly_schedule,
)


def test_default_schedule_matches_historical_pattern():
    sched = weekly_schedule()
    assert sched == {
        0: "fencing",  # Mon
        1: "gym",  # Tue
        2: "fencing",  # Wed
        3: "gym",  # Thu
        4: "fencing",  # Fri
        5: "fencing",  # Sat
        6: "rest",  # Sun
    }


def test_day_type_for_weekday():
    assert day_type_for_weekday(0) == "fencing"
    assert day_type_for_weekday(1) == "gym"
    assert day_type_for_weekday(6) == "rest"


def test_is_gym_day():
    assert is_gym_day(1) is True
    assert is_gym_day(3) is True
    assert is_gym_day(0) is False


def test_schedule_description_is_human_readable():
    text = schedule_description()
    assert "Mon=fencing" in text
    assert "Tue=gym" in text
    assert "Sun=rest" in text


def test_parse_schedule_rejects_wrong_length():
    with pytest.raises(ValueError, match="exactly 7"):
        _parse_schedule("fencing,gym,rest")


def test_parse_schedule_rejects_invalid_day_type():
    with pytest.raises(ValueError, match="invalid day type"):
        _parse_schedule("fencing,gym,fencing,gym,fencing,fencing,swimming")


def test_parse_schedule_is_case_insensitive_and_trims_whitespace():
    parsed = _parse_schedule(" FENCING, gym ,fencing,gym,fencing,fencing,REST")
    assert parsed[0] == "fencing"
    assert parsed[6] == "rest"


def test_all_valid_day_types_accepted():
    raw = ",".join(["rest"] * 7)
    parsed = _parse_schedule(raw)
    assert all(v in VALID_DAY_TYPES for v in parsed.values())
