"""Nutrition estimation agent.

Replaces `services/nutrition.py` LLM calls with a PydanticAI agent that:
- Returns structured `NutritionEstimate` output via output_type
- Uses USDA MCP tools (search_foods, get_food_nutrition) as primary source
- Falls back to WebSearch (DuckDuckGo) when MCP doesn't have the food
- Strips <think> tags from reasoning models via result_validator
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.mcp import MCPServerStreamableHTTP

from app.agents.deps import CoachDeps, get_model, strip_think_tags
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
    confidence: str = Field(
        "medium", description="Estimate confidence: low, medium, or high"
    )
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
1. FIRST try the USDA MCP tools (search_foods, get_food_nutrition) to look up
   actual USDA data for each food item. This is your most reliable source.
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


def _build_nutrition_toolsets(include_usda: bool = True) -> list[Any]:
    """Build toolsets list for the nutrition agent."""
    toolsets = []

    # USDA Nutrition MCP server
    if include_usda and settings.USDA_MCP_URL:
        mcp_server = MCPServerStreamableHTTP(
            url=settings.USDA_MCP_URL,
            timeout=15,
        )
        toolsets.append(mcp_server)
        log.info("Nutrition agent: USDA MCP at %s", settings.USDA_MCP_URL)

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


# ── Public API (sync wrapper) ─────────────────────────────────────────
def estimate_nutrition(text: str, db: Any = None) -> NutritionEstimateOutput:
    """Estimate nutrition for free-text food description.

    Drop-in replacement for the old `nutrition.estimate()` function.
    Returns a `NutritionEstimateOutput` Pydantic model (richer than the
    old dataclass but compatible — callers access .kcal, .protein_g, etc.)

    Args:
        text: Free-text food description.
        db: Optional SQLAlchemy session (for future use in tools).

    Raises:
        ValueError: If text is empty.
    """
    if not text.strip():
        raise ValueError("empty food description")

    deps = CoachDeps(db=db) if db else CoachDeps(db=None)  # type: ignore[arg-type]

    try:
        result = nutrition_agent.run_sync(text.strip(), deps=deps)
        return _clean_output(result.output)
    except Exception as e:
        if settings.USDA_MCP_URL:
            log.warning(
                "Nutrition agent failed with USDA tools, retrying without USDA: %s",
                e,
            )
            try:
                fallback_result = nutrition_fallback_agent.run_sync(
                    text.strip(), deps=deps
                )
                return _clean_output(fallback_result.output)
            except Exception as fallback_error:
                log.error(
                    "Nutrition agent failed after USDA-free retry: %s",
                    fallback_error,
                )
                e = fallback_error
        else:
            log.error("Nutrition agent failed: %s", e)

        # Return a minimal fallback, same as old code
        return NutritionEstimateOutput(
            kcal=0,
            protein_g=0,
            carbs_g=0,
            fat_g=0,
            confidence="low",
            notes=f"agent-failed: {e}",
        )
