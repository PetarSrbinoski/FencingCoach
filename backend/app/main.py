"""FastAPI application entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    activities,
    auth,
    brief,
    chat,
    competitions,
    garmin,
    health,
    mealplan,
    metrics,
    nutrition,
    phase,
    readiness,
    targets,
    training,
)
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s"
)

app = FastAPI(title="FencingCoach AI", version="0.3.0-phase3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
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


@app.get("/")
def root() -> dict[str, str]:
    return {"app": "FencingCoach AI", "phase": "3", "docs": "/docs"}
