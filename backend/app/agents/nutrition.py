"""Nutrition estimation agent.

Replaces `services/nutrition.py` LLM calls with a PydanticAI agent that:
- Returns structured `NutritionEstimate` output via output_type
- Uses USDA MCP tools (search_foods, get_food_details, ...) as primary
  source — a local stdio MCP server (rpassafaro/usda-api-mcp) spawned as
  a subprocess, see `_usda_mcp_available()` below
- Falls back to WebSearch (DuckDuckGo) when MCP doesn't have the food
- Strips <think> tags from reasoning models via result_validator
"""

from __future__ import annotations

import logging
import os
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.mcp import MCPServerStdio

from app.agents.deps import CoachDeps, get_model, strip_think_tags
from app.agents.retry import acall_with_transient_retry
from app.core.config import settings

log = logging.getLogger(__name__)


# ── Structured output ─────────────────────────────────────────────────
class NutritionMicros(BaseModel):
    iron_mg: float = 0
    vitamin_d_iu: float = 0
    b12_mcg: float = 0
    magnesium_mg: float = 0
    zinc_mg: float = 0
    omega3_g: float = 0


class NutritionItem(BaseModel):
    name: str
    qty_g: float


class NutritionEstimateOutput(BaseModel):
    """Structured nutrition estimate returned by the agent."""

    kcal: float = Field(description="Total kilocalories, rounded to nearest 5")
    protein_g: float = Field(description="Protein in grams, rounded to 0.5g")
    carbs_g: float = Field(description="Carbohydrates in grams, rounded to 0.5g")
    fat_g: float = Field(description="Fat in grams, rounded to 0.5g")
    fiber_g: float | None = Field(None, description="Fiber in grams")
    micros: NutritionMicros = Field(default_factory=NutritionMicros)
    items: list[NutritionItem] = Field(default_factory=list)
    confidence: str = Field("medium", description="Estimate confidence: low, medium, or high")
    notes: str = Field("", description="Assumptions or notes about the estimate")


def _clean_output(result: NutritionEstimateOutput) -> NutritionEstimateOutput:
    """Strip reasoning tags from user-visible text fields."""
    if result.notes:
        result.notes = strip_think_tags(result.notes)
    return result


# ── Agent definition ──────────────────────────────────────────────────
NUTRITION_INSTRUCTIONS = """\
You are a precise sports-nutrition macro estimator for an elite épée fencer.

Given a free-text food description, estimate its nutritional content.

Strategy:
1. FIRST try the USDA MCP tools (search_foods, get_food_details,
   get_food_nutrients) to look up actual USDA data for each food item.
   This is your most reliable source.
2. If USDA MCP doesn't have the food or returns no results, use web search
   to find nutritional information from reliable sources.
3. Combine the data into a single estimate.

Rules:
- Use USDA reference values when available. Round kcal to nearest 5,
  macros to 0.5g, micros to 1 unit.
- If a quantity is missing, assume an athlete-sized portion (e.g. 200g
  protein source, 150g cooked rice, 1 medium fruit) and note the
  assumption in notes.
- Never refuse. Always produce numbers; lower confidence if uncertain.
- Break compound meals into individual items with estimated weights."""


NUTRITION_FALLBACK_INSTRUCTIONS = """\
You are a precise sports-nutrition macro estimator for an elite épée fencer.

The USDA lookup service is unavailable for this request.

Given a free-text food description, estimate its nutritional content.

Strategy:
1. Use web search to find nutritional information from reliable sources such as
   USDA pages, major nutrition databases, or reputable food brands/restaurants.
2. Prefer sources that match the described preparation or serving size.
3. Combine the data into a single estimate.

Rules:
- Round kcal to nearest 5, macros to 0.5g, micros to 1 unit.
- If a quantity is missing, assume an athlete-sized portion (e.g. 200g
  protein source, 150g cooked rice, 1 medium fruit) and note the
  assumption in notes.
- Never refuse. Always produce numbers; lower confidence if uncertain.
- Break compound meals into individual items with estimated weights.
- Mention in notes that the estimate used web research because USDA MCP was
  unavailable."""


def _usda_mcp_available() -> bool:
    """Whether the local USDA MCP subprocess script is present."""
    return bool(settings.USDA_MCP_SCRIPT) and os.path.isfile(settings.USDA_MCP_SCRIPT)


def _build_nutrition_toolsets(include_usda: bool = True) -> list[Any]:
    """Build toolsets list for the nutrition agent."""
    toolsets = []

    # USDA Nutrition MCP server — spawned as a local stdio subprocess.
    if include_usda and _usda_mcp_available():
        mcp_server = MCPServerStdio(
            command="python",
            args=[settings.USDA_MCP_SCRIPT],
            env={"USDA_API_KEY": settings.USDA_API_KEY},
            timeout=15,
        )
        toolsets.append(mcp_server)
        log.info("Nutrition agent: USDA MCP subprocess at %s", settings.USDA_MCP_SCRIPT)

    return toolsets


def _build_nutrition_agent(
    include_usda: bool = True,
    instructions: str = NUTRITION_INSTRUCTIONS,
) -> Agent[CoachDeps, NutritionEstimateOutput]:
    return Agent(
        get_model(),
        output_type=NutritionEstimateOutput,
        instructions=instructions,
        deps_type=CoachDeps,
        toolsets=_build_nutrition_toolsets(include_usda=include_usda),
        capabilities=[WebSearch()],
        model_settings={
            "temperature": 0.1,
            "max_tokens": settings.LLM_MAX_TOKENS,
        },
    )


nutrition_agent = _build_nutrition_agent()
nutrition_fallback_agent = _build_nutrition_agent(
    include_usda=False,
    instructions=NUTRITION_FALLBACK_INSTRUCTIONS,
)


@nutrition_agent.output_validator
async def _strip_think(
    ctx: RunContext[CoachDeps], result: NutritionEstimateOutput
) -> NutritionEstimateOutput:
    """Post-process: strip any <think> artifacts from text fields."""
    return _clean_output(result)


# ── Public API (async) ──────────────────────────────────────────────────
async def estimate_nutrition(text: str, db: Any = None) -> NutritionEstimateOutput:
    """Estimate nutrition for free-text food description.

    Async so the caller (`api/nutrition.py`) can cancel it early if the
    client disconnects (see `app.core.cancellation.run_cancellable`) —
    this is a real HTTP request to the LLM and can run for several
    seconds, so a "Cancel" button on the nutrition page needs a genuine
    cancellation point rather than a fire-and-forget background call.

    Args:
        text: Free-text food description.
        db: Optional SQLAlchemy session (for future use in tools).

    Raises:
        ValueError: If text is empty.
        RuntimeError: If estimation fails (USDA + fallback agent both
            failed, or no USDA is configured and the single attempt
            failed). Callers must surface this loudly — never silently
            persist a zeroed-out estimate.
    """
    if not text.strip():
        raise ValueError("empty food description")

    deps = CoachDeps(db=db) if db else CoachDeps(db=None)  # type: ignore[arg-type]

    try:
        result = await acall_with_transient_retry(
            lambda: nutrition_agent.run(text.strip(), deps=deps),
            label="nutrition agent (primary)",
        )
        return _clean_output(result.output)
    except Exception as e:
        if _usda_mcp_available():
            log.warning(
                "Nutrition agent failed with USDA tools, retrying without USDA: %s",
                e,
            )
            try:
                fallback_result = await acall_with_transient_retry(
                    lambda: nutrition_fallback_agent.run(text.strip(), deps=deps),
                    label="nutrition agent (fallback)",
                )
                return _clean_output(fallback_result.output)
            except Exception as fallback_error:
                log.error(
                    "Nutrition agent failed after USDA-free retry: %s",
                    fallback_error,
                )
                raise RuntimeError(
                    f"nutrition estimation failed: {fallback_error}"
                ) from fallback_error
        log.error("Nutrition agent failed: %s", e)
        raise RuntimeError(f"nutrition estimation failed: {e}") from e
