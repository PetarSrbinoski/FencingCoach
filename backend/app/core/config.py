"""Application configuration loaded from environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── DB ────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+psycopg://coach:changeme_dev_only@db:5432/coachapp"

    BACKEND_CORS_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

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
    # Fallback chain tried, in order, whenever the current model fails with
    # a transient error (capacity/rate-limit, or being completely
    # unreachable — e.g. a local model server that isn't running):
    # LLM_MODEL -> LLM_FALLBACK_MODEL -> LLM_FALLBACK2_MODEL. Each tier
    # defaults to the previous tier's connection details (LLM_BASE_URL/
    # LLM_API_KEY) if its own *_BASE_URL/*_API_KEY are left blank, so e.g.
    # both fallbacks can share one cloud provider's credentials while the
    # primary is a local llama.cpp/vLLM server. Set LLM_FALLBACK_MODEL to
    # "" to disable fallback entirely (LLM_FALLBACK2_MODEL is then ignored).
    LLM_FALLBACK_MODEL: str = "meta/llama-3.3-70b-instruct"
    LLM_FALLBACK_BASE_URL: str = ""
    LLM_FALLBACK_API_KEY: str = ""
    # Second-tier fallback, tried only if LLM_FALLBACK_MODEL also fails.
    LLM_FALLBACK2_MODEL: str = ""
    LLM_FALLBACK2_BASE_URL: str = ""
    LLM_FALLBACK2_API_KEY: str = ""
    LLM_MAX_TOKENS: int = 16384
    LLM_TEMPERATURE: float = 0.6
    LLM_CONTEXT_TOKENS: int = 131072
    # Request timeout (seconds) and automatic retry count for the
    # underlying HTTP client shared by every PydanticAI agent. Reasoning
    # models can legitimately take a while, but requests must not hang
    # indefinitely on a stalled connection.
    LLM_TIMEOUT_SECONDS: float = 120.0
    LLM_MAX_RETRIES: int = 2
    # How many times to transparently retry a *transient* provider error
    # (capacity/rate-limit, e.g. NVIDIA NIM's "ResourceExhausted: Worker
    # local total request limit reached"). These failures happen before any
    # token is produced, so retrying is safe. Uses exponential backoff.
    LLM_MAX_TRANSIENT_RETRIES: int = 4
    # Max number of concurrent in-flight LLM requests this process will make.
    # A global asyncio semaphore queues anything beyond this so we never push
    # the provider over its own per-worker concurrency limit (32 for NIM).
    LLM_MAX_CONCURRENCY: int = 8

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
    # USDA FoodData Central API key — used both directly by
    # services/usda.py and passed through as an env var to the local
    # USDA MCP server subprocess below.
    USDA_API_KEY: str = "DEMO_KEY"
    # Local stdio MCP server (rpassafaro/usda-api-mcp), cloned into the
    # backend image at build time (see Dockerfile) and spawned as a
    # subprocess per agent run via pydantic_ai.mcp.MCPServerStdio — no
    # external hosted dependency required. If the script isn't present
    # (e.g. running outside Docker without cloning it), USDA tools are
    # simply omitted and agents fall back to web search.
    USDA_MCP_SCRIPT: str = "/opt/usda-api-mcp/main.py"

    # ── Observability ─────────────────────────────────────────────────
    LOGFIRE_TOKEN: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
