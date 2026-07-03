"""Daily brief generation agent.

Replaces `services/brief.py` LLM call with a PydanticAI agent that:
- Returns plain text (str output_type — the default)
- Gets the full context snapshot via CoachDeps.context_text
- Uses the same COACH + BRIEF prompt pattern
- Strips <think> tags via result_validator
"""

from __future__ import annotations

import logging
from datetime import date

from pydantic_ai import Agent, RunContext
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.agents.deps import CoachDeps, get_model, strip_think_tags
from app.core.config import settings
from app.models import DailyBrief
from app.services.context import build_context
from app.services.prompts import COACH_SYSTEM_PROMPT, DAILY_BRIEF_PROMPT
from app.services.readiness import compute_readiness

log = logging.getLogger(__name__)


# ── Agent definition ──────────────────────────────────────────────────
# The brief agent uses the full COACH_SYSTEM_PROMPT as its base instructions.
# Context snapshot is injected dynamically via @brief_agent.instructions.
brief_agent = Agent(
    get_model(),
    output_type=str,
    instructions=COACH_SYSTEM_PROMPT,
    deps_type=CoachDeps,
    model_settings={
        "temperature": 0.5,
        "max_tokens": 900,
    },
)


@brief_agent.instructions
async def _inject_context(ctx: RunContext[CoachDeps]) -> str:
    """Inject the live context snapshot into the agent's instructions."""
    if ctx.deps.context_text:
        return ctx.deps.context_text
    return ""


@brief_agent.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: str) -> str:
    return strip_think_tags(result)


# ── Public API ────────────────────────────────────────────────────────
def generate_brief(db: Session, day: date | None = None) -> DailyBrief:
    """Generate today's daily brief and persist to DB.

    Drop-in replacement for `services/brief.generate_daily_brief()`.
    """
    day = day or athlete_today()
    readiness = compute_readiness(db, day)
    context = build_context(db, day)

    deps = CoachDeps(db=db, context_text=context)

    try:
        result = brief_agent.run_sync(DAILY_BRIEF_PROMPT, deps=deps)
        summary = result.output
    except Exception as e:
        log.error("Brief agent failed: %s", e)
        summary = f"Brief generation failed: {e}"

    payload = {
        "readiness": readiness.to_dict(),
        "model": settings.LLM_MODEL,
    }

    stmt = pg_insert(DailyBrief).values(
        day=day,
        readiness_score=readiness.score,
        summary=summary,
        payload=payload,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["day"],
        set_={
            "readiness_score": stmt.excluded.readiness_score,
            "summary": stmt.excluded.summary,
            "payload": stmt.excluded.payload,
            "generated_at": func.now(),
        },
    )
    db.execute(stmt)
    db.commit()

    brief = db.query(DailyBrief).filter(DailyBrief.day == day).one()
    return brief
