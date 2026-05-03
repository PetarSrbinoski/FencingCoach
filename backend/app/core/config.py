"""Application configuration loaded from environment."""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── DB ────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+psycopg://coach:changeme_dev_only@db:5432/coachapp"

    # ── Auth ──────────────────────────────────────────────────────────
    APP_SECRET_KEY: str = "dev-only-change-me"
    APP_USERNAME: str = "athlete"
    APP_PASSWORD: str = "changeme_dev_only"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days

    BACKEND_CORS_ORIGINS: List[str] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ── LLM ───────────────────────────────────────────────────────────
    LLM_BASE_URL: str = "http://llm:11434/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "qwen3:8b"
    LLM_MAX_TOKENS: int = 4096
    LLM_TEMPERATURE: float = 0.7
    LLM_CONTEXT_TOKENS: int = 32768

    # ── Garmin ────────────────────────────────────────────────────────
    GARMIN_EMAIL: str = ""
    GARMIN_PASSWORD: str = ""
    GARMIN_RECENT_SYNC_MINUTES: int = 15
    GARMIN_FULL_SYNC_HOUR: int = 3
    GARMIN_TOKEN_DIR: str = "/app/garmin_tokens"

    # ── Athlete ───────────────────────────────────────────────────────
    ATHLETE_TIMEZONE: str = "Europe/Berlin"

    # ── USDA / Nutrition MCP ─────────────────────────────────────────
    USDA_API_KEY: str = "DEMO_KEY"
    USDA_MCP_URL: str = "https://usda-nutrition-mcp-oc46l7ob5a-uc.a.run.app/mcp"

    # ── Observability ─────────────────────────────────────────────────
    LOGFIRE_TOKEN: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
