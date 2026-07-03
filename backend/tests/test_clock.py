"""Tests for athlete-timezone-aware 'today'."""

from __future__ import annotations

from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.core.clock import athlete_today


def test_athlete_today_uses_configured_timezone():
    # A fixed UTC instant that falls on different calendar days depending
    # on the timezone it's viewed in.
    fixed_utc = datetime(2026, 1, 1, 2, 0, tzinfo=ZoneInfo("UTC"))

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_utc.astimezone(tz) if tz else fixed_utc

    with patch("app.core.clock.datetime", _FakeDatetime):
        with patch("app.core.clock.settings") as mock_settings:
            mock_settings.ATHLETE_TIMEZONE = "Pacific/Kiritimati"  # UTC+14
            assert athlete_today() == date(2026, 1, 1)

            mock_settings.ATHLETE_TIMEZONE = "Etc/GMT+12"  # UTC-12
            assert athlete_today() == date(2025, 12, 31)
