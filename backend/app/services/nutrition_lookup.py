"""Read-only dated target lookup shared by API and coach tools."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import Competition, CompetitionNutritionPlan, NutritionLog
from app.services.targets import resolve_effective_targets
from app.services.training import build_session


def lookup_targets(db: Session, start: date, end: date, event_id: int | None = None) -> dict[str, Any]:
    if end < start or (end - start).days > 13:
        raise ValueError("Choose a date range of 1–14 days in chronological order")
    events = db.scalars(select(Competition).where(
        Competition.event_date <= end,
        or_(Competition.end_date >= start,
            and_(Competition.end_date.is_(None), Competition.event_date >= start)),
    )).all()
    if event_id is not None:
        if db.get(Competition, event_id) is None:
            raise ValueError("Selected competition is unavailable; clarify the event")
        if event_id not in {event.id for event in events}:
            raise ValueError("Selected competition does not fall within these dates; clarify the range")
    elif len(events) > 1:
        raise ValueError("Several competitions overlap these dates; clarify which event you mean")
    days = []
    day = start
    while day <= end:
        target = resolve_effective_targets(db, day)
        training = build_session(db, day)
        plan = db.get(CompetitionNutritionPlan, target.plan_id) if target.plan_id else None
        plan_day = next((item for item in plan.days if item["day"] == day.isoformat()), None) if plan else None
        count = db.scalar(select(func.count()).select_from(NutritionLog).where(NutritionLog.day == day)) or 0
        days.append({
            **target.to_dict(),
            "training_type": training["activity_type"],
            "training_source": training["source"],
            "context": plan_day["context"] if plan_day else "ordinary",
            "explanation": plan_day["explanation"] if plan_day else target.notes,
            "diary_url": f"/nutrition?day={day.isoformat()}",
            "plan_url": f"/nutrition?competition={plan.event_id}&plan={plan.id}" if plan else None,
            "provisional": day > athlete_today(),
            "entry_count": int(count),
            "diary_incomplete_possible": True,
        })
        day += timedelta(days=1)
    return {"start": start.isoformat(), "end": end.isoformat(), "days": days}
