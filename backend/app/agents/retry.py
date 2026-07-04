"""Shared transient-LLM-error detection + retry helpers.

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
transparently retry a couple of times for any *single, no-side-effect*
LLM request (`call_with_transient_retry` / `acall_with_transient_retry`
below).

`agents/coach.py`'s tool-calling chat agent has its own bespoke retry
loop (with an extra guard against retrying after a tool has already
committed a DB write) rather than using the generic helpers here, but
shares the same classifier and constants.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

import openai
from pydantic_ai.exceptions import ModelHTTPError

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
MAX_TRANSIENT_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.5


def is_transient_llm_error(exc: Exception) -> bool:
    if isinstance(exc, ModelHTTPError):
        if exc.status_code in RETRYABLE_HTTP_STATUS:
            return True
        return any(marker in str(exc).lower() for marker in TRANSIENT_ERROR_MARKERS)
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
            time.sleep(RETRY_BACKOFF_SECONDS * attempt)


async def acall_with_transient_retry[T](fn: Callable[[], Awaitable[T]], *, label: str) -> T:
    """Async equivalent of `call_with_transient_retry`."""
    attempt = 0
    while True:
        try:
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
            await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
