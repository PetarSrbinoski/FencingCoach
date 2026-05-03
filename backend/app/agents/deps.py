"""Shared dependencies and model factory for all PydanticAI agents.

Every agent receives a `CoachDeps` instance at run-time, providing
database access and configuration. The model is constructed once from
the same LLM_BASE_URL / LLM_MODEL / LLM_API_KEY env vars the app
already uses.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai import InlineDefsJsonSchemaTransformer
from sqlalchemy.orm import Session

from app.core.config import settings

log = logging.getLogger(__name__)

# Regex to strip <think>...</think> blocks from reasoning models
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_think_tags(text: str) -> str:
    """Remove reasoning chain-of-thought tags if present."""
    return _THINK_RE.sub("", text).strip()


@dataclass
class CoachDeps:
    """Dependency container injected into every agent run.

    Fields:
        db: SQLAlchemy session for database access.
        context_text: Pre-built context snapshot (from context.py) — optional,
            used by brief/chat agents that need athlete state.
        extra: Arbitrary extra data (targets dict, mental entries, etc.)
            agents can pass through for tool/instruction use.
    """

    db: Session
    context_text: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


@lru_cache(maxsize=1)
def get_model() -> OpenAIChatModel:
    """Build the shared OpenAI-compatible model from settings.

    Works with Ollama, NVIDIA NIM, OpenRouter, Together, vLLM, llama.cpp,
    OpenAI, etc. — anything that serves an OpenAI-compatible chat endpoint.
    """
    from pydantic_ai.providers.openai import OpenAIProvider

    api_key = settings.LLM_API_KEY or "not-needed"

    provider = OpenAIProvider(
        base_url=settings.LLM_BASE_URL,
        api_key=api_key,
    )

    # Many OpenAI-compatible providers don't support strict tool definitions
    # (Ollama, NIM, etc.) so we disable that by default.
    profile = OpenAIModelProfile(
        json_schema_transformer=InlineDefsJsonSchemaTransformer,
        openai_supports_strict_tool_definition=False,
    )

    model = OpenAIChatModel(
        settings.LLM_MODEL,
        provider=provider,
        profile=profile,
    )

    log.info(
        "PydanticAI model initialised: %s @ %s",
        settings.LLM_MODEL,
        settings.LLM_BASE_URL,
    )
    return model
