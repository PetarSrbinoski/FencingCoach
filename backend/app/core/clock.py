"""Athlete-timezone-aware "today"."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def athlete_today() -> date:
    """Current date in the athlete's configured timezone."""
    return datetime.now(ZoneInfo(settings.ATHLETE_TIMEZONE)).date()
