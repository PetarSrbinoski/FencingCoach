"""SCH-01/02: examples through the public schedule interface."""

import pytest
from app.core.config import settings
from app.services.schedule import (
    day_type_for_weekday,
    is_gym_day,
    schedule_description,
    weekly_schedule,
)


@pytest.mark.baseline
def test_all_supported_types_keep_monday_to_sunday_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        settings,
        "WEEKLY_SCHEDULE",
        "rest,gym,fencing,double,competition,rest,gym",
    )

    assert weekly_schedule() == {
        0: "rest",
        1: "gym",
        2: "fencing",
        3: "double",
        4: "competition",
        5: "rest",
        6: "gym",
    }
    assert day_type_for_weekday(0) == "rest"
    assert day_type_for_weekday(6) == "gym"
    assert is_gym_day(1) is True
    assert is_gym_day(0) is False
    assert schedule_description() == (
        "Mon=rest, Tue=gym, Wed=fencing, Thu=double, "
        "Fri=competition, Sat=rest, Sun=gym"
    )


@pytest.mark.baseline
def test_case_and_surrounding_space_do_not_change_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        settings,
        "WEEKLY_SCHEDULE",
        " ReST , GYM , Fencing , DOUBLE , COMPETITION , rest , gYm ",
    )
    assert [day_type_for_weekday(i) for i in range(7)] == [
        "rest", "gym", "fencing", "double", "competition", "rest", "gym"
    ]


@pytest.mark.baseline
@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "exactly 7"),
        ("rest,gym,fencing,double,competition,rest", "exactly 7"),
        ("rest,gym,fencing,double,competition,rest,gym,rest", "exactly 7"),
        ("rest,gym,fencing,double,competition,rest,", "invalid day type"),
        ("rest,gym,fencing,unknown,competition,rest,gym", "invalid day type"),
    ],
)
def test_malformed_schedule_is_rejected(
    monkeypatch: pytest.MonkeyPatch, raw: str, message: str
) -> None:
    monkeypatch.setattr(settings, "WEEKLY_SCHEDULE", raw)
    with pytest.raises(ValueError, match=message):
        weekly_schedule()
