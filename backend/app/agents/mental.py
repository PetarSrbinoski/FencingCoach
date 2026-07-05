"""Mental insight generation agent."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from pydantic_ai import Agent, RunContext

from app.agents.deps import CoachDeps, get_active_model, get_model, strip_think_tags
from app.models import MentalEntry
from llm.prompts.mental import MENTAL_INSTRUCTIONS

log = logging.getLogger(__name__)


# ── Agent definition ──────────────────────────────────────────────────
mental_agent = Agent(
    get_model(),
    output_type=str,
    instructions=MENTAL_INSTRUCTIONS,
    deps_type=CoachDeps,
    model_settings={
        "temperature": 0.4,
        "max_tokens": 512,
    },
)


@mental_agent.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: str) -> str:
    return strip_think_tags(result)


# ── Public API ────────────────────────────────────────────────────────
def generate_mental_insight(
    entries: Sequence[MentalEntry],
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

    result = mental_agent.run_sync(user_msg, deps=deps, model=get_active_model())
    return result.output.strip()
