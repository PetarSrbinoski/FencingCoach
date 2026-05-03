"""Mental insight generation agent.

Replaces `services/mental._generate_llm_insight()` with a PydanticAI agent:
- Small, focused agent — returns plain text insight
- No tools needed (just analysis of provided data)
- Strips <think> tags
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic_ai import Agent, RunContext

from app.agents.deps import CoachDeps, get_model, strip_think_tags
from app.core.config import settings
from app.models import MentalEntry

log = logging.getLogger(__name__)


# ── Agent definition ──────────────────────────────────────────────────
MENTAL_INSTRUCTIONS = """\
You are a sports psychologist for an elite fencer.
Given recent mental check-in data (mood, energy, focus, confidence scores
and journal reflections), write a concise 2-3 sentence insight summary.
Highlight patterns, notable shifts, and one actionable suggestion.
Be direct and specific. No preamble."""

mental_agent = Agent(
    get_model(),
    output_type=str,
    instructions=MENTAL_INSTRUCTIONS,
    deps_type=CoachDeps,
    model_settings={
        "temperature": 0.4,
        "max_tokens": 256,
    },
)


@mental_agent.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: str) -> str:
    return strip_think_tags(result)


# ── Public API ────────────────────────────────────────────────────────
def generate_mental_insight(
    entries: list[MentalEntry],
    avg_mood: float | None,
    avg_energy: float | None,
    avg_focus: float | None,
    avg_confidence: float | None,
    trend: str,
) -> str:
    """Generate LLM insight from mental check-in data.

    Drop-in replacement for `services/mental._generate_llm_insight()`.
    """
    # Build the same prompt text the old code used
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

    user_msg = "\n".join(lines)

    # No DB needed for this agent — pass None
    deps = CoachDeps(db=None)  # type: ignore[arg-type]

    result = mental_agent.run_sync(user_msg, deps=deps)
    return result.output.strip()
