"""Tests for training-session gym-day templating driven by the shared schedule."""

from __future__ import annotations

from datetime import date

from app.services.training import THU_TEMPLATE, TUE_TEMPLATE, _template_for


def test_default_schedule_tue_is_unilateral_thu_is_power():
    tue = date(2026, 7, 7)  # Tuesday
    thu = date(2026, 7, 9)  # Thursday
    assert _template_for(tue) == ("strength_unilateral", TUE_TEMPLATE)
    assert _template_for(thu) == ("power_explosive", THU_TEMPLATE)


def test_non_gym_day_returns_none():
    monday = date(2026, 7, 6)
    assert _template_for(monday) is None


def test_template_alternation_follows_custom_schedule(monkeypatch):
    # Move gym days to Mon/Fri instead of Tue/Thu
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "WEEKLY_SCHEDULE", "gym,fencing,fencing,fencing,gym,fencing,rest"
    )
    monday = date(2026, 7, 6)
    friday = date(2026, 7, 10)
    assert _template_for(monday) == ("strength_unilateral", TUE_TEMPLATE)
    assert _template_for(friday) == ("power_explosive", THU_TEMPLATE)
    # Tuesday is no longer a gym day under the custom schedule
    assert _template_for(date(2026, 7, 7)) is None
