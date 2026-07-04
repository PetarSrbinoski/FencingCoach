"""Shared dependencies and model factory for all PydanticAI agents.

Every agent receives a `CoachDeps` instance at run-time, providing
database access and configuration. Which model actually answers a given
run is decided by the athlete's manual local/cloud toggle
(`get_active_model()`, backed by `services.llm_provider` + the
`PUT /settings/llm-provider` endpoint) rather than automatic
fallback-on-error between local and cloud — see `get_model_for_provider()`
below for what each pool means.
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


@lru_cache(maxsize=4)
def get_model_for_provider(provider: str) -> Model:
    """Build (and cache) the model for one provider pool: `"local"` or
    `"cloud"`.

    - `"local"`: just `LLM_MODEL` @ `LLM_BASE_URL`/`LLM_API_KEY` — no
      fallback. If it fails, it fails; the athlete explicitly chose local.
    - `"cloud"`: `LLM_FALLBACK_MODEL` @ `LLM_FALLBACK_BASE_URL`/
      `LLM_FALLBACK_API_KEY`, cascading to `LLM_FALLBACK2_MODEL` (if
      configured) on a *transient* provider error
      (`agents.retry.is_transient_llm_error`) — both tiers here are
      already "cloud", so that cascade is still useful (e.g. NIM capacity
      errors), unlike an automatic local->cloud escalation.

    Which pool is actually used for a given request is decided by
    `get_active_model()` below, driven by the athlete's manual toggle
    (`services.llm_provider`) — this function just builds either pool on
    demand, cached so repeated calls (and repeated toggle flips back to a
    pool already built) don't reconnect.
    """
    if provider == "local":
        model = _build_chat_model(settings.LLM_MODEL, MODEL_DEFAULT_SETTINGS)
        log.info(
            "LLM provider 'local' initialised: %s @ %s (timeout=%.0fs, max_retries=%d)",
            settings.LLM_MODEL,
            settings.LLM_BASE_URL,
            settings.LLM_TIMEOUT_SECONDS,
            settings.LLM_MAX_RETRIES,
        )
        return model

    if provider == "cloud":
        if not settings.LLM_FALLBACK_MODEL:
            raise RuntimeError(
                "LLM provider 'cloud' selected but LLM_FALLBACK_MODEL is not configured"
            )
        from app.agents.retry import is_transient_llm_error

        cloud1_base_url = settings.LLM_FALLBACK_BASE_URL or settings.LLM_BASE_URL
        cloud1_api_key = settings.LLM_FALLBACK_API_KEY or settings.LLM_API_KEY
        cloud1 = _build_chat_model(
            settings.LLM_FALLBACK_MODEL,
            FALLBACK_MODEL_SETTINGS,
            base_url=cloud1_base_url,
            api_key=cloud1_api_key,
        )
        log.info(
            "LLM provider 'cloud' tier 1 initialised: %s @ %s",
            settings.LLM_FALLBACK_MODEL,
            cloud1_base_url,
        )

        if not settings.LLM_FALLBACK2_MODEL:
            return cloud1

        cloud2_base_url = settings.LLM_FALLBACK2_BASE_URL or cloud1_base_url
        cloud2_api_key = settings.LLM_FALLBACK2_API_KEY or cloud1_api_key
        cloud2 = _build_chat_model(
            settings.LLM_FALLBACK2_MODEL,
            FALLBACK_MODEL_SETTINGS,
            base_url=cloud2_base_url,
            api_key=cloud2_api_key,
        )
        log.info(
            "LLM provider 'cloud' tier 2 initialised: %s @ %s",
            settings.LLM_FALLBACK2_MODEL,
            cloud2_base_url,
        )
        return FallbackModel(cloud1, cloud2, fallback_on=is_transient_llm_error)

    raise ValueError(f"unknown LLM provider {provider!r}")


# In-process cache of the athlete's manual local/cloud choice. Hydrated from
# `app_settings` once at startup (see `main.py`'s startup hook) and updated
# immediately whenever the toggle is flipped via `PUT /settings/llm-provider`
# — so it takes effect on the very next request, no restart required.
_active_provider: str = "local"


def set_active_provider(provider: str) -> None:
    """Update the in-process active provider (call after persisting it)."""
    global _active_provider
    _active_provider = provider


def get_active_provider() -> str:
    return _active_provider


def get_active_model() -> Model:
    """The model every agent run should actually use for this request —
    resolved from the athlete's current local/cloud toggle."""
    return get_model_for_provider(get_active_provider())


def active_model_label() -> str:
    """Human-readable model name for the currently active provider, for
    status messages / logging (doesn't require constructing the model)."""
    if get_active_provider() == "cloud":
        return settings.LLM_FALLBACK_MODEL or settings.LLM_MODEL
    return settings.LLM_MODEL


def get_model() -> Model:
    """Backward-compatible placeholder model for `Agent(...)` construction
    at import time (before the active provider is hydrated from the DB).

    Every actual agent run passes `model=get_active_model()` explicitly
    (see coach.py/nutrition.py/mealplan.py/mental.py/brief.py), which
    overrides whatever was set here — so this only matters in that it must
    be a validly constructible model, not that it's the "right" one.
    """
    return get_model_for_provider("local")
