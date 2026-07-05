"""Nutrition estimation agent."""

from __future__ import annotations

import logging
import os
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.mcp import MCPServerStdio

from app.agents.deps import CoachDeps, get_active_model, get_model, strip_think_tags
from app.agents.retry import acall_with_transient_retry
from app.core.config import settings
from llm.prompts.nutrition import NUTRITION_FALLBACK_INSTRUCTIONS, NUTRITION_INSTRUCTIONS

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
    """Estimate nutrition for free-text food description. Runs to completion
    regardless of client disconnects (called from a `202`-accepted
    background job — see `api/nutrition.py`). Raises RuntimeError on
    failure rather than silently persisting a zeroed-out estimate."""
    if not text.strip():
        raise ValueError("empty food description")

    deps = CoachDeps(db=db) if db else CoachDeps(db=None)  # type: ignore[arg-type]

    try:
        result = await acall_with_transient_retry(
            lambda: nutrition_agent.run(text.strip(), deps=deps, model=get_active_model()),
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
                    lambda: nutrition_fallback_agent.run(
                        text.strip(), deps=deps, model=get_active_model()
                    ),
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
