"""Mental training service.

Handles insight generation from mental check-in / reflection data.
Computes averages and trend direction, then optionally calls the LLM
for a short narrative insight.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import MentalEntry
from app.services.llm import get_llm

log = logging.getLogger(__name__)

INSIGHT_SYSTEM_PROMPT = (
    "detailed thinking off\n\n"
    "You are a sports psychologist for an elite fencer. "
    "Given recent mental check-in data (mood, energy, focus, confidence scores "
    "and journal reflections), write a concise 2-3 sentence insight summary. "
    "Highlight patterns, notable shifts, and one actionable suggestion. "
    "Be direct and specific. No preamble."
)


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
    today = date.today()
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
            insight = _generate_llm_insight(
                entries, avg_mood, avg_energy, avg_focus, avg_confidence, trend
            )
        except Exception as e:  # noqa: BLE001
            log.warning("LLM insight generation failed: %s", e)

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


def _generate_llm_insight(
    entries: list[MentalEntry],
    avg_mood: float | None,
    avg_energy: float | None,
    avg_focus: float | None,
    avg_confidence: float | None,
    trend: str,
) -> str:
    """Use LLM to generate a short narrative insight."""
    lines = [
        f"Period averages — mood: {avg_mood}, energy: {avg_energy}, "
        f"focus: {avg_focus}, confidence: {avg_confidence}. Trend: {trend}.",
        "",
        "Recent entries:",
    ]
    for e in entries[-10:]:  # Last 10 entries max
        scores = []
        if e.mood_score is not None:
            scores.append(f"mood={e.mood_score}")
        if e.energy_score is not None:
            scores.append(f"energy={e.energy_score}")
        if e.focus_score is not None:
            scores.append(f"focus={e.focus_score}")
        if e.confidence_score is not None:
            scores.append(f"conf={e.confidence_score}")
        score_str = ", ".join(scores) if scores else "no scores"
        content_preview = (e.content or "")[:120]
        lines.append(
            f"  {e.day.isoformat()} [{e.entry_type}] {score_str}"
            + (f" — {content_preview}" if content_preview else "")
        )

    llm = get_llm()
    resp = llm.chat(
        [
            {"role": "system", "content": INSIGHT_SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(lines)},
        ],
        max_tokens=256,
        temperature=0.4,
    )
    return resp.content.strip()


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
