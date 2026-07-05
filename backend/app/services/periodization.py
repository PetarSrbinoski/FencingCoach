"""Dynamic periodization — competitions are irregular, so the current phase
(general/build/peak/taper/comp_week/recovery) is computed from days-to-next-
A-event every time rather than a fixed mesocycle plan. Consumed by the
nutrition engine, training generator, coach context, and daily brief.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import Competition

PHASES = ("general", "build", "peak", "taper", "comp_week", "recovery")


@dataclass
class Phase:
    name: str  # one of PHASES
    days_to_event: int | None  # None if no upcoming A-event
    next_event_id: int | None
    next_event_name: str | None
    next_event_date: date | None
    notes: str

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "days_to_event": self.days_to_event,
            "next_event_id": self.next_event_id,
            "next_event_name": self.next_event_name,
            "next_event_date": self.next_event_date.isoformat() if self.next_event_date else None,
            "notes": self.notes,
        }


def _next_a_event(db: Session, today: date) -> Competition | None:
    return db.scalar(
        select(Competition)
        .where(Competition.priority == "A", Competition.event_date >= today)
        .order_by(Competition.event_date)
        .limit(1)
    )


def _last_event(db: Session, today: date, lookback_days: int = 7) -> Competition | None:
    return db.scalar(
        select(Competition)
        .where(
            Competition.event_date >= today - timedelta(days=lookback_days),
            Competition.event_date < today,
        )
        .order_by(Competition.event_date.desc())
        .limit(1)
    )


def compute_phase(db: Session, day: date | None = None) -> Phase:
    day = day or athlete_today()

    # Post-competition recovery has priority over the next-event lookup
    last = _last_event(db, day, lookback_days=3)
    if last is not None:
        return Phase(
            name="recovery",
            days_to_event=None,
            next_event_id=last.id,
            next_event_name=last.name,
            next_event_date=last.event_date,
            notes=f"Post-event recovery — {(day - last.event_date).days}d after {last.name}",
        )

    nxt = _next_a_event(db, day)
    if nxt is None:
        return Phase(
            name="general",
            days_to_event=None,
            next_event_id=None,
            next_event_name=None,
            next_event_date=None,
            notes="No upcoming A-event — general base phase",
        )

    days = (nxt.event_date - day).days
    if days <= 6:
        name = "comp_week"
    elif days <= 13:
        name = "taper"
    elif days <= 21:
        name = "peak"
    elif days <= 35:
        name = "build"
    else:
        name = "general"

    return Phase(
        name=name,
        days_to_event=days,
        next_event_id=nxt.id,
        next_event_name=nxt.name,
        next_event_date=nxt.event_date,
        notes=f"T-{days}d to {nxt.name}",
    )
