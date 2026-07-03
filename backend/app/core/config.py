"""Application configuration loaded from environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── DB ────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+psycopg://coach:changeme_dev_only@db:5432/coachapp"

    BACKEND_CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ── LLM ───────────────────────────────────────────────────────────
    LLM_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "deepseek-ai/deepseek-v4-flash"
    LLM_MAX_TOKENS: int = 16384
    LLM_TEMPERATURE: float = 0.6
    LLM_CONTEXT_TOKENS: int = 131072
    # Request timeout (seconds) and automatic retry count for the
    # underlying HTTP client shared by every PydanticAI agent. Reasoning
    # models can legitimately take a while, but requests must not hang
    # indefinitely on a stalled connection.
    LLM_TIMEOUT_SECONDS: float = 120.0
    LLM_MAX_RETRIES: int = 2

    # ── Garmin ────────────────────────────────────────────────────────
    GARMIN_EMAIL: str = ""
    GARMIN_PASSWORD: str = ""
    GARMIN_RECENT_SYNC_MINUTES: int = 15
    # Single source of truth for how many days the recurring "recent" sync
    # (run every GARMIN_RECENT_SYNC_MINUTES) backfills each time.
    GARMIN_RECENT_SYNC_DAYS: int = 2
    GARMIN_FULL_SYNC_HOUR: int = 3
    # Single source of truth for how many days the *nightly* full sync
    # backfills. The manual "sync all history" action in the UI passes an
    # explicit, larger value (365) since that's a deliberate one-time deep
    # backfill, not the recurring maintenance sync.
    GARMIN_FULL_SYNC_DAYS: int = 30
    GARMIN_TOKEN_DIR: str = "/app/garmin_tokens"

    # Hour (athlete-local time, per ATHLETE_TIMEZONE) the auto morning
    # brief is generated, so it's ready by the time the athlete checks the
    # dashboard. Runs after the recurring Garmin recent-sync has had a
    # chance to pull overnight metrics.
    MORNING_BRIEF_HOUR: int = 7

    # ── Athlete ───────────────────────────────────────────────────────
    ATHLETE_TIMEZONE: str = "Europe/Berlin"
    # Default weekly training schedule, Monday first — the single source
    # of truth consumed by day-type detection and gym-session templating
    # (see app.services.schedule). Comma-separated day-types, one of:
    # rest, gym, fencing, double, competition.
    WEEKLY_SCHEDULE: str = "fencing,gym,fencing,gym,fencing,fencing,rest"

    # ── USDA / Nutrition MCP ─────────────────────────────────────────
    USDA_API_KEY: str = "DEMO_KEY"
    USDA_MCP_URL: str = "https://usda-nutrition-mcp-oc46l7ob5a-uc.a.run.app/mcp"

    # ── Observability ─────────────────────────────────────────────────
    LOGFIRE_TOKEN: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
