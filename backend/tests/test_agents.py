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

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from app.agents.deps import CoachDeps, ThinkTagStreamFilter, get_model, strip_think_tags
from app.agents.nutrition import (
    NutritionEstimateOutput,
    NutritionMicros,
    estimate_nutrition,
    nutrition_fallback_agent,
    nutrition_agent,
)
from app.agents.mealplan import MealPlanOutput, mealplan_agent
from app.agents.brief import brief_agent
from app.agents.mental import mental_agent, generate_mental_insight
from app.agents.coach import (
    coach_agent,
    _db_messages_to_history,
    ChatResult,
    run_coach_chat,
    stream_coach_chat,
)


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
        monkeypatch.setattr(
            "app.agents.nutrition.settings.USDA_MCP_URL", "", raising=False
        )

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

        result = asyncio.run(
            run_coach_chat("how am I doing?", context_text="HRV: 55ms, Sleep: 7h")
        )
        assert result.reply == "Your HRV was 99 last night."
        assert len(result.ungrounded_claims) == 1
        assert "99" in result.ungrounded_claims[0]

    def test_run_coach_chat_no_flags_when_grounded(self, monkeypatch):
        async def fake_run(user_prompt, deps=None, message_history=None):
            return SimpleNamespace(output="Your HRV was 55 last night.")

        monkeypatch.setattr(coach_agent, "run", fake_run)

        result = asyncio.run(
            run_coach_chat("how am I doing?", context_text="HRV: 55ms, Sleep: 7h")
        )
        assert result.ungrounded_claims == []

    def test_stream_coach_chat_filters_think_tags_and_flags_grounding(
        self, monkeypatch
    ):
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
            return _FakeStreamCM(
                ["<think>internal reasoning</think>Your HRV was 99 today."]
            )

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)

        async def collect():
            items = []
            async for item in stream_coach_chat(
                "how am I doing?", context_text="HRV: 55ms"
            ):
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
