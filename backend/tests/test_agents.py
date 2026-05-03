"""Tests for PydanticAI agent construction and configuration.

These tests verify agent setup without making actual LLM calls
(using PydanticAI's TestModel for dry-run validation).
"""

from __future__ import annotations

import os

# Override DATABASE_URL before any app imports
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from app.agents.deps import CoachDeps, get_model, strip_think_tags
from app.agents.nutrition import (
    NutritionEstimateOutput,
    NutritionMicros,
    estimate_nutrition,
    nutrition_agent,
)
from app.agents.mealplan import MealPlanOutput, mealplan_agent
from app.agents.brief import brief_agent
from app.agents.mental import mental_agent, generate_mental_insight
from app.agents.coach import coach_agent, _db_messages_to_history, ChatResult


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
