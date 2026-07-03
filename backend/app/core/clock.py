"""Athlete-timezone-aware "today".

Every "what day is it" decision in the app (readiness, targets, training,
meal plans, briefs, mental insights, periodization, context, summaries)
must agree on the current date. `date.today()` / `datetime.now()` without
a timezone resolve to the server's local clock, which is UTC inside the
Docker container — this can disagree with the athlete's actual calendar
day (`ATHLETE_TIMEZONE`), especially late evening/early morning.

Use `athlete_today()` everywhere a default "today" is needed instead of
the bare `date.today()`.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def athlete_today() -> date:
    """Current date in the athlete's configured timezone."""
    return datetime.now(ZoneInfo(settings.ATHLETE_TIMEZONE)).date()
