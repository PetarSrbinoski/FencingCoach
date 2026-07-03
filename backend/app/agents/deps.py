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

from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai import InlineDefsJsonSchemaTransformer
from sqlalchemy.orm import Session

from app.core.config import settings

log = logging.getLogger(__name__)

# Model-level default settings. DeepSeek V4 Flash (NVIDIA NIM) is a reasoning
# model whose thinking mode is enabled through provider-specific
# chat_template_kwargs passed via extra_body. These defaults apply to every
# agent; per-agent model_settings (temperature/max_tokens) merge on top.
MODEL_DEFAULT_SETTINGS = OpenAIChatModelSettings(
    top_p=0.95,
    extra_body={
        "chat_template_kwargs": {
            "thinking": True,
            "reasoning_effort": "high",
        }
    },
)

# Regex to strip <think>...</think> blocks from reasoning models
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_think_tags(text: str) -> str:
    """Remove reasoning chain-of-thought tags if present."""
    return _THINK_RE.sub("", text).strip()


class ThinkTagStreamFilter:
    """Incremental variant of `strip_think_tags` for token-streaming.

    `strip_think_tags` only works on a complete string. When streaming
    deltas to a client in real time, reasoning-model output (`<think>...
    </think>`) must be withheld from the live stream too, not just
    stripped at the end — otherwise the client briefly sees raw
    chain-of-thought text before it's removed. Feed each delta chunk in
    and only the text outside `<think>` tags is returned, buffering
    partial tag boundaries that straddle two chunks.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._in_think = False

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        out = ""
        while True:
            if not self._in_think:
                idx = self._buffer.find("<think>")
                if idx == -1:
                    # Keep a small tail in case "<think>" is split across chunks.
                    safe_len = max(0, len(self._buffer) - len("<think>"))
                    out += self._buffer[:safe_len]
                    self._buffer = self._buffer[safe_len:]
                    break
                out += self._buffer[:idx]
                self._buffer = self._buffer[idx + len("<think>") :]
                self._in_think = True
            else:
                idx = self._buffer.find("</think>")
                if idx == -1:
                    # Still inside <think>; discard everything except a
                    # tail long enough to catch a "</think>" tag split
                    # across this chunk boundary and the next one.
                    keep = len("</think>") - 1
                    self._buffer = self._buffer[-keep:]
                    break
                self._buffer = self._buffer[idx + len("</think>") :]
                self._in_think = False
        return out

    def flush(self) -> str:
        """Call once the stream ends to emit any trailing safe buffer."""
        if self._in_think:
            return ""
        out, self._buffer = self._buffer, ""
        return out


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

    Uses an explicitly configured `AsyncOpenAI` client (timeout +
    max_retries) instead of the SDK defaults so a stalled connection can't
    hang a request indefinitely, and transient failures get a couple of
    automatic retries before surfacing to the caller.
    """
    from openai import AsyncOpenAI
    from pydantic_ai.providers.openai import OpenAIProvider

    api_key = settings.LLM_API_KEY or "not-needed"

    openai_client = AsyncOpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=api_key,
        timeout=settings.LLM_TIMEOUT_SECONDS,
        max_retries=settings.LLM_MAX_RETRIES,
    )
    provider = OpenAIProvider(openai_client=openai_client)

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
        settings=MODEL_DEFAULT_SETTINGS,
    )

    log.info(
        "PydanticAI model initialised: %s @ %s (timeout=%.0fs, max_retries=%d)",
        settings.LLM_MODEL,
        settings.LLM_BASE_URL,
        settings.LLM_TIMEOUT_SECONDS,
        settings.LLM_MAX_RETRIES,
    )
    return model
