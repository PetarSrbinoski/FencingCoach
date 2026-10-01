"""Coach chat agent."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any, Literal

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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.deps import (
    CoachDeps,
    active_model_label,
    consume_generation_stream,
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
from app.models import CoachPlanProposal, Competition, WorkoutOverride
from app.schemas import ExerciseOverrideIn
from app.schemas.coach_memory import MemoryContent
from app.schemas.foods import FoodPortion, PositiveAmount, SavedFoodInput, SavedFoodOut
from app.services import coach_memory, foods
from app.services.agent_actions import record_action, snapshot
from app.services.competition_nutrition import preview as preview_competition_nutrition
from app.services.grounding import find_ungrounded_claims
from app.services.nutrition_lookup import lookup_targets
from app.services.training import clear_workout_override, set_workout_override
from app.services.transactions import lock_nutrition_inputs, lock_resource
from llm.prompts.coach import COACH_SYSTEM_PROMPT

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


# Retry constants/classification are shared with nutrition.py/mealplan.py
# via app.agents.retry, but this agent keeps its own retry loop below since
# it needs an extra guard: never retry after a tool has committed a DB write.


def _last_model_name(messages: list[ModelMessage]) -> str | None:
    """Name of the model that produced the most recent `ModelResponse`."""
    for msg in reversed(messages):
        if isinstance(msg, ModelResponse):
            return msg.model_name
    return None


def _model_name_used(result: Any) -> str | None:
    """Which model actually produced a run/stream result, if knowable —
    resolves which `FallbackModel` tier answered. Best-effort UX nicety,
    not load-bearing, so any lookup failure is swallowed."""
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


def _failed_tool(ctx: RunContext[CoachDeps], kind: str, resource_id: str | int,
                 summary: str, error: str) -> None:
    """Keep attempted failures separate from committed coach changes."""
    record_action(ctx.deps.db, kind, resource_id, summary, None, None,
                  conversation_id=ctx.deps.extra.get("conversation_id"),
                  message_id=ctx.deps.extra.get("message_id"),
                  status="failed", error=error)
    ctx.deps.db.commit()
    ctx.deps.side_effect_committed = True


_COACH_AGENT_KWARGS: dict[str, Any] = dict(
    output_type=str,
    instructions=COACH_SYSTEM_PROMPT,
    deps_type=CoachDeps,
    model_settings={
        "temperature": 0.4,
        "max_tokens": 1800,
    },
)

# ── Agent definitions ──────────────────────────────────────────────────
# Default: database tools and context, with web search available only on request.
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
    try:
        parsed_day = _parse_iso_date(day, field_name="day")
    except ModelRetry as exc:
        _failed_tool(ctx, "workout", day, f"Attempted workout change for {day}", str(exc))
        raise
    key = json.dumps([day, [e.model_dump() for e in exercises or []], session_name, notes], sort_keys=True)
    cache = ctx.deps.extra.setdefault("workout_writes", {})
    if key in cache:
        return cache[key]
    lock_resource(ctx.deps.db, "workout", day)
    before = snapshot(ctx.deps.db.get(WorkoutOverride, parsed_day), "workout")
    if not exercises:
        clear_workout_override(ctx.deps.db, parsed_day, commit=False)
        record_action(ctx.deps.db, "workout", day, f"Cleared workout override for {day}",
                      before, None, conversation_id=ctx.deps.extra.get("conversation_id"),
                      message_id=ctx.deps.extra.get("message_id"))
        ctx.deps.db.commit()
        ctx.deps.side_effect_committed = True
        result = (
            f"Cleared the manual edit for {parsed_day.isoformat()} — it will "
            "revert to the auto-generated plan."
        )
        cache[key] = result
        return result

    row = set_workout_override(
        ctx.deps.db,
        parsed_day,
        exercises=[e.model_dump() for e in exercises],
        session_name=session_name,
        notes=notes,
        commit=False,
    )
    record_action(ctx.deps.db, "workout", day, f"Set workout for {day}: {session_name or 'custom session'}",
                  before, snapshot(row, "workout"),
                  conversation_id=ctx.deps.extra.get("conversation_id"),
                  message_id=ctx.deps.extra.get("message_id"))
    ctx.deps.db.commit()
    ctx.deps.side_effect_committed = True
    names = ", ".join(e.exercise for e in exercises)
    result = (
        f"Updated the workout for {parsed_day.isoformat()} "
        f"({session_name or 'custom session'}): {names}."
    )
    cache[key] = result
    return result


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
    key = json.dumps([name, event_date, location, end_date, level, priority, notes], sort_keys=True)
    cache = ctx.deps.extra.setdefault("competition_writes", {})
    if key in cache:
        return cache[key]
    try:
        parsed_start = _parse_iso_date(event_date, field_name="event_date")
        parsed_end = _parse_iso_date(end_date, field_name="end_date") if end_date else None
        if parsed_end is not None and parsed_end < parsed_start:
            raise ModelRetry("Competition end date must be on or after the start date")
    except ModelRetry as exc:
        _failed_tool(ctx, "competition", "pending", f"Attempted to add {name}", str(exc))
        raise
    parsed_priority = priority if priority in {"A", "B", "C"} else "A"
    lock_nutrition_inputs(ctx.deps.db)
    comp = Competition(
        name=name,
        location=location,
        event_date=parsed_start,
        end_date=parsed_end,
        level=level,
        priority=parsed_priority,
        notes=notes,
    )
    ctx.deps.db.add(comp)
    ctx.deps.db.flush()
    record_action(ctx.deps.db, "competition", comp.id,
                  f"Added competition {comp.name} on {comp.event_date.isoformat()}",
                  None, snapshot(comp, "competition"),
                  conversation_id=ctx.deps.extra.get("conversation_id"),
                  message_id=ctx.deps.extra.get("message_id"))
    ctx.deps.db.commit()
    ctx.deps.db.refresh(comp)
    ctx.deps.side_effect_committed = True
    result = (
        f"Added competition '{comp.name}' on {comp.event_date.isoformat()} "
        f"(priority {comp.priority}, id={comp.id})."
    )
    cache[key] = result
    return result


@coach_agent.tool
@coach_agent_search.tool
async def search_saved_foods(ctx: RunContext[CoachDeps], query: str = "") -> list[SavedFoodOut]:
    """Find personal foods and their exact supplied nutrients per 100 g.

    Use before logging food or updating a library entry. Empty query lists all
    foods; try it if a nickname or a specific query returns no match. Ask the
    athlete when several foods could match. Never invent an ID or quantity.
    """
    return [SavedFoodOut.model_validate(food) for food in foods.list_foods(ctx.deps.db, query)]


@coach_agent.tool(sequential=True)
@coach_agent_search.tool(sequential=True)
async def save_personal_food(
    ctx: RunContext[CoachDeps], food: SavedFoodInput, food_id: int | None = None,
    values_for_g: PositiveAmount = 100,
) -> SavedFoodOut:
    """Save a food ONLY when the athlete explicitly requests a library save/update.

    All nutrient numbers must be supplied by the athlete. Pass them unchanged,
    and set values_for_g to their stated basis in grams (default 100). The server
    converts to per 100 g. Unknown fields stay null/absent; never fill them with
    estimates or web data. Ask for the basis weight if it is unclear.
    Saving does not log consumption. On a duplicate ask whether to update the
    existing ID or save a distinctly named variant. Pass food_id ONLY after the
    athlete asks for an update; preserve existing fields they did not change.
    """
    key = json.dumps([food_id, food.model_dump(), values_for_g], sort_keys=True)
    cache = ctx.deps.extra.setdefault("saved_food_writes", {})
    if key in cache:
        return cache[key]
    try:
        food = foods.per_100g(food, values_for_g)
        if food_id is not None:
            lock_resource(ctx.deps.db, "food", food_id)
        before = snapshot(foods.get_food(ctx.deps.db, food_id), "food_update") if food_id is not None else None
        if food_id is not None:
            current = SavedFoodOut.model_validate(foods.get_food(ctx.deps.db, food_id))
            data = current.model_dump(exclude={"id"})
            data.update(food.model_dump(exclude_unset=True))
            food = SavedFoodInput.model_validate(data)
        row = foods.save_food(ctx.deps.db, food, food_id, commit=False)
    except foods.FoodError as exc:
        _failed_tool(ctx, "food_update" if food_id is not None else "food_create",
                     food_id or "pending", f"Attempted to save food {food.name}", str(exc))
        raise ModelRetry(str(exc)) from exc
    kind = "food_update" if food_id is not None else "food_create"
    record_action(ctx.deps.db, kind, row.id, f"{'Updated' if food_id else 'Added'} food {row.name}",
                  before, snapshot(row, kind), conversation_id=ctx.deps.extra.get("conversation_id"),
                  message_id=ctx.deps.extra.get("message_id"))
    ctx.deps.db.commit()
    ctx.deps.side_effect_committed = True
    result = SavedFoodOut.model_validate(row)
    cache[key] = result
    return result


@coach_agent.tool(sequential=True)
@coach_agent_search.tool(sequential=True)
async def log_saved_foods(
    ctx: RunContext[CoachDeps], portions: list[FoodPortion],
    day: str | None = None, meal: str | None = None,
) -> dict[str, Any]:
    """Record consumption of saved foods using server-calculated nutrients.

    Call when the athlete says they ate a food or asks to log it, never for
    hypothetical meals. Search the library first. Ask for clarification if a
    food or quantity is ambiguous. Supply grams OR a count of the saved serving;
    never guess grams, serving sizes, missing macros, or unit conversions.
    Omitted day means today. Returned numbers are what was actually recorded.
    """
    parsed_day = _parse_iso_date(day, field_name="day") if day else None
    key = json.dumps([day, meal, [p.model_dump() for p in portions]], sort_keys=True)
    cache = ctx.deps.extra.setdefault("saved_food_logs", {})
    if key in cache:
        return cache[key]
    try:
        row = foods.log_foods(ctx.deps.db, portions, day=parsed_day, meal=meal, commit=False)
    except foods.FoodError as exc:
        _failed_tool(ctx, "meal", "pending", f"Attempted meal log for {day or 'today'}", str(exc))
        raise ModelRetry(str(exc)) from exc
    record_action(ctx.deps.db, "meal", row.id,
                  f"Logged {row.meal or 'meal'} on {row.day.isoformat()}: {row.raw_text}",
                  None, snapshot(row, "meal"),
                  conversation_id=ctx.deps.extra.get("conversation_id"),
                  message_id=ctx.deps.extra.get("message_id"))
    ctx.deps.db.commit()
    ctx.deps.side_effect_committed = True
    result = {
        "log_id": row.id, "day": row.day.isoformat(), "foods": row.raw_text,
        **{name: getattr(row, name) for name in foods.MACROS}, "micros": row.micros,
    }
    cache[key] = result
    return result


@coach_agent.tool
@coach_agent_search.tool
async def nutrition_targets_for_dates(
    ctx: RunContext[CoachDeps], start_day: str, end_day: str,
    event_name: str | None = None,
) -> dict[str, Any]:
    """Read exact daily macros and provenance for a bounded date range.

    Use for any question about the athlete's existing or planned macro targets.
    Ask the athlete to clarify ambiguous relative dates or event names. This is
    read-only: it never accepts or changes a plan. Return the exact values and
    diary/plan links; do not calculate a second target in prose.
    """
    start = _parse_iso_date(start_day, field_name="start_day")
    end = _parse_iso_date(end_day, field_name="end_day")
    event_id = None
    if event_name:
        matches = ctx.deps.db.scalars(select(Competition).where(
            func.lower(Competition.name).contains(event_name.casefold())
        )).all()
        if len(matches) != 1:
            raise ModelRetry("Event name is ambiguous or unavailable; ask which competition the athlete means")
        event_id = matches[0].id
    try:
        result = lookup_targets(ctx.deps.db, start, end, event_id)
    except ValueError as exc:
        raise ModelRetry(str(exc)) from exc
    ctx.deps.extra.setdefault("nutrition_refs", []).append({
        "start": start.isoformat(), "end": end.isoformat(),
        "plan_versions": sorted({f"{row['plan_id']}:v{row['plan_version']}" for row in result["days"] if row["plan_id"]}),
        "days": [{key: row.get(key) for key in (
            "day", "kcal", "protein_g", "carbs_g", "fat_g", "training_type", "context",
            "explanation", "target_source", "plan_url", "diary_url", "plan_version",
        )} for row in result["days"]],
    })
    return result


@coach_agent.tool(sequential=True)
@coach_agent_search.tool(sequential=True)
async def propose_competition_nutrition_plan(
    ctx: RunContext[CoachDeps], event_name: str,
    expected_demand: str, event_format: str,
    start_time: str | None = None, resolve_overlaps: bool = False,
) -> dict[str, Any]:
    """Prepare a deterministic date-by-date target comparison for athlete review.

    Use when the athlete asks to create or recalculate a competition nutrition
    plan. This tool only records a pending proposal; it does not activate targets.
    Ask for event, demand and format if genuinely ambiguous. The athlete must
    press Apply in chat after reviewing the preview.
    """
    matches = ctx.deps.db.scalars(select(Competition).where(
        func.lower(Competition.name).contains(event_name.casefold())
    )).all()
    if len(matches) != 1:
        raise ModelRetry("Competition name is ambiguous or unavailable; ask which event the athlete means")
    if expected_demand not in {"low", "moderate", "high"} or event_format not in {"single_day", "multi_day"}:
        raise ModelRetry("Ask for expected demand (low/moderate/high) and event format (single/multi day)")
    inputs = {"expected_demand": expected_demand, "event_format": event_format,
              "start_time": start_time, "resolve_overlaps": resolve_overlaps}
    key = json.dumps([matches[0].id, inputs], sort_keys=True)
    cache = ctx.deps.extra.setdefault("coach_plan_proposals", {})
    if key in cache:
        return cache[key]
    try:
        draft = preview_competition_nutrition(ctx.deps.db, matches[0], inputs)
    except ValueError as exc:
        raise ModelRetry(str(exc)) from exc
    proposal = CoachPlanProposal(event_id=matches[0].id, inputs=inputs, preview=draft,
                                 token=draft["token"], status="pending",
                                 conversation_id=ctx.deps.extra.get("conversation_id"),
                                 message_id=ctx.deps.extra.get("message_id"))
    ctx.deps.db.add(proposal)
    ctx.deps.db.commit()
    ctx.deps.db.refresh(proposal)
    ctx.deps.side_effect_committed = True
    result = {"proposal_id": proposal.id, "status": "pending", "event": draft["event"],
              "days": [{"day": day["day"], "context": day["context"],
                        "old_targets": day["existing_targets"],
                        "new_targets": {key: day[key] for key in ("kcal", "protein_g", "carbs_g", "fat_g")}}
                       for day in draft["days"]],
              "instruction": "No target has changed. Ask the athlete to review and Apply or Cancel in chat."}
    cache[key] = result
    return result


@coach_agent.tool(sequential=True)
@coach_agent_search.tool(sequential=True)
async def remember_context(
    ctx: RunContext[CoachDeps], memory: MemoryContent,
    provenance: Literal["explicit", "inferred"], evidence: str,
    memory_id: int | None = None, expected_revision: str | None = None,
) -> dict[str, Any]:
    """Remember practical context from the CURRENT athlete message only.

    Explicit: an athlete-requested fact/preference/constraint. Inferred: only a
    durable food preference supported by current first-person habitual language
    (prefer, usually, always), never health facts or a transient/uncertain remark.
    Quote evidence verbatim from this turn; never mine history or audit records.
    For updates supply the existing ID and revision; never overwrite a confirmed
    fact with an inference. Preserve unchanged content and expiration on updates.
    expires_on is the inclusive last active date in the athlete timezone. Resolve
    unambiguous relative dates from context; ask about ambiguous dates first.
    Temporary circumstances require an explicit expiration. If a fact conflicts
    with Profile restrictions/current constraints, clarify instead of saving it.
    Returned deleted=true means an old operation was already removed, NOT saved.
    """
    try:
        result = coach_memory.remember(
            ctx.deps.db, memory, provenance=provenance, evidence=evidence,
            conversation_id=ctx.deps.extra.get("conversation_id"),
            message_id=ctx.deps.extra.get("message_id"),
            current_message=ctx.deps.extra.get("current_message", ""),
            memory_id=memory_id, expected_revision=expected_revision,
        )
    except (ValueError, LookupError) as exc:
        ctx.deps.db.rollback()
        raise ModelRetry(str(exc)) from exc
    ctx.deps.side_effect_committed = True
    return result


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
    nutrition_refs: list[dict[str, Any]] = field(default_factory=list)


async def run_coach_chat(
    user_message: str,
    *,
    db: Session,
    context_text: str = "",
    history_messages: list[Any] | None = None,
    conversation_id: int | None = None,
    message_id: int | None = None,
) -> ChatResult:
    """Run the coach chat agent asynchronously, returning the reply, model
    used, and any heuristically flagged ungrounded claims."""
    deps = CoachDeps(db=db, context_text=context_text)
    deps.extra.update(conversation_id=conversation_id, message_id=message_id, current_message=user_message)

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
                    event_stream_handler=consume_generation_stream,
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
        nutrition_refs=deps.extra.get("nutrition_refs", []),
    )
