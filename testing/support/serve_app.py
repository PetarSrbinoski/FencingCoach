"""Test-only ASGI entrypoint; never selected by the production Compose file."""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

if Path("/app/.env").exists() or Path(".env").exists():
    raise RuntimeError("the isolated backend must not load a private .env file")
if os.environ.get("TEST_DB_GUARD") != "isolated-fencingcoach":
    raise RuntimeError("test backend guard is missing")
if "/coachapp_testing" not in os.environ.get("DATABASE_URL", ""):
    raise RuntimeError("test backend database is not isolated")

# Set every external integration before importing application settings or agents.
for key in (
    "LLM_API_KEY",
    "LLM_FALLBACK_API_KEY",
    "LLM_FALLBACK2_API_KEY",
    "GARMIN_EMAIL",
    "GARMIN_PASSWORD",
    "USDA_API_KEY",
    "LOGFIRE_TOKEN",
):
    os.environ[key] = ""
os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9/v1"
os.environ["USDA_MCP_SCRIPT"] = "/app/testing/no-usda-mcp.py"

fixed_day = date.fromisoformat(os.environ["TEST_ATHLETE_DAY"])

from app.core import clock  # noqa: E402

original_today = clock.athlete_today

from app.agents.nutrition import NutritionEstimateOutput, NutritionItem  # noqa: E402
from app.api import nutrition  # noqa: E402
from app.main import app  # noqa: E402, F401  ASGI import exposed to uvicorn
from app.services import usda  # noqa: E402


def test_today() -> date:
    return fixed_day


# Routers and services import athlete_today directly. Replace each consuming
# binding after the application has loaded, as well as the source function.
for module in tuple(sys.modules.values()):
    if getattr(module, "athlete_today", None) is original_today:
        setattr(module, "athlete_today", test_today)
clock.athlete_today = test_today


async def fake_estimate(text: str, db: Any = None) -> NutritionEstimateOutput:
    if text.startswith("FAIL:"):
        raise RuntimeError("controlled nutrition estimate failure")
    return NutritionEstimateOutput(
        kcal=495,
        protein_g=30,
        carbs_g=60,
        fat_g=15,
        fiber_g=5,
        items=[NutritionItem(name="synthetic meal", qty_g=250)],
        confidence="high",
        notes="Synthetic estimate for isolated testing.",
    )


nutrition.estimate_nutrition = fake_estimate


def fake_cross_reference(db: Session, raw_text: str) -> list[dict[str, Any]]:
    return []


usda.cross_reference_meal = fake_cross_reference
