"""Meal-plan generation agent."""

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

from app.agents.deps import (
    CoachDeps,
    active_model_label,
    get_active_model,
    get_model,
    strip_think_tags,
)
from app.agents.retry import call_with_transient_retry
from app.core.clock import athlete_today
from app.core.config import settings
from app.models import AthleteProfile, NutritionPlan
from app.services.coach_memory import context_section as memory_context
from app.services.dietary_rules import ingredient_conflicts, resolved_rules
from app.services.mealplan import plan_meals
from app.services.targets import NutritionTargets, resolve_effective_targets
from llm.prompts.mealplan import MEALPLAN_INSTRUCTIONS

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
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    notes: str = ""


class MealPlanTotals(BaseModel):
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None


class MealPlanOutput(BaseModel):
    """Structured single-day meal plan."""

    meals: list[Meal] = Field(default_factory=list)
    totals: MealPlanTotals = Field(default_factory=MealPlanTotals)
    rationale: str = ""


# ── Agent definition ──────────────────────────────────────────────────
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
    targets: NutritionTargets = resolve_effective_targets(db, day)
    profile = db.scalar(select(AthleteProfile).limit(1))
    restrictions = (profile.dietary_restrictions or "").strip() if profile else ""
    preferences = (profile.food_preferences or "").strip() if profile else ""
    budget = (profile.food_budget or "unspecified").strip() if profile else "unspecified"
    rules = resolved_rules(restrictions)

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
        + f".\nHard dietary exclusions: {restrictions or 'none'}; resolved rules: {', '.join(rules) or 'none'}. "
        + f"Soft food preferences: {preferences or 'none'}. Budget: {budget}. "
        + "Hard exclusions take priority over budget and numerical targets. "
        + "List every ingredient in grams. Ingredient-name screening cannot verify packaged allergens or cross-contact.\nGenerate the meal plan."
    )

    user_msg += "\n" + memory_context(db, day)
    deps = CoachDeps(db=db)

    plan_data: dict = {}
    conflicts: list[str] = []
    for _ in range(2):
        try:
            result = call_with_transient_retry(
                lambda: mealplan_agent.run_sync(user_msg, deps=deps, model=get_active_model()),
                label="mealplan agent",
            )
            plan_data = result.output.model_dump()
        except Exception as e:
            log.warning("Meal-plan agent failed: %s", e)
            raise RuntimeError("Meal-plan provider failed; the previous plan is preserved") from e
        conflicts = ingredient_conflicts(plan_data, rules)
        if plan_meals(plan_data) and not conflicts:
            break
        user_msg += f"\nThe proposed plan was rejected: {', '.join(conflicts) or 'no usable meals'}. Replace it fully."
    else:
        raise ValueError(f"Meal plan could not satisfy restrictions: {', '.join(conflicts) or 'no usable meals'}; previous plan preserved")

    context = {"restrictions": restrictions, "preferences": preferences, "budget": budget, "resolved_rules": rules}
    plan_data["rationale"] = (plan_data.get("rationale") or "") + f" Budget: {budget}; preferences: {preferences or 'none'}."

    payload = {
        "plan": plan_data,
        "model": active_model_label(),
        "profile_context": context,
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
