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
    _MAX_TRANSIENT_RETRIES,
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
    _build_nutrition_toolsets,
    _usda_mcp_available,
    estimate_nutrition,
    nutrition_agent,
    nutrition_fallback_agent,
)
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.mcp import MCPServerStdio


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
            asyncio.run(estimate_nutrition(""))

    def test_estimate_nutrition_whitespace_raises(self):
        with pytest.raises(ValueError, match="empty food description"):
            asyncio.run(estimate_nutrition("   "))

    def test_estimate_nutrition_retries_without_usda(self, monkeypatch):
        # Simulate the USDA MCP subprocess script being present (it won't be
        # in this test environment, which doesn't clone it) so the retry
        # path under test actually engages.
        monkeypatch.setattr("app.agents.nutrition._usda_mcp_available", lambda: True)
        calls: list[str] = []

        async def fail_primary(text, deps, model=None):
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

        async def succeed_fallback(text, deps, model=None):
            calls.append(f"fallback:{text}")
            return SimpleNamespace(output=fallback_output)

        monkeypatch.setattr(nutrition_agent, "run", fail_primary)
        monkeypatch.setattr(nutrition_fallback_agent, "run", succeed_fallback)

        result = asyncio.run(estimate_nutrition("chicken burrito bowl"))

        assert result == fallback_output
        assert calls == [
            "primary:chicken burrito bowl",
            "fallback:chicken burrito bowl",
        ]

    def test_estimate_nutrition_raises_when_both_agents_fail(self, monkeypatch):
        """Hard-fail loudly — never silently persist a fabricated zero estimate."""

        async def fail(text, deps, model=None):
            raise RuntimeError("upstream LLM timeout")

        monkeypatch.setattr(nutrition_agent, "run", fail)
        monkeypatch.setattr(nutrition_fallback_agent, "run", fail)

        with pytest.raises(RuntimeError, match="nutrition estimation failed"):
            asyncio.run(estimate_nutrition("chicken burrito bowl"))

    def test_estimate_nutrition_raises_when_no_usda_configured(self, monkeypatch):
        """Without USDA configured there's no fallback agent to retry with —
        a primary failure must still raise, not return zeros."""
        monkeypatch.setattr("app.agents.nutrition.settings.USDA_MCP_SCRIPT", "", raising=False)

        async def fail(text, deps, model=None):
            raise RuntimeError("network error")

        monkeypatch.setattr(nutrition_agent, "run", fail)

        with pytest.raises(RuntimeError, match="nutrition estimation failed"):
            asyncio.run(estimate_nutrition("chicken burrito bowl"))

    def test_estimate_nutrition_retries_transient_error_then_succeeds(self, monkeypatch):
        """Regression test for the prod 503 seen from NVIDIA NIM on
        /nutrition/estimate: a transient provider error on the primary
        USDA-backed agent must be retried in place, without falling back
        to (and needlessly losing) USDA-grounded results."""
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        good_output = NutritionEstimateOutput(
            kcal=500, protein_g=40, carbs_g=50, fat_g=15, confidence="high"
        )

        async def flaky_primary(text, deps, model=None):
            calls["n"] += 1
            if calls["n"] == 1:
                request = httpx.Request(
                    "POST", "https://integrate.api.nvidia.com/v1/chat/completions"
                )
                raise openai.APIError(
                    "ResourceExhausted: Worker local total request limit reached",
                    request,
                    body=None,
                )
            return SimpleNamespace(output=good_output)

        async def fail_fallback(text, deps, model=None):  # pragma: no cover - should never be called
            raise AssertionError("fallback agent should not be needed")

        monkeypatch.setattr(nutrition_agent, "run", flaky_primary)
        monkeypatch.setattr(nutrition_fallback_agent, "run", fail_fallback)

        result = asyncio.run(estimate_nutrition("chicken burrito bowl"))

        assert result == good_output
        assert calls["n"] == 2

    def test_estimate_nutrition_gives_up_then_falls_back_to_usda_free(self, monkeypatch):
        """If the primary agent keeps failing transiently past the retry
        budget, it should still fall back to the USDA-free agent rather
        than surfacing the error directly."""
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        monkeypatch.setattr("app.agents.nutrition._usda_mcp_available", lambda: True)

        async def always_flaky_primary(text, deps, model=None):
            request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
            raise openai.APIError(
                "ResourceExhausted: Worker local total request limit reached",
                request,
                body=None,
            )

        fallback_output = NutritionEstimateOutput(
            kcal=500, protein_g=40, carbs_g=50, fat_g=15, confidence="medium"
        )

        async def succeed_fallback(text, deps, model=None):
            return SimpleNamespace(output=fallback_output)

        monkeypatch.setattr(nutrition_agent, "run", always_flaky_primary)
        monkeypatch.setattr(nutrition_fallback_agent, "run", succeed_fallback)

        result = asyncio.run(estimate_nutrition("chicken burrito bowl"))
        assert result == fallback_output

    def test_estimate_nutrition_cancelled_mid_flight_propagates(self, monkeypatch):
        """A cancelled estimate (client disconnected) must propagate
        CancelledError rather than being swallowed/retried or falling
        back to the USDA-free agent — see app.core.cancellation."""
        monkeypatch.setattr("app.agents.nutrition._usda_mcp_available", lambda: True)

        async def cancelled(text, deps, model=None):
            raise asyncio.CancelledError()

        async def fail_fallback(text, deps, model=None):  # pragma: no cover - should never be called
            raise AssertionError("fallback agent should not run for a cancelled request")

        monkeypatch.setattr(nutrition_agent, "run", cancelled)
        monkeypatch.setattr(nutrition_fallback_agent, "run", fail_fallback)

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(estimate_nutrition("chicken burrito bowl"))

    def test_usda_mcp_available_false_when_script_missing(self, monkeypatch):
        monkeypatch.setattr(
            "app.agents.nutrition.settings.USDA_MCP_SCRIPT", "/nonexistent/path/main.py"
        )
        assert _usda_mcp_available() is False

    def test_build_nutrition_toolsets_spawns_stdio_mcp_when_script_present(
        self, monkeypatch, tmp_path
    ):
        script = tmp_path / "main.py"
        script.write_text("# stub USDA MCP server")
        monkeypatch.setattr("app.agents.nutrition.settings.USDA_MCP_SCRIPT", str(script))

        toolsets = _build_nutrition_toolsets()

        assert len(toolsets) == 1
        assert isinstance(toolsets[0], MCPServerStdio)
        assert toolsets[0].args == [str(script)]

    def test_build_nutrition_toolsets_empty_when_script_missing(self, monkeypatch):
        monkeypatch.setattr(
            "app.agents.nutrition.settings.USDA_MCP_SCRIPT", "/nonexistent/path/main.py"
        )
        assert _build_nutrition_toolsets() == []


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

    def test_generate_meal_plan_retries_transient_error_then_succeeds(self, monkeypatch, db):
        from datetime import date

        from app.agents.mealplan import generate_meal_plan, mealplan_agent

        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)
        calls = {"n": 0}

        good_output = MealPlanOutput(meals=[], rationale="ok")

        def flaky_run(user_msg, deps=None, model=None):
            calls["n"] += 1
            if calls["n"] == 1:
                request = httpx.Request(
                    "POST", "https://integrate.api.nvidia.com/v1/chat/completions"
                )
                raise openai.APIError(
                    "ResourceExhausted: Worker local total request limit reached",
                    request,
                    body=None,
                )
            return SimpleNamespace(output=good_output)

        monkeypatch.setattr(mealplan_agent, "run_sync", flaky_run)

        plan = generate_meal_plan(db, day=date(2026, 8, 1))

        assert calls["n"] == 2
        assert plan.plan["plan"]["rationale"] == "ok"


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

    def test_run_coach_chat_flags_ungrounded_claims(self, monkeypatch, db):
        async def fake_run(user_prompt, deps=None, message_history=None, model=None):
            return SimpleNamespace(output="Your HRV was 99 last night.")

        monkeypatch.setattr(coach_agent, "run", fake_run)

        result = asyncio.run(
            run_coach_chat("how am I doing?", db=db, context_text="HRV: 55ms, Sleep: 7h")
        )
        assert result.reply == "Your HRV was 99 last night."
        assert len(result.ungrounded_claims) == 1
        assert "99" in result.ungrounded_claims[0]

    def test_run_coach_chat_no_flags_when_grounded(self, monkeypatch, db):
        async def fake_run(user_prompt, deps=None, message_history=None, model=None):
            return SimpleNamespace(output="Your HRV was 55 last night.")

        monkeypatch.setattr(coach_agent, "run", fake_run)

        result = asyncio.run(
            run_coach_chat("how am I doing?", db=db, context_text="HRV: 55ms, Sleep: 7h")
        )
        assert result.ungrounded_claims == []

    def test_stream_coach_chat_filters_think_tags_and_flags_grounding(self, monkeypatch, db):
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

        def fake_run_stream(user_prompt, deps=None, message_history=None, model=None):
            return _FakeStreamCM(["<think>internal reasoning</think>Your HRV was 99 today."])

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)

        async def collect():
            items = []
            async for item in stream_coach_chat("how am I doing?", db=db, context_text="HRV: 55ms"):
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


# ── coach tools (update_day_workout / add_competition) ──────────────────
def _ctx(db) -> SimpleNamespace:
    """Minimal stand-in for RunContext[CoachDeps] — the tools only ever
    touch `ctx.deps.db`."""
    return SimpleNamespace(deps=CoachDeps(db=db))


class TestCoachWorkoutTool:
    def test_update_day_workout_sets_manual_override(self, db):
        from datetime import date

        from app.agents.coach import update_day_workout
        from app.models import WorkoutOverride
        from app.schemas import ExerciseOverrideIn

        day = date(2026, 7, 14)
        result = asyncio.run(
            update_day_workout(
                _ctx(db),
                day=day.isoformat(),
                exercises=[
                    ExerciseOverrideIn(exercise="Front Squat", sets=5, reps=3, load_kg=90),
                ],
                session_name="deload",
                notes="Athlete asked for a lighter day.",
            )
        )
        assert "Front Squat" in result
        assert day.isoformat() in result

        row = db.get(WorkoutOverride, day)
        assert row is not None
        assert row.session_name == "deload"
        assert row.exercises[0]["exercise"] == "Front Squat"
        assert row.exercises[0]["sets"] == 5

    def test_update_day_workout_feeds_into_build_session(self, db):
        from datetime import date

        from app.agents.coach import update_day_workout
        from app.schemas import ExerciseOverrideIn
        from app.services.training import build_session

        day = date(2026, 7, 15)  # Wednesday — normally a fencing/rest day
        asyncio.run(
            update_day_workout(
                _ctx(db),
                day=day.isoformat(),
                exercises=[ExerciseOverrideIn(exercise="Box Jump", sets=4, reps=5)],
            )
        )
        out = build_session(db, day)
        assert out["source"] == "manual"
        assert out["session"]["exercises"][0]["exercise"] == "Box Jump"

    def test_update_day_workout_clears_override_when_no_exercises(self, db):
        from datetime import date

        from app.agents.coach import update_day_workout
        from app.models import WorkoutOverride
        from app.schemas import ExerciseOverrideIn

        day = date(2026, 7, 16)
        asyncio.run(
            update_day_workout(
                _ctx(db),
                day=day.isoformat(),
                exercises=[ExerciseOverrideIn(exercise="Deadlift", sets=3, reps=5)],
            )
        )
        assert db.get(WorkoutOverride, day) is not None

        result = asyncio.run(update_day_workout(_ctx(db), day=day.isoformat(), exercises=None))
        assert "revert" in result.lower()
        assert db.get(WorkoutOverride, day) is None

    def test_update_day_workout_bad_date_raises_model_retry(self, db):
        from app.agents.coach import update_day_workout
        from app.schemas import ExerciseOverrideIn
        from pydantic_ai.exceptions import ModelRetry

        with pytest.raises(ModelRetry):
            asyncio.run(
                update_day_workout(
                    _ctx(db),
                    day="not-a-date",
                    exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)],
                )
            )

    def test_update_day_workout_sets_side_effect_flag(self, db):
        from datetime import date

        from app.agents.coach import update_day_workout
        from app.schemas import ExerciseOverrideIn

        ctx = _ctx(db)
        assert ctx.deps.side_effect_committed is False
        asyncio.run(
            update_day_workout(
                ctx,
                day=date(2026, 7, 17).isoformat(),
                exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)],
            )
        )
        assert ctx.deps.side_effect_committed is True

    def test_update_day_workout_clear_sets_side_effect_flag(self, db):
        from datetime import date

        from app.agents.coach import update_day_workout
        from app.schemas import ExerciseOverrideIn

        day = date(2026, 7, 18)
        asyncio.run(
            update_day_workout(
                _ctx(db),
                day=day.isoformat(),
                exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)],
            )
        )
        ctx = _ctx(db)
        asyncio.run(update_day_workout(ctx, day=day.isoformat(), exercises=None))
        assert ctx.deps.side_effect_committed is True


class TestCoachCompetitionTool:
    def test_add_competition_creates_row(self, db):
        from app.agents.coach import add_competition
        from app.models import Competition

        result = asyncio.run(
            add_competition(
                _ctx(db),
                name="Budapest World Cup",
                event_date="2026-09-12",
                location="Budapest",
                level="FIE world cup",
                priority="A",
            )
        )
        assert "Budapest World Cup" in result

        comp = db.query(Competition).filter_by(name="Budapest World Cup").one()
        assert comp.event_date.isoformat() == "2026-09-12"
        assert comp.priority == "A"
        assert comp.level == "FIE world cup"

    def test_add_competition_defaults_invalid_priority_to_a(self, db):
        from app.agents.coach import add_competition
        from app.models import Competition

        asyncio.run(
            add_competition(
                _ctx(db),
                name="Local Open",
                event_date="2026-08-01",
                priority="Z",
            )
        )
        comp = db.query(Competition).filter_by(name="Local Open").one()
        assert comp.priority == "A"

    def test_add_competition_bad_event_date_raises_model_retry(self, db):
        from app.agents.coach import add_competition
        from pydantic_ai.exceptions import ModelRetry

        with pytest.raises(ModelRetry):
            asyncio.run(add_competition(_ctx(db), name="X", event_date="not-a-date"))

    def test_add_competition_bad_end_date_raises_model_retry(self, db):
        from app.agents.coach import add_competition
        from pydantic_ai.exceptions import ModelRetry

        with pytest.raises(ModelRetry):
            asyncio.run(
                add_competition(_ctx(db), name="X", event_date="2026-08-01", end_date="not-a-date")
            )

    def test_add_competition_sets_side_effect_flag(self, db):
        from app.agents.coach import add_competition

        ctx = _ctx(db)
        assert ctx.deps.side_effect_committed is False
        asyncio.run(add_competition(ctx, name="Flag Test Cup", event_date="2026-09-01"))
        assert ctx.deps.side_effect_committed is True


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

    def test_run_coach_chat_uses_plain_agent_by_default(self, monkeypatch, db):
        async def fake_run(user_prompt, deps=None, message_history=None, model=None):
            return SimpleNamespace(output="Hey! How can I help?")

        def fail_run(*a, **kw):  # pragma: no cover - should never be called
            raise AssertionError("coach_agent_search.run should not be called")

        monkeypatch.setattr(coach_agent, "run", fake_run)
        monkeypatch.setattr(coach_agent_search, "run", fail_run)

        result = asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        assert result.reply == "Hey! How can I help?"

    def test_run_coach_chat_uses_search_agent_when_explicitly_asked(self, monkeypatch, db):
        async def fake_run(user_prompt, deps=None, message_history=None, model=None):
            return SimpleNamespace(output="Found it via search.")

        def fail_run(*a, **kw):  # pragma: no cover - should never be called
            raise AssertionError("coach_agent.run should not be called")

        monkeypatch.setattr(coach_agent, "run", fail_run)
        monkeypatch.setattr(coach_agent_search, "run", fake_run)

        result = asyncio.run(run_coach_chat("please search the web for X", db=db, context_text=""))
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

    def test_run_coach_chat_retries_transient_error_then_succeeds(self, monkeypatch, db):
        calls = {"n": 0}

        async def flaky_run(user_prompt, deps=None, message_history=None, model=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_error()
            return SimpleNamespace(output="Hey, all good now.")

        monkeypatch.setattr(coach_agent, "run", flaky_run)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        result = asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        assert result.reply == "Hey, all good now."
        assert calls["n"] == 2

    def test_run_coach_chat_retries_model_http_error_then_succeeds(self, monkeypatch, db):
        """Regression test: the actual production failure was a real HTTP
        503 from NVIDIA NIM, wrapped by pydantic-ai as ModelHTTPError —
        not an openai.APIError. The retry logic must handle both shapes."""
        calls = {"n": 0}

        async def flaky_run(user_prompt, deps=None, message_history=None, model=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _make_transient_http_error()
            return SimpleNamespace(output="Hey, all good now.")

        monkeypatch.setattr(coach_agent, "run", flaky_run)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        result = asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        assert result.reply == "Hey, all good now."
        assert calls["n"] == 2

    def test_run_coach_chat_gives_up_after_max_retries(self, monkeypatch, db):
        calls = {"n": 0}

        async def always_flaky_run(user_prompt, deps=None, message_history=None, model=None):
            calls["n"] += 1
            raise _make_transient_error()

        monkeypatch.setattr(coach_agent, "run", always_flaky_run)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        with pytest.raises(openai.APIError):
            asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        # initial attempt + _MAX_TRANSIENT_RETRIES retries
        assert calls["n"] == _MAX_TRANSIENT_RETRIES + 1

    def test_run_coach_chat_does_not_retry_non_transient_error(self, monkeypatch, db):
        calls = {"n": 0}

        async def bad_request_run(user_prompt, deps=None, message_history=None, model=None):
            calls["n"] += 1
            request = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
            raise openai.APIError("Invalid request: bad schema", request, body=None)

        monkeypatch.setattr(coach_agent, "run", bad_request_run)

        with pytest.raises(openai.APIError):
            asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        assert calls["n"] == 1

    def test_run_coach_chat_does_not_retry_after_tool_side_effect(self, monkeypatch, db):
        """A transient error after a tool already committed a DB write
        (e.g. add_competition) must NOT be retried — retrying would
        silently duplicate the side effect."""
        calls = {"n": 0}

        async def flaky_run_with_side_effect(user_prompt, deps=None, message_history=None, model=None):
            calls["n"] += 1
            deps.side_effect_committed = True  # simulates a tool having run
            raise _make_transient_error()

        monkeypatch.setattr(coach_agent, "run", flaky_run_with_side_effect)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        with pytest.raises(openai.APIError):
            asyncio.run(run_coach_chat("hello", db=db, context_text=""))
        assert calls["n"] == 1

    def test_stream_coach_chat_retries_transient_error_before_any_delta(self, monkeypatch, db):
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

        def fake_run_stream(user_prompt, deps=None, message_history=None, model=None):
            return _FakeStreamCM(["All good now."])

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        async def collect():
            items = []
            async for item in stream_coach_chat("hello", db=db, context_text=""):
                items.append(item)
            return items

        items = asyncio.run(collect())
        deltas = [i["delta"] for i in items if "delta" in i]
        assert "".join(deltas) == "All good now."
        assert calls["n"] == 2

    def test_stream_coach_chat_does_not_retry_after_tool_side_effect(self, monkeypatch, db):
        """Same guard as run_coach_chat: once a tool has committed a side
        effect during this attempt, a subsequent transient error must not
        trigger a retry of the whole stream."""
        calls = {"n": 0}

        class _FakeStreamCM:
            async def __aenter__(self):
                calls["n"] += 1
                raise _make_transient_error()

            async def __aexit__(self, *a):
                return False

        def fake_run_stream(user_prompt, deps=None, message_history=None, model=None):
            deps.side_effect_committed = True  # simulates a tool having run
            return _FakeStreamCM()

        monkeypatch.setattr(coach_agent, "run_stream", fake_run_stream)
        monkeypatch.setattr("app.agents.retry.RETRY_BACKOFF_SECONDS", 0)

        async def collect():
            items = []
            async for item in stream_coach_chat("hello", db=db, context_text=""):
                items.append(item)
            return items

        with pytest.raises(openai.APIError):
            asyncio.run(collect())
        assert calls["n"] == 1
