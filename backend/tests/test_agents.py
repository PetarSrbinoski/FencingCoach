"""Tests for PydanticAI agent construction and configuration.

These tests verify agent setup without making actual LLM calls
(using PydanticAI's TestModel for dry-run validation).
"""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

# Override DATABASE_URL before any app imports
os.environ.setdefault("DATABASE_URL", "sqlite://")

import httpx
import openai
import pytest
from app.agents.brief import brief_agent
from app.agents.coach import (
    ChatResult,
    _db_messages_to_history,
    _is_transient_llm_error,
    _wants_web_search,
    coach_agent,
    coach_agent_search,
    run_coach_chat,
    stream_coach_chat,
)
from app.agents.deps import CoachDeps, ThinkTagStreamFilter, strip_think_tags
from app.agents.mealplan import MealPlanOutput, mealplan_agent
from app.agents.mental import mental_agent
from app.agents.nutrition import (
    NutritionEstimateOutput,
    NutritionMicros,
    estimate_nutrition,
    nutrition_agent,
    nutrition_fallback_agent,
)
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError


# ── deps / model ──────────────────────────────────────────────────────
class TestDeps:
    def test_coach_deps_defaults(self):
        deps = CoachDeps(db=None)  # type: ignore
        assert deps.context_text == ""
        assert deps.extra == {}

    def test_coach_deps_with_context(self):
        deps = CoachDeps(db=None, context_text="test context")  # type: ignore
        assert deps.context_text == "test context"


class TestStripThink:
    def test_strips_think_block(self):
        text = "Hello <think>internal reasoning</think> World"
        assert strip_think_tags(text) == "Hello  World"

    def test_strips_multiline_think(self):
        text = "<think>\nstep 1\nstep 2\n</think>\nAnswer: 42"
        assert strip_think_tags(text) == "Answer: 42"

    def test_no_think_passthrough(self):
        text = "Just plain text"
        assert strip_think_tags(text) == "Just plain text"

    def test_empty_string(self):
        assert strip_think_tags("") == ""


class TestThinkTagStreamFilter:
    def test_passthrough_when_no_think_tag(self):
        f = ThinkTagStreamFilter()
        out = f.feed("Hello world") + f.flush()
        assert out == "Hello world"

    def test_withholds_content_inside_think_block(self):
        f = ThinkTagStreamFilter()
        out = f.feed("<think>secret reasoning</think>Answer: 42") + f.flush()
        assert out == "Answer: 42"

    def test_handles_think_tag_split_across_chunks(self):
        f = ThinkTagStreamFilter()
        out = ""
        for chunk in ["Hi <thi", "nk>reason", "ing</thi", "nk> there"]:
            out += f.feed(chunk)
        out += f.flush()
        assert out == "Hi  there"

    def test_streams_incrementally_before_think_tag(self):
        f = ThinkTagStreamFilter()
        # A safety tail (len("<think>")-worth) is always withheld in case
        # the next chunk continues a split "<think>" tag; the rest streams
        # immediately rather than waiting for flush().
        visible = f.feed("Some visible text ")
        assert visible == "Some visibl"
        assert visible + f.flush() == "Some visible text "

    def test_multiple_think_blocks(self):
        f = ThinkTagStreamFilter()
        out = f.feed("<think>a</think>Part one. <think>b</think>Part two.") + f.flush()
        assert out == "Part one. Part two."

    def test_never_closed_think_block_withholds_everything_after(self):
        f = ThinkTagStreamFilter()
        out = f.feed("visible <think>never closes") + f.flush()
        assert out == "visible "


# ── nutrition agent ───────────────────────────────────────────────────
class TestNutritionAgent:
    def test_agent_is_configured(self):
        assert isinstance(nutrition_agent, Agent)

    def test_output_type(self):
        """The nutrition agent should produce NutritionEstimateOutput."""
        assert nutrition_agent._output_type is NutritionEstimateOutput

    def test_nutrition_estimate_output_model(self):
        """NutritionEstimateOutput should serialize correctly."""
        est = NutritionEstimateOutput(
            kcal=500,
            protein_g=30,
            carbs_g=60,
            fat_g=15,
            fiber_g=8,
            micros=NutritionMicros(iron_mg=3, magnesium_mg=50),
            items=[],
            confidence="high",
            notes="test",
        )
        d = est.model_dump()
        assert d["kcal"] == 500
        assert d["micros"]["iron_mg"] == 3

    def test_estimate_nutrition_empty_raises(self):
        """Empty text should raise ValueError."""
        with pytest.raises(ValueError, match="empty food description"):
            estimate_nutrition("")

    def test_estimate_nutrition_whitespace_raises(self):
        with pytest.raises(ValueError, match="empty food description"):
            estimate_nutrition("   ")

    def test_estimate_nutrition_retries_without_usda(self, monkeypatch):
        calls: list[str] = []

        def fail_primary(text, deps):
            calls.append(f"primary:{text}")
            raise RuntimeError("503 Service Unavailable")

        fallback_output = NutritionEstimateOutput(
            kcal=640,
            protein_g=42,
            carbs_g=55,
            fat_g=24,
            fiber_g=9,
            confidence="medium",
            notes="Used web research while USDA MCP was unavailable.",
        )

        def succeed_fallback(text, deps):
            calls.append(f"fallback:{text}")
            return SimpleNamespace(output=fallback_output)

        monkeypatch.setattr(nutrition_agent, "run_sync", fail_primary)
        monkeypatch.setattr(nutrition_fallback_agent, "run_sync", succeed_fallback)

        result = estimate_nutrition("chicken burrito bowl")

        assert result == fallback_output
        assert calls == [
            "primary:chicken burrito bowl",
            "fallback:chicken burrito bowl",
        ]

    def test_estimate_nutrition_raises_when_both_agents_fail(self, monkeypatch):
        """Hard-fail loudly — never silently persist a fabricated zero estimate."""

        def fail(text, deps):
            raise RuntimeError("upstream LLM timeout")

        monkeypatch.setattr(nutrition_agent, "run_sync", fail)
        monkeypatch.setattr(nutrition_fallback_agent, "run_sync", fail)

        with pytest.raises(RuntimeError, match="nutrition estimation failed"):
            estimate_nutrition("chicken burrito bowl")

    def test_estimate_nutrition_raises_when_no_usda_configured(self, monkeypatch):
        """Without USDA configured there's no fallback agent to retry with —
        a primary failure must still raise, not return zeros."""
        monkeypatch.setattr("app.agents.nutrition.settings.USDA_MCP_URL", "", raising=False)

        def fail(text, deps):
            raise RuntimeError("network error")

        monkeypatch.setattr(nutrition_agent, "run_sync", fail)

        with pytest.raises(RuntimeError, match="nutrition estimation failed"):
            estimate_nutrition("chicken burrito bowl")


# ── mealplan agent ────────────────────────────────────────────────────
class TestMealPlanAgent:
    def test_agent_is_configured(self):
        assert isinstance(mealplan_agent, Agent)

    def test_output_type(self):
        assert mealplan_agent._output_type is MealPlanOutput

    def test_mealplan_output_model(self):
        plan = MealPlanOutput(
            meals=[],
            rationale="test plan",
        )
        d = plan.model_dump()
        assert d["rationale"] == "test plan"
        assert d["meals"] == []


# ── brief agent ───────────────────────────────────────────────────────
class TestBriefAgent:
    def test_agent_is_configured(self):
        assert isinstance(brief_agent, Agent)

    def test_output_type_is_str(self):
        assert brief_agent._output_type is str


# ── mental agent ──────────────────────────────────────────────────────
class TestMentalAgent:
    def test_agent_is_configured(self):
        assert isinstance(mental_agent, Agent)

    def test_output_type_is_str(self):
        assert mental_agent._output_type is str


# ── coach agent ───────────────────────────────────────────────────────
class TestCoachAgent:
    def test_agent_is_configured(self):
        assert isinstance(coach_agent, Agent)

    def test_output_type_is_str(self):
        assert coach_agent._output_type is str

    def test_db_messages_to_history_empty(self):
        history = _db_messages_to_history([])
        assert history == []

    def test_chat_result_fields(self):
        r = ChatResult(reply="Hello", model="test-model")
        assert r.reply == "Hello"
        assert r.model == "test-model"
        assert r.ungrounded_claims == []

    def test_run_coach_chat_flags_ungrounded_claims(self, monkeypatch):
        async def fake_run(user_prompt, deps=None, message_history=None):
            return SimpleNamespace(output="Your HRV was 99 last night.")

        monkeypatch.setattr(coach_agent, "run", fake_run)

        result = asyncio.run(run_coach_chat("how am I doing?", context_text="HRV: 55ms, Sleep: 7h"))
        assert result.reply == "Your HRV was 99 last night."
        assert len(result.ungrounded_claims) == 1
        assert "99" in result.ungrounded_claims[0]

    def test_run_coach_chat_no_flags_when_grounded(self, monkeypatch):
        async def fake_run(user_prompt, deps=None, message_history=None):
            return SimpleNamespace(output="Your HRV was 55 last night.")

        monkeypatch.setattr(coach_agent, "run", fake_run)

        result = asyncio.run(run_coach_chat("how am I doing?", context_text="HRV: 55ms, Sleep: 7h"))
        assert result.ungrounded_claims == []

    def test_stream_coach_chat_filters_think_tags_and_flags_grounding(self, monkeypatch):
        class _FakeStream:
            def __init__(self, deltas):
                self._deltas = deltas

            async def stream_text(self, delta=True):
                for d in self._deltas:
                    yield d

        class _FakeStreamCM:
            def __init__(self, deltas):
                self._deltas = deltas

            async def __aenter__(self):
                return _FakeStream(self._deltas)

            async def __aexit__(self, *a):
                return False

        def fake_run_stream(user_prompt, deps=None, message_history=None):
            return _FakeStreamCM(["<think>internal reasoning</think>Your HRV was 99 today."])

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)

        async def collect():
            items = []
            async for item in stream_coach_chat("how am I doing?", context_text="HRV: 55ms"):
                items.append(item)
            return items

        items = asyncio.run(collect())
        deltas = [i["delta"] for i in items if "delta" in i]
        assert "".join(deltas) == "Your HRV was 99 today."
        assert "internal reasoning" not in "".join(deltas)

        final = items[-1]
        assert final["done"] is True
        assert final["reply"] == "Your HRV was 99 today."
        assert len(final["ungrounded_claims"]) == 1


# ── coach web-search gating ─────────────────────────────────────────────
class TestCoachWebSearchGating:
    """Web search must only fire when the athlete explicitly asks for it —
    trusting the model's own judgment let it search for e.g. "hello"."""

    @pytest.mark.parametrize(
        "message",
        [
            "hello",
            "how am I doing today?",
            "what should I eat before fencing?",
            "plan my gym session for tomorrow",
        ],
    )
    def test_no_search_intent_for_normal_messages(self, message):
        assert _wants_web_search(message) is False

    @pytest.mark.parametrize(
        "message",
        [
            "can you search the web for the latest fencing rule changes?",
            "google the address of the next competition venue",
            "look up how many calories are in a Big Mac",
            "please look online for a good recovery protocol",
            "check online for today's weather in Berlin",
        ],
    )
    def test_search_intent_for_explicit_requests(self, message):
        assert _wants_web_search(message) is True

    def test_run_coach_chat_uses_plain_agent_by_default(self, monkeypatch):
        async def fake_run(user_prompt, deps=None, message_history=None):
            return SimpleNamespace(output="Hey! How can I help?")

        def fail_run(*a, **kw):  # pragma: no cover - should never be called
            raise AssertionError("coach_agent_search.run should not be called")

        monkeypatch.setattr(coach_agent, "run", fake_run)
        monkeypatch.setattr(coach_agent_search, "run", fail_run)

        result = asyncio.run(run_coach_chat("hello", context_text=""))
        assert result.reply == "Hey! How can I help?"

    def test_run_coach_chat_uses_search_agent_when_explicitly_asked(self, monkeypatch):
        async def fake_run(user_prompt, deps=None, message_history=None):
            return SimpleNamespace(output="Found it via search.")

        def fail_run(*a, **kw):  # pragma: no cover - should never be called
            raise AssertionError("coach_agent.run should not be called")

        monkeypatch.setattr(coach_agent, "run", fail_run)
        monkeypatch.setattr(coach_agent_search, "run", fake_run)

        result = asyncio.run(run_coach_chat("please search the web for X", context_text=""))
        assert result.reply == "Found it via search."


# ── transient NVIDIA NIM stream-error retry ─────────────────────────────
def _make_transient_error(
    message="ResourceExhausted: Worker local total request limit reached (222/32)",
):
    """Mimics failure mode 1: HTTP 200 + an error embedded in the first
    SSE chunk, raised by the openai SDK as a plain APIError
    (agent.run_stream path)."""
    request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
    return openai.APIError(message, request, body={"message": message})


def _make_transient_http_error(
    status_code=503,
    message="ResourceExhausted: Worker local total request limit reached (33/32)",
):
    """Mimics failure mode 2: an actual non-2xx HTTP status, wrapped by
    pydantic-ai as ModelHTTPError (agent.run path)."""
    return ModelHTTPError(
        status_code=status_code,
        model_name="deepseek-ai/deepseek-v4-flash",
        body={"message": message, "type": "Service Unavailable", "code": status_code},
    )


class TestCoachTransientErrorRetry:
    def test_is_transient_llm_error_matches_resource_exhausted(self):
        assert _is_transient_llm_error(_make_transient_error()) is True

    def test_is_transient_llm_error_false_for_other_openai_errors(self):
        request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
        err = openai.APIError("Invalid request: bad schema", request, body=None)
        assert _is_transient_llm_error(err) is False

    def test_is_transient_llm_error_false_for_non_openai_errors(self):
        assert _is_transient_llm_error(ValueError("boom")) is False

    def test_is_transient_llm_error_true_for_model_http_error_503(self):
        assert _is_transient_llm_error(_make_transient_http_error(503)) is True

    def test_is_transient_llm_error_true_for_model_http_error_429(self):
        assert _is_transient_llm_error(_make_transient_http_error(429)) is True

    def test_is_transient_llm_error_false_for_model_http_error_400(self):
        err = ModelHTTPError(
            status_code=400,
            model_name="deepseek-ai/deepseek-v4-flash",
            body={"message": "Invalid request: bad schema"},
        )
        assert _is_transient_llm_error(err) is False

    def test_run_coach_chat_retries_transient_error_then_succeeds(self, monkeypatch):
        calls = {"n": 0}

        async def flaky_run(user_prompt, deps=None, message_history=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_error()
            return SimpleNamespace(output="Hey, all good now.")

        monkeypatch.setattr(coach_agent, "run", flaky_run)
        monkeypatch.setattr("app.agents.coach._RETRY_BACKOFF_SECONDS", 0)

        result = asyncio.run(run_coach_chat("hello", context_text=""))
        assert result.reply == "Hey, all good now."
        assert calls["n"] == 2

    def test_run_coach_chat_retries_model_http_error_then_succeeds(self, monkeypatch):
        """Regression test: the actual production failure was a real HTTP
        503 from NVIDIA NIM, wrapped by pydantic-ai as ModelHTTPError —
        not an openai.APIError. The retry logic must handle both shapes."""
        calls = {"n": 0}

        async def flaky_run(user_prompt, deps=None, message_history=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_http_error()
            return SimpleNamespace(output="Hey, all good now.")

        monkeypatch.setattr(coach_agent, "run", flaky_run)
        monkeypatch.setattr("app.agents.coach._RETRY_BACKOFF_SECONDS", 0)

        result = asyncio.run(run_coach_chat("hello", context_text=""))
        assert result.reply == "Hey, all good now."
        assert calls["n"] == 2

    def test_run_coach_chat_gives_up_after_max_retries(self, monkeypatch):
        calls = {"n": 0}

        async def always_flaky_run(user_prompt, deps=None, message_history=None):
            calls["n"] += 1
            raise _make_transient_error()

        monkeypatch.setattr(coach_agent, "run", always_flaky_run)
        monkeypatch.setattr("app.agents.coach._RETRY_BACKOFF_SECONDS", 0)

        with pytest.raises(openai.APIError):
            asyncio.run(run_coach_chat("hello", context_text=""))
        # initial attempt + _MAX_TRANSIENT_RETRIES retries
        assert calls["n"] == 3

    def test_run_coach_chat_does_not_retry_non_transient_error(self, monkeypatch):
        calls = {"n": 0}

        async def bad_request_run(user_prompt, deps=None, message_history=None):
            calls["n"] += 1
            request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
            raise openai.APIError("Invalid request: bad schema", request, body=None)

        monkeypatch.setattr(coach_agent, "run", bad_request_run)

        with pytest.raises(openai.APIError):
            asyncio.run(run_coach_chat("hello", context_text=""))
        assert calls["n"] == 1

    def test_stream_coach_chat_retries_transient_error_before_any_delta(self, monkeypatch):
        calls = {"n": 0}

        class _FakeStream:
            def __init__(self, deltas):
                self._deltas = deltas

            async def stream_text(self, delta=True):
                for d in self._deltas:
                    yield d

        class _FakeStreamCM:
            def __init__(self, deltas):
                self._deltas = deltas

            async def __aenter__(self):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise _make_transient_error()
                return _FakeStream(self._deltas)

            async def __aexit__(self, *a):
                return False

        def fake_run_stream(user_prompt, deps=None, message_history=None):
            return _FakeStreamCM(["All good now."])

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)
        monkeypatch.setattr("app.agents.coach._RETRY_BACKOFF_SECONDS", 0)

        async def collect():
            items = []
            async for item in stream_coach_chat("hello", context_text=""):
                items.append(item)
            return items

        items = asyncio.run(collect())
        deltas = [i["delta"] for i in items if "delta" in i]
        assert "".join(deltas) == "All good now."
        assert calls["n"] == 2
