"""FastAPI application entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    activities,
    brief,
    chat,
    competitions,
    garmin,
    health,
    mealplan,
    mental,
    metrics,
    nutrition,
    phase,
    profile,
    readiness,
    summaries,
    targets,
    training,
    usda,
)
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s"
)

# ── Logfire instrumentation (optional) ────────────────────────────────
if settings.LOGFIRE_TOKEN:
    try:
        import logfire

        logfire.configure(token=settings.LOGFIRE_TOKEN)
        logfire.instrument_pydantic_ai()
        logging.getLogger(__name__).info("Logfire instrumentation enabled")
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("Logfire setup failed: %s", e)

app = FastAPI(title="FencingCoach AI", version="0.4.0-agents")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(garmin.router)
app.include_router(readiness.router)
app.include_router(metrics.router)
app.include_router(activities.router)
app.include_router(nutrition.router)
app.include_router(brief.router)
app.include_router(phase.router)
app.include_router(targets.router)
app.include_router(mealplan.router)
app.include_router(mealplan.shopping_router)
app.include_router(training.router)
app.include_router(competitions.router)
app.include_router(profile.router)
app.include_router(mental.router)
app.include_router(usda.router)
app.include_router(summaries.router)


@app.get("/")
def root() -> dict[str, str]:
    return {"app": "FencingCoach AI", "phase": "3", "docs": "/docs"}
