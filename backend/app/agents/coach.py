"""Coach chat agent.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.exceptions import ModelRetry
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from sqlalchemy.orm import Session

from app.agents.deps import (
    CoachDeps,
    active_model_label,
    get_active_model,
    get_model,
    strip_think_tags,
)
from app.agents.retry import (
    MAX_TRANSIENT_RETRIES as _MAX_TRANSIENT_RETRIES,
)
from app.agents.retry import (
    backoff_delay as _backoff_delay,
)
from app.agents.retry import (
    is_transient_llm_error as _is_transient_llm_error,
)
from app.agents.retry import (
    llm_slot as _llm_slot,
)
from app.models import Competition
from app.schemas import ExerciseOverrideIn
from app.services.grounding import find_ungrounded_claims
from app.services.prompts import COACH_SYSTEM_PROMPT
from app.services.training import clear_workout_override, set_workout_override

log = logging.getLogger(__name__)

# Matches an explicit ask to search/look something up online. Deliberately
# narrow — greetings, small talk, and in-domain coaching questions should
# never match this.
_SEARCH_INTENT_RE = re.compile(
    r"\b(search|google|look\s?up|look\s+(it\s+)?online|"
    r"check\s+online|browse\s+the\s+web|on\s+the\s+(internet|web))\b",
    re.IGNORECASE,
)


def _wants_web_search(message: str) -> bool:
    """True only if the athlete explicitly asked to search/look up online."""
    return bool(_SEARCH_INTENT_RE.search(message))


# Transient-LLM-error classification + retry constants are shared with
# nutrition.py/mealplan.py via app.agents.retry (see that module for the
# full explanation of the two NVIDIA NIM failure shapes). This chat agent
# keeps its own retry loop below rather than the generic
# `call_with_transient_retry` helper because it needs an extra guard:
# never retry once a tool has already committed a DB write this attempt
# (see `CoachDeps.side_effect_committed`).


def _last_model_name(messages: list[ModelMessage]) -> str | None:
    """Name of the model that produced the most recent `ModelResponse`."""
    for msg in reversed(messages):
        if isinstance(msg, ModelResponse):
            return msg.model_name
    return None


def _model_name_used(result: Any) -> str | None:
    """Which model actually produced a run/stream result, if knowable.

    When `get_active_model()` returns a `FallbackModel` (cloud mode), this
    is how we find out (after the fact) whether the first or second cloud
    tier answered — `ModelResponse.model_name` reflects whichever one it
    was. Defensive about `result` not exposing `all_messages()` (e.g.
    lightweight test doubles) since this is a best-effort UX nicety, not
    load-bearing.
    """
    all_messages = getattr(result, "all_messages", None)
    if not callable(all_messages):
        return None
    try:
        return _last_model_name(all_messages())
    except Exception:  # noqa: BLE001
        return None


def _parse_iso_date(value: str, *, field_name: str) -> Date:
    """Parse an ISO date given by the model, or ask it to retry.

    A malformed date must never crash the whole turn with an unhandled
    `ValueError` — raising `ModelRetry` lets pydantic-ai feed the error
    back to the model so it can correct the argument and try again.
    """
    try:
        return Date.fromisoformat(value)
    except ValueError as e:
        raise ModelRetry(
            f"Invalid {field_name} '{value}': must be an ISO date (YYYY-MM-DD)."
        ) from e


_COACH_AGENT_KWARGS: dict[str, Any] = dict(
    output_type=str,
    instructions=COACH_SYSTEM_PROMPT,
    deps_type=CoachDeps,
    model_settings={
        "temperature": 0.4,
        "max_tokens": 1200,
    },
)

# ── Agent definitions ──────────────────────────────────────────────────
# Default: no tools at all — the model can only answer from its own
# knowledge + the injected context snapshot. Nothing to misfire on.
coach_agent = Agent(get_model(), **_COACH_AGENT_KWARGS)

# Used only when `_wants_web_search()` matches the athlete's message.
coach_agent_search = Agent(
    get_model(),
    capabilities=[WebSearch()],
    **_COACH_AGENT_KWARGS,
)


@coach_agent.instructions
@coach_agent_search.instructions
async def _inject_context(ctx: RunContext[CoachDeps]) -> str:
    """Inject live context snapshot into the agent's system prompt."""
    if ctx.deps.context_text:
        return ctx.deps.context_text
    return ""


@coach_agent.output_validator
@coach_agent_search.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: str) -> str:
    return strip_think_tags(result)


# ── Tools ───────────────────────────────────────────────────────────────
# Both tools mutate the database directly (via `ctx.deps.db`, a real
# SQLAlchemy Session — see `run_coach_chat` below).
# Registered on both agent instances so they're available regardless of
# whether web search was also attached for this turn.
@coach_agent.tool
@coach_agent_search.tool
async def update_day_workout(
    ctx: RunContext[CoachDeps],
    day: str,
    exercises: list[ExerciseOverrideIn] | None = None,
    session_name: str | None = None,
    notes: str | None = None,
) -> str:
    """Change the planned gym workout for a specific day (usually today or an
    upcoming day). This replaces the auto-generated session for that day —
    use it when the athlete asks to swap an exercise, change sets/reps/load,
    or otherwise edit what's prescribed.

    Args:
        day: ISO date (YYYY-MM-DD) of the day to modify.
        exercises: The full new list of exercises for that day (this
            replaces the entire session, not just one exercise — include
            every exercise that should remain). Each item needs `exercise`,
            `sets`, and `reps`; `load_kg`, `target_rpe`, `intent`
            (strength|power|hypertrophy|skill), and `notes` are optional.
            Pass `None` or an empty list to clear a manual edit and revert
            the day to the auto-generated plan.
        session_name: Optional short label for the session, e.g. "upper
            body power" or "deload".
        notes: Optional rationale shown alongside the session.
    """
    parsed_day = _parse_iso_date(day, field_name="day")
    if not exercises:
        clear_workout_override(ctx.deps.db, parsed_day)
        ctx.deps.side_effect_committed = True
        return (
            f"Cleared the manual edit for {parsed_day.isoformat()} — it will "
            "revert to the auto-generated plan."
        )

    set_workout_override(
        ctx.deps.db,
        parsed_day,
        exercises=[e.model_dump() for e in exercises],
        session_name=session_name,
        notes=notes,
    )
    ctx.deps.side_effect_committed = True
    names = ", ".join(e.exercise for e in exercises)
    return (
        f"Updated the workout for {parsed_day.isoformat()} "
        f"({session_name or 'custom session'}): {names}."
    )


@coach_agent.tool
@coach_agent_search.tool
async def add_competition(
    ctx: RunContext[CoachDeps],
    name: str,
    event_date: str,
    location: str | None = None,
    end_date: str | None = None,
    level: str | None = None,
    priority: str = "A",
    notes: str | None = None,
) -> str:
    """Add a new competition to the athlete's competition calendar.

    Args:
        name: Competition name, e.g. "Budapest World Cup".
        event_date: ISO date (YYYY-MM-DD) the competition starts.
        location: City/country, optional.
        end_date: ISO date (YYYY-MM-DD) if the competition spans multiple
            days, optional.
        level: e.g. "local", "national", "FIE world cup", "regional".
        priority: "A" (peak for this one), "B", or "C". Defaults to "A" —
            an A-priority competition drives periodization (phase/taper)
            and nutrition targets, so ask if unsure.
        notes: Any additional notes.
    """
    parsed_priority = priority if priority in {"A", "B", "C"} else "A"
    comp = Competition(
        name=name,
        location=location,
        event_date=_parse_iso_date(event_date, field_name="event_date"),
        end_date=_parse_iso_date(end_date, field_name="end_date") if end_date else None,
        level=level,
        priority=parsed_priority,
        notes=notes,
    )
    ctx.deps.db.add(comp)
    ctx.deps.db.commit()
    ctx.deps.db.refresh(comp)
    ctx.deps.side_effect_committed = True
    return (
        f"Added competition '{comp.name}' on {comp.event_date.isoformat()} "
        f"(priority {comp.priority}, id={comp.id})."
    )


# ── History conversion ────────────────────────────────────────────────
def _db_messages_to_history(
    messages: list[Any],
) -> list[ModelMessage]:
    """Convert DB CoachMessage rows to PydanticAI ModelMessage list.

    The DB stores role='user' and role='assistant' messages.
    PydanticAI expects ModelRequest (user) and ModelResponse (assistant).
    """
    history: list[ModelMessage] = []
    for msg in messages:
        if msg.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=msg.content)]))
        elif msg.role == "assistant":
            history.append(ModelResponse(parts=[TextPart(content=msg.content)]))
    return history


# ── Public API (async) ────────────────────────────────────────────────
@dataclass
class ChatResult:
    """Result from coach chat, matching what the API endpoint needs."""

    reply: str
    model: str
    ungrounded_claims: list[str] = field(default_factory=list)


async def run_coach_chat(
    user_message: str,
    *,
    db: Session,
    context_text: str = "",
    history_messages: list[Any] | None = None,
) -> ChatResult:
    """Run the coach chat agent asynchronously.

    Args:
        user_message: The user's message text.
        db: SQLAlchemy session — passed through to any tool the agent calls
            (e.g. `update_day_workout`, `add_competition`).
        context_text: Pre-built context snapshot to inject.
        history_messages: List of DB CoachMessage objects for conversation history.

    Returns:
        ChatResult with reply text, model name, and any heuristically
        flagged ungrounded claims (see `services.grounding`).
    """
    deps = CoachDeps(db=db, context_text=context_text)

    # Convert DB message history to PydanticAI format
    message_history: list[ModelMessage] | None = None
    if history_messages:
        message_history = _db_messages_to_history(history_messages)

    agent = coach_agent_search if _wants_web_search(user_message) else coach_agent

    attempt = 0
    while True:
        try:
            async with _llm_slot():
                result = await agent.run(
                    user_message,
                    deps=deps,
                    message_history=message_history,
                    model=get_active_model(),
                )
            break
        except Exception as e:  # noqa: BLE001
            # Never retry a whole run once a tool has already committed a
            # DB write during this attempt — retrying could silently
            # duplicate that side effect (e.g. a second Competition row).
            if (
                deps.side_effect_committed
                or attempt >= _MAX_TRANSIENT_RETRIES
                or not _is_transient_llm_error(e)
            ):
                raise
            attempt += 1
            log.warning(
                "coach chat: transient LLM error (attempt %d/%d), retrying: %s",
                attempt,
                _MAX_TRANSIENT_RETRIES,
                e,
            )
            await asyncio.sleep(_backoff_delay(attempt))

    reply = result.output
    ungrounded = find_ungrounded_claims(reply, context_text)
    if ungrounded:
        log.warning("coach reply has possibly ungrounded claims: %s", ungrounded)

    return ChatResult(
        reply=reply,
        model=_model_name_used(result) or active_model_label(),
        ungrounded_claims=ungrounded,
    )
