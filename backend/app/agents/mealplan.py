"""Meal-plan generation agent.

Replaces `services/mealplan.py` LLM call with a PydanticAI agent that:
- Returns structured meal plan JSON via output_type
- Has access to USDA MCP + WebSearch for ingredient research
- Receives targets/timing via the user prompt (same as before)
"""

from __future__ import annotations

import logging
import os
from datetime import date

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.mcp import MCPServerStdio
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.agents.deps import CoachDeps, get_model, strip_think_tags
from app.agents.retry import call_with_transient_retry
from app.core.clock import athlete_today
from app.core.config import settings
from app.models import NutritionPlan
from app.services.targets import NutritionTargets, compute_targets

log = logging.getLogger(__name__)


# ── Structured output ─────────────────────────────────────────────────
class MealIngredient(BaseModel):
    name: str
    qty_g: float


class Meal(BaseModel):
    slot: str = Field(
        description="One of: breakfast, lunch, dinner, snack, pre_workout, post_workout"
    )
    time: str = Field(description="HH:MM format")
    name: str
    ingredients: list[MealIngredient] = Field(default_factory=list)
    kcal: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    notes: str = ""


class MealPlanTotals(BaseModel):
    kcal: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


class MealPlanOutput(BaseModel):
    """Structured single-day meal plan."""

    meals: list[Meal] = Field(default_factory=list)
    totals: MealPlanTotals = Field(default_factory=MealPlanTotals)
    rationale: str = ""


# ── Agent definition ──────────────────────────────────────────────────
MEALPLAN_INSTRUCTIONS = """\
You are a sports dietitian generating a one-day meal plan for an elite épée fencer.

Rules:
- Hit the daily targets within ±5%. If impossible, get as close as possible
  and explain in rationale.
- Time meals around training. If fencing at 20:00, place pre_workout ~17:30,
  dinner/post_workout ~22:30. If gym daytime, place pre 60-90 min before.
- Use realistic, budget-moderate whole foods. No supplements in the meal list.
- Per-ingredient qty_g is grams of the food as eaten/cooked unless naturally
  counted (eggs → ~50g each).
- Include 35+ g fiber/day across meals.
- Use USDA MCP tools to verify nutritional values of key ingredients when
  possible. Use web search for less common foods.
"""


def _build_mealplan_toolsets() -> list:
    """Build toolsets: USDA MCP (local stdio subprocess) + WebSearch."""
    toolsets = []
    if settings.USDA_MCP_SCRIPT and os.path.isfile(settings.USDA_MCP_SCRIPT):
        toolsets.append(
            MCPServerStdio(
                command="python",
                args=[settings.USDA_MCP_SCRIPT],
                env={"USDA_API_KEY": settings.USDA_API_KEY},
                timeout=15,
            )
        )
    return toolsets


mealplan_agent = Agent(
    get_model(),
    output_type=MealPlanOutput,
    instructions=MEALPLAN_INSTRUCTIONS,
    deps_type=CoachDeps,
    toolsets=_build_mealplan_toolsets(),
    capabilities=[WebSearch()],
    model_settings={
        "temperature": 0.4,
        "max_tokens": 2000,
    },
)


@mealplan_agent.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: MealPlanOutput) -> MealPlanOutput:
    if result.rationale:
        result.rationale = strip_think_tags(result.rationale)
    for meal in result.meals:
        if meal.notes:
            meal.notes = strip_think_tags(meal.notes)
    return result


# ── Public API ────────────────────────────────────────────────────────
def generate_meal_plan(db: Session, day: date | None = None) -> NutritionPlan:
    """Generate a single-day meal plan and persist to DB.

    Drop-in replacement for `services/mealplan.generate_day_plan()`.
    """
    day = day or athlete_today()
    targets: NutritionTargets = compute_targets(db, day)

    user_msg = (
        f"Date: {day.isoformat()} ({day.strftime('%A')})\n"
        f"Day type: {targets.day_type}; phase: {targets.phase}\n"
        f"Targets: {targets.kcal:.0f} kcal, P {targets.protein_g} / "
        f"C {targets.carbs_g} / F {targets.fat_g} g, fiber ≥ {targets.fiber_g} g\n"
        f"Athlete weight: {targets.weight_kg} kg\n"
        f"Notes: {targets.notes}\n"
        f"Training timing on this day: "
        + (
            "fencing 20:00 (≈2h)"
            if targets.day_type in ("fencing", "double") and day.weekday() != 5
            else "Saturday fencing 11:00 (≈2h)"
            if day.weekday() == 5
            else "gym daytime (flexible)"
            if targets.day_type == "gym"
            else "rest day"
            if targets.day_type == "rest"
            else "competition day"
        )
        + ".\nGenerate the meal plan."
    )

    deps = CoachDeps(db=db)

    try:
        result = call_with_transient_retry(
            lambda: mealplan_agent.run_sync(user_msg, deps=deps),
            label="mealplan agent",
        )
        plan_data = result.output.model_dump()
    except Exception as e:
        log.warning("Meal-plan agent failed: %s", e)
        plan_data = {"meals": [], "totals": {}, "rationale": f"agent-failed: {e}"}

    payload = {
        "plan": plan_data,
        "model": settings.LLM_MODEL,
    }
    targets_payload = targets.to_dict()

    stmt = pg_insert(NutritionPlan).values(
        day=day,
        targets=targets_payload,
        plan=payload,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["day"],
        set_={"targets": stmt.excluded.targets, "plan": stmt.excluded.plan},
    )
    db.execute(stmt)
    db.commit()
    plan = db.scalar(select(NutritionPlan).where(NutritionPlan.day == day))
    if plan is None:
        # Should be unreachable — we just upserted this row.
        raise RuntimeError(f"NutritionPlan for {day} vanished immediately after upsert")
    return plan
