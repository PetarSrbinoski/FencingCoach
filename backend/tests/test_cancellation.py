"""Tests for app.core.cancellation.run_cancellable.

Used by POST /nutrition/estimate to actually cancel the in-flight LLM
call (not just abandon the client-side fetch) when the athlete cancels
from the UI — see app/api/nutrition.py.
"""

from __future__ import annotations

import asyncio

import pytest
from app.core.cancellation import run_cancellable
from fastapi import HTTPException


class _FakeRequest:
    """Minimal stand-in for fastapi.Request — only `is_disconnected()` is
    used by run_cancellable."""

    def __init__(self, disconnect_after: float | None = None):
        self._disconnect_after = disconnect_after
        self._start: float | None = None

    async def is_disconnected(self) -> bool:
        if self._disconnect_after is None:
            return False
        loop = asyncio.get_running_loop()
        if self._start is None:
            self._start = loop.time()
        return (loop.time() - self._start) >= self._disconnect_after


class TestRunCancellable:
    def test_returns_result_when_work_finishes_first(self):
        async def work():
            await asyncio.sleep(0.05)
            return "done"

        request = _FakeRequest(disconnect_after=None)
        result = asyncio.run(run_cancellable(request, work()))
        assert result == "done"

    def test_propagates_exception_from_work(self):
        async def work():
            raise ValueError("boom")

        request = _FakeRequest(disconnect_after=None)
        with pytest.raises(ValueError, match="boom"):
            asyncio.run(run_cancellable(request, work()))

    def test_cancels_work_when_client_disconnects_first(self):
        cancelled = {"flag": False}

        async def work():
            try:
                await asyncio.sleep(5)
                return "should not get here"
            except asyncio.CancelledError:
                cancelled["flag"] = True
                raise

        # Disconnect is detected on the very first poll (interval is
        # patched to 0 below), well before the 5s sleep in `work`.
        request = _FakeRequest(disconnect_after=0)
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(run_cancellable(request, work()))

        assert exc_info.value.status_code == 499
        assert cancelled["flag"] is True

    def test_poll_interval_does_not_block_fast_work(self, monkeypatch):
        # Even with a slow poll interval, fast work should return promptly
        # (the two tasks race via asyncio.wait/FIRST_COMPLETED).
        monkeypatch.setattr("app.core.cancellation.POLL_INTERVAL_SECONDS", 10)

        async def work():
            return "fast"

        request = _FakeRequest(disconnect_after=None)
        result = asyncio.run(run_cancellable(request, work()))
        assert result == "fast"
