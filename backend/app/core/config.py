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
    
    LLM_FALLBACK_MODEL: str = "meta/llama-3.3-70b-instruct"
    LLM_FALLBACK_BASE_URL: str = ""
    LLM_FALLBACK_API_KEY: str = ""

    LLM_FALLBACK2_MODEL: str = ""
    LLM_FALLBACK2_BASE_URL: str = ""
    LLM_FALLBACK2_API_KEY: str = ""
    LLM_MAX_TOKENS: int = 16384
    LLM_TEMPERATURE: float = 0.6
    LLM_CONTEXT_TOKENS: int = 131072
   
    
    LLM_TIMEOUT_SECONDS: float = 120.0
    LLM_MAX_RETRIES: int = 2
  
    
    LLM_MAX_TRANSIENT_RETRIES: int = 4
  
    LLM_MAX_CONCURRENCY: int = 8

    # ── Garmin ────────────────────────────────────────────────────────
    GARMIN_EMAIL: str = ""
    GARMIN_PASSWORD: str = ""
    GARMIN_RECENT_SYNC_MINUTES: int = 15
   
    
    GARMIN_RECENT_SYNC_DAYS: int = 2
    GARMIN_FULL_SYNC_HOUR: int = 3
   
    
    GARMIN_FULL_SYNC_DAYS: int = 30
    GARMIN_TOKEN_DIR: str = "/app/garmin_tokens"

   
    
    MORNING_BRIEF_HOUR: int = 7

    # ── Athlete ───────────────────────────────────────────────────────
    ATHLETE_TIMEZONE: str = "Europe/Berlin"
   
    
    WEEKLY_SCHEDULE: str = "fencing,gym,fencing,gym,fencing,fencing,rest"

    # ── USDA / Nutrition MCP ─────────────────────────────────────────
    
    USDA_API_KEY: str = "DEMO_KEY"
    USDA_MCP_SCRIPT: str = "/opt/usda-api-mcp/main.py"

    # ── Observability ─────────────────────────────────────────────────
    LOGFIRE_TOKEN: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
