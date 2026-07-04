"""Tests for the shared transient-LLM-error retry helpers (app.agents.retry).

Used by nutrition.py/mealplan.py for single-shot `run_sync` calls, and
by coach.py's classifier/constants (which keeps its own bespoke retry
loop with an extra tool-side-effect guard — see test_agents.py for
those tests).
"""

from __future__ import annotations

import asyncio

import httpx
import openai
import pytest
from app.agents.retry import (
    MAX_TRANSIENT_RETRIES,
    acall_with_transient_retry,
    call_with_transient_retry,
    is_transient_llm_error,
)
from pydantic_ai.exceptions import ModelHTTPError


def _make_transient_error(message="ResourceExhausted: Worker local total request limit reached"):
    request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
    return openai.APIError(message, request, body={"message": message})


class TestIsTransientLlmError:
    def test_true_for_resource_exhausted_openai_error(self):
        assert is_transient_llm_error(_make_transient_error()) is True

    def test_false_for_other_openai_errors(self):
        request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
        err = openai.APIError("Invalid request: bad schema", request, body=None)
        assert is_transient_llm_error(err) is False

    def test_false_for_non_openai_errors(self):
        assert is_transient_llm_error(ValueError("boom")) is False

    def test_true_for_model_http_error_503(self):
        err = ModelHTTPError(status_code=503, model_name="m", body={"message": "unavailable"})
        assert is_transient_llm_error(err) is True

    def test_true_for_model_http_error_429(self):
        err = ModelHTTPError(status_code=429, model_name="m", body={"message": "rate limited"})
        assert is_transient_llm_error(err) is True

    def test_false_for_model_http_error_400(self):
        err = ModelHTTPError(status_code=400, model_name="m", body={"message": "bad schema"})
        assert is_transient_llm_error(err) is False


class TestCallWithTransientRetry:
    def test_retries_then_succeeds(self, monkeypatch):
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_error()
            return "ok"

        result = call_with_transient_retry(flaky, label="test")
        assert result == "ok"
        assert calls["n"] == 2

    def test_gives_up_after_max_retries(self, monkeypatch):
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        def always_flaky():
            calls["n"] += 1
            raise _make_transient_error()

        with pytest.raises(openai.APIError):
            call_with_transient_retry(always_flaky, label="test")
        assert calls["n"] == 1 + MAX_TRANSIENT_RETRIES

    def test_does_not_retry_non_transient_error(self):
        calls = {"n": 0}

        def bad_request():
            calls["n"] += 1
            request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
            raise openai.APIError("Invalid request: bad schema", request, body=None)

        with pytest.raises(openai.APIError):
            call_with_transient_retry(bad_request, label="test")
        assert calls["n"] == 1


class TestAcallWithTransientRetry:
    def test_retries_then_succeeds(self, monkeypatch):
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        async def flaky():
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_error()
            return "ok"

        result = asyncio.run(acall_with_transient_retry(flaky, label="test"))
        assert result == "ok"
        assert calls["n"] == 2

    def test_gives_up_after_max_retries(self, monkeypatch):
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        async def always_flaky():
            calls["n"] += 1
            raise _make_transient_error()

        with pytest.raises(openai.APIError):
            asyncio.run(acall_with_transient_retry(always_flaky, label="test"))
        assert calls["n"] == 1 + MAX_TRANSIENT_RETRIES
