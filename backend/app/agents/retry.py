"""Shared transient-LLM-error detection + retry + concurrency helpers.

The NVIDIA NIM hosted endpoint occasionally fails with a transient
capacity/rate-limit error, in one of two shapes depending on how its
gateway responds:
  1. HTTP 200 (stream started) but the error is embedded in the very
     first SSE chunk, e.g. "ResourceExhausted: Worker local total
     request limit reached (222/32)" — raised by the openai SDK as a
     plain `openai.APIError`.
  2. An actual non-2xx HTTP status (e.g. 503) — pydantic-ai wraps this
     as `pydantic_ai.exceptions.ModelHTTPError`.
Either way this happens before any token is produced, so the OpenAI
SDK's own `max_retries` (which only covers pre-stream connection
failures) never kicks in — the request just fails outright. Since the
failure always occurs before any output is generated, it's safe to
transparently retry (`call_with_transient_retry` /
`acall_with_transient_retry` below) with exponential backoff, up to
`MAX_TRANSIENT_RETRIES` (from `settings.LLM_MAX_TRANSIENT_RETRIES`).

Also treated as transient: `openai.APIConnectionError` (the provider
couldn't be reached at all — DNS/refused/timeout). This matters when
`LLM_BASE_URL` points at a locally-hosted model (e.g. llama.cpp/vLLM on
a machine that isn't always on) — if it's offline, requests should
transparently retry and, if `LLM_FALLBACK_MODEL`/`LLM_FALLBACK_BASE_URL`
is configured, fall through to a secondary provider instead of failing.

To avoid *causing* the capacity error in the first place, `llm_slot`
provides a process-wide asyncio semaphore that caps how many LLM
requests are in flight at once (`settings.LLM_MAX_CONCURRENCY`), so we
never push the provider past its own per-worker concurrency limit.

`agents/coach.py`'s tool-calling chat agent has its own bespoke retry
loop (with an extra guard against retrying after a tool has already
committed a DB write) rather than using the generic helpers here, but
shares the same classifier, constants, backoff, and `llm_slot`.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import openai
from pydantic_ai.exceptions import ModelHTTPError

from app.core.config import settings

log = logging.getLogger(__name__)

TRANSIENT_ERROR_MARKERS = (
    "resourceexhausted",
    "resource exhausted",
    "rate limit",
    "rate_limit",
    "overloaded",
    "try again",
    "capacity",
)
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}
# Sourced from settings so they can be tuned per-deploy via .env without a
# code change. Read once at import (a restart picks up new values, which is
# how the app is deployed anyway — see AGENTS.md).
MAX_TRANSIENT_RETRIES = settings.LLM_MAX_TRANSIENT_RETRIES
RETRY_BACKOFF_SECONDS = 1.5
# Cap so an unlucky run of retries can't sleep for minutes.
MAX_BACKOFF_SECONDS = 30.0


def backoff_delay(attempt: int) -> float:
    """Exponential backoff (with jitter) for the given 1-based attempt.

    attempt=1 -> ~1.5s, 2 -> ~3s, 3 -> ~6s, 4 -> ~12s, capped at
    `MAX_BACKOFF_SECONDS`. The jitter spreads retries out so a burst of
    concurrent requests that all hit the provider's capacity limit at once
    don't all wake up and retry in lock-step (thundering herd).
    """
    base = min(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)), MAX_BACKOFF_SECONDS)
    return base + random.uniform(0, base * 0.25)


# ── Global concurrency limiter ──────────────────────────────────────────
# A single asyncio.Semaphore caps how many LLM requests this process has in
# flight at once, so we never push a provider (NVIDIA NIM: 32 per worker)
# over its own concurrency limit. Created lazily so it binds to the running
# event loop on first use. Covers the async call sites (coach chat +
# streaming, nutrition). The sync run_sync agents (mealplan/mental/brief)
# each run in their own short-lived loop and are one-shot/low-concurrency,
# so they intentionally don't share this semaphore.
_llm_semaphore: asyncio.Semaphore | None = None


def _get_llm_semaphore() -> asyncio.Semaphore:
    global _llm_semaphore
    if _llm_semaphore is None:
        _llm_semaphore = asyncio.Semaphore(settings.LLM_MAX_CONCURRENCY)
    return _llm_semaphore


@asynccontextmanager
async def llm_slot() -> AsyncIterator[None]:
    """Acquire one of the `LLM_MAX_CONCURRENCY` global request slots.

    Anything beyond the limit awaits here until a slot frees up, instead of
    hammering the provider and getting a capacity error. For streaming the
    slot is held for the whole stream (a stream keeps the request in flight).
    """
    async with _get_llm_semaphore():
        yield


def is_transient_llm_error(exc: Exception) -> bool:
    if isinstance(exc, ModelHTTPError):
        if exc.status_code in RETRYABLE_HTTP_STATUS:
            return True
        return any(marker in str(exc).lower() for marker in TRANSIENT_ERROR_MARKERS)
    if isinstance(exc, openai.APIConnectionError):
        # Couldn't reach the provider at all (DNS failure, connection
        # refused, timed out before a response) — e.g. a local model
        # server that isn't running. Always transient: it's exactly the
        # case a configured fallback provider (LLM_FALLBACK_MODEL) exists
        # to cover, and there's no response body to pattern-match on.
        return True
    if isinstance(exc, openai.APIError):
        return any(marker in str(exc).lower() for marker in TRANSIENT_ERROR_MARKERS)
    return False


def call_with_transient_retry[T](fn: Callable[[], T], *, label: str) -> T:
    """Call `fn()`, retrying up to `MAX_TRANSIENT_RETRIES` times if it
    raises a transient LLM-provider error.

    `fn` must be a single, no-side-effect request — there's nothing to
    duplicate on retry, unlike coach.py's tool-calling agent.
    """
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if attempt >= MAX_TRANSIENT_RETRIES or not is_transient_llm_error(e):
                raise
            attempt += 1
            log.warning(
                "%s: transient LLM error (attempt %d/%d), retrying: %s",
                label,
                attempt,
                MAX_TRANSIENT_RETRIES,
                e,
            )
            time.sleep(backoff_delay(attempt))


async def acall_with_transient_retry[T](fn: Callable[[], Awaitable[T]], *, label: str) -> T:
    """Async equivalent of `call_with_transient_retry`.

    Also holds a global concurrency slot (`llm_slot`) for each attempt so
    this request counts against the process-wide in-flight LLM cap.
    """
    attempt = 0
    while True:
        try:
            async with llm_slot():
                return await fn()
        except Exception as e:  # noqa: BLE001
            if attempt >= MAX_TRANSIENT_RETRIES or not is_transient_llm_error(e):
                raise
            attempt += 1
            log.warning(
                "%s: transient LLM error (attempt %d/%d), retrying: %s",
                label,
                attempt,
                MAX_TRANSIENT_RETRIES,
                e,
            )
            await asyncio.sleep(backoff_delay(attempt))
