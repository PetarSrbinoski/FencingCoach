"""Mental training service.

Handles insight generation from mental check-in / reflection data.
Computes averages and trend direction, then optionally calls the
PydanticAI mental agent for a short narrative insight.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import MentalEntry

log = logging.getLogger(__name__)


def _avg(values: list[int | None]) -> float | None:
    nums = [v for v in values if v is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 1)


def _trend(values: list[float | None]) -> str:
    """Compute simple trend from a list of scores (oldest first)."""
    nums = [v for v in values if v is not None]
    if len(nums) < 3:
        return "stable"
    first_half = sum(nums[: len(nums) // 2]) / (len(nums) // 2)
    second_half = sum(nums[len(nums) // 2 :]) / (len(nums) - len(nums) // 2)
    diff = second_half - first_half
    if diff > 0.5:
        return "improving"
    if diff < -0.5:
        return "declining"
    return "stable"


def compute_insight(
    db: Session,
    period_days: int = 14,
    *,
    use_llm: bool = True,
) -> dict[str, Any]:
    """Compute mental training insight over the last `period_days`."""
    today = athlete_today()
    start = today - timedelta(days=period_days - 1)

    entries = db.scalars(
        select(MentalEntry)
        .where(and_(MentalEntry.day >= start, MentalEntry.day <= today))
        .order_by(MentalEntry.day, MentalEntry.created_at)
    ).all()

    if not entries:
        return {
            "period_days": period_days,
            "entry_count": 0,
            "avg_mood": None,
            "avg_energy": None,
            "avg_focus": None,
            "avg_confidence": None,
            "trend": "stable",
            "insight": "No mental training entries yet. Start with a daily check-in.",
        }

    avg_mood = _avg([e.mood_score for e in entries])
    avg_energy = _avg([e.energy_score for e in entries])
    avg_focus = _avg([e.focus_score for e in entries])
    avg_confidence = _avg([e.confidence_score for e in entries])

    # Compute trend from combined average of all scores per entry
    combined = []
    for e in entries:
        scores = [
            s
            for s in [e.mood_score, e.energy_score, e.focus_score, e.confidence_score]
            if s is not None
        ]
        if scores:
            combined.append(sum(scores) / len(scores))
        else:
            combined.append(None)
    trend = _trend(combined)

    # Build LLM insight if enough data
    insight = f"Trend: {trend}. {len(entries)} entries over {period_days} days."
    if use_llm and len(entries) >= 3:
        try:
            from app.agents.mental import generate_mental_insight

            insight = generate_mental_insight(
                entries, avg_mood, avg_energy, avg_focus, avg_confidence, trend
            )
        except Exception as e:  # noqa: BLE001
            log.warning("Mental insight agent failed: %s", e)

    return {
        "period_days": period_days,
        "entry_count": len(entries),
        "avg_mood": avg_mood,
        "avg_energy": avg_energy,
        "avg_focus": avg_focus,
        "avg_confidence": avg_confidence,
        "trend": trend,
        "insight": insight,
    }


def mental_context_section(db: Session, today: date, days: int = 7) -> str:
    """Build a context section for the coach LLM with recent mental data."""
    start = today - timedelta(days=days - 1)
    entries = db.scalars(
        select(MentalEntry)
        .where(and_(MentalEntry.day >= start, MentalEntry.day <= today))
        .order_by(MentalEntry.day, MentalEntry.created_at)
    ).all()

    if not entries:
        return "## Mental training — no recent entries"

    lines = [f"## Mental training (last {days}d)"]
    for e in entries:
        scores = []
        if e.mood_score is not None:
            scores.append(f"mood={e.mood_score}")
        if e.energy_score is not None:
            scores.append(f"energy={e.energy_score}")
        if e.focus_score is not None:
            scores.append(f"focus={e.focus_score}")
        if e.confidence_score is not None:
            scores.append(f"conf={e.confidence_score}")
        score_str = ", ".join(scores) if scores else ""
        line = f"  - {e.day.isoformat()} [{e.entry_type}]"
        if score_str:
            line += f" {score_str}"
        if e.content:
            line += f" — {e.content[:80]}"
        lines.append(line)

    # Quick aggregate
    avg_mood = _avg([e.mood_score for e in entries])
    avg_focus = _avg([e.focus_score for e in entries])
    if avg_mood is not None or avg_focus is not None:
        lines.append(f"  Averages: mood={avg_mood}, focus={avg_focus}")

    return "\n".join(lines)
