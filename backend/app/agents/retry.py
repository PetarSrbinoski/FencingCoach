"""Shared transient-LLM-error detection + retry + concurrency helpers
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

MAX_TRANSIENT_RETRIES = settings.LLM_MAX_TRANSIENT_RETRIES
RETRY_BACKOFF_SECONDS = 1.5

MAX_BACKOFF_SECONDS = 30.0


def backoff_delay(attempt: int) -> float:
    """Exponential backoff for the given 1-based attempt.
    """
    base = min(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)), MAX_BACKOFF_SECONDS)
    return base + random.uniform(0, base * 0.25)


_llm_semaphore: asyncio.Semaphore | None = None


def _get_llm_semaphore() -> asyncio.Semaphore:
    global _llm_semaphore
    if _llm_semaphore is None:
        _llm_semaphore = asyncio.Semaphore(settings.LLM_MAX_CONCURRENCY)
    return _llm_semaphore


@asynccontextmanager
async def llm_slot() -> AsyncIterator[None]:
    """Acquire one of the `LLM_MAX_CONCURRENCY` global request slots.
    """
    async with _get_llm_semaphore():
        yield


def is_transient_llm_error(exc: Exception) -> bool:
    if isinstance(exc, ModelHTTPError):
        if exc.status_code in RETRYABLE_HTTP_STATUS:
            return True
        return any(marker in str(exc).lower() for marker in TRANSIENT_ERROR_MARKERS)
    if isinstance(exc, openai.APIConnectionError):

        return True
    if isinstance(exc, openai.APIError):
        return any(marker in str(exc).lower() for marker in TRANSIENT_ERROR_MARKERS)
    return False


def call_with_transient_retry[T](fn: Callable[[], T], *, label: str) -> T:

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
