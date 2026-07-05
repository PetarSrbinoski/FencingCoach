"""Single source of truth for the athlete's default weekly training schedule
(`WEEKLY_SCHEDULE` config), overridden per-day by `DayTypeOverride` rows,
competitions, and logged activities.
"""

from __future__ import annotations

from app.core.config import settings

VALID_DAY_TYPES = {"rest", "gym", "fencing", "double", "competition"}
_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _parse_schedule(raw: str) -> dict[int, str]:
    parts = [p.strip().lower() for p in raw.split(",")]
    if len(parts) != 7:
        raise ValueError(
            f"WEEKLY_SCHEDULE must have exactly 7 comma-separated entries "
            f"(Mon..Sun), got {len(parts)}: {raw!r}"
        )
    invalid = [p for p in parts if p not in VALID_DAY_TYPES]
    if invalid:
        raise ValueError(
            f"WEEKLY_SCHEDULE has invalid day type(s) {invalid}; "
            f"must be one of {sorted(VALID_DAY_TYPES)}"
        )
    return dict(enumerate(parts))


def weekly_schedule() -> dict[int, str]:
    """Weekday (0=Mon..6=Sun) -> default day_type, parsed from config."""
    return _parse_schedule(settings.WEEKLY_SCHEDULE)


def day_type_for_weekday(weekday: int) -> str:
    return weekly_schedule()[weekday]


def is_gym_day(weekday: int) -> bool:
    return weekly_schedule().get(weekday) == "gym"


def schedule_description() -> str:
    """Human-readable schedule text, e.g. for LLM prompt injection."""
    sched = weekly_schedule()
    return ", ".join(f"{_WEEKDAY_NAMES[i]}={sched[i]}" for i in range(7))
