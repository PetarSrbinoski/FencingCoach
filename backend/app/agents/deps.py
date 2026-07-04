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

from pydantic_ai import InlineDefsJsonSchemaTransformer
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.profiles.openai import OpenAIModelProfile
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

# Settings for LLM_FALLBACK_MODEL. Deliberately plain — the fallback exists
# purely to answer when the primary (reasoning) model's shared NIM worker is
# at capacity, and non-DeepSeek models don't understand the `thinking` /
# `reasoning_effort` chat_template_kwargs above.
FALLBACK_MODEL_SETTINGS = OpenAIChatModelSettings(top_p=0.95)

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
        side_effect_committed: Set to True by any tool that commits a DB
            write (e.g. `update_day_workout`, `add_competition`). Once
            True, a transient LLM-provider error must NOT trigger a
            whole-run retry — the side effect already happened, and
            retrying risks silently duplicating it (e.g. a second
            Competition row) or redundantly re-running it.
    """

    db: Session
    context_text: str = ""
    extra: dict[str, Any] = field(default_factory=dict)
    side_effect_committed: bool = False


def _build_chat_model(
    model_name: str,
    model_settings: OpenAIChatModelSettings,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
) -> OpenAIChatModel:
    """Build a single OpenAI-compatible chat model from settings.

    Shared by `get_model()` for both the primary (`LLM_MODEL`) and, if
    configured, the fallback (`LLM_FALLBACK_MODEL`). Defaults to the
    primary's connection details (`LLM_BASE_URL`/`LLM_API_KEY`) when
    `base_url`/`api_key` aren't given, but the fallback can point at an
    entirely different provider via `LLM_FALLBACK_BASE_URL`/
    `LLM_FALLBACK_API_KEY`.
    """
    from openai import AsyncOpenAI
    from pydantic_ai.providers.openai import OpenAIProvider

    resolved_key = api_key if api_key is not None else settings.LLM_API_KEY
    resolved_key = resolved_key or "not-needed"
    resolved_base_url = base_url or settings.LLM_BASE_URL

    openai_client = AsyncOpenAI(
        base_url=resolved_base_url,
        api_key=resolved_key,
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

    return OpenAIChatModel(
        model_name,
        provider=provider,
        profile=profile,
        settings=model_settings,
    )


@lru_cache(maxsize=1)
def get_model() -> Model:
    """Build the shared model used by every PydanticAI agent.

    Works with Ollama, NVIDIA NIM, OpenRouter, Together, vLLM, llama.cpp,
    OpenAI, etc. — anything that serves an OpenAI-compatible chat endpoint.

    Uses an explicitly configured `AsyncOpenAI` client (timeout +
    max_retries) instead of the SDK defaults so a stalled connection can't
    hang a request indefinitely, and transient failures get a couple of
    automatic retries before surfacing to the caller.

    If `LLM_FALLBACK_MODEL` is set, the returned model is a `FallbackModel`
    wrapping the primary model plus the fallback: pydantic-ai retries the
    request against the fallback whenever the primary raises a *transient*
    provider error (`agents.retry.is_transient_llm_error` — the same
    definition this app's own retry-with-backoff loop uses). This is on
    top of, not instead of, that loop, which still covers the case where
    *both* models are unavailable. The fallback defaults to sharing the
    primary's connection details, but `LLM_FALLBACK_BASE_URL`/
    `LLM_FALLBACK_API_KEY` let it be a completely different provider (e.g.
    primary = local llama.cpp/vLLM, fallback = a hosted cloud endpoint) —
    `is_transient_llm_error` treats "can't connect at all" the same as a
    capacity error, so this also covers the primary being offline entirely.

    NOTE: `FallbackModel`'s own default (`fallback_on=(ModelAPIError,)`)
    deliberately isn't used here — NVIDIA NIM's actual capacity failure
    (a 200 response whose *body* embeds "ResourceExhausted", surfaced by
    the openai SDK as a plain `openai.APIError`) is *not* a
    `ModelAPIError`/`ModelHTTPError` instance, so the default would never
    trigger fallback for the failure this app actually hits in practice
    (verified against a real NIM 503 vs. this embedded-error shape).
    """
    from app.agents.retry import is_transient_llm_error

    primary = _build_chat_model(settings.LLM_MODEL, MODEL_DEFAULT_SETTINGS)
    log.info(
        "PydanticAI model initialised: %s @ %s (timeout=%.0fs, max_retries=%d)",
        settings.LLM_MODEL,
        settings.LLM_BASE_URL,
        settings.LLM_TIMEOUT_SECONDS,
        settings.LLM_MAX_RETRIES,
    )

    if not settings.LLM_FALLBACK_MODEL:
        return primary

    fallback_base_url = settings.LLM_FALLBACK_BASE_URL or settings.LLM_BASE_URL
    fallback_api_key = settings.LLM_FALLBACK_API_KEY or settings.LLM_API_KEY
    fallback = _build_chat_model(
        settings.LLM_FALLBACK_MODEL,
        FALLBACK_MODEL_SETTINGS,
        base_url=fallback_base_url,
        api_key=fallback_api_key,
    )
    log.info("Fallback model configured: %s @ %s", settings.LLM_FALLBACK_MODEL, fallback_base_url)
    return FallbackModel(primary, fallback, fallback_on=is_transient_llm_error)
