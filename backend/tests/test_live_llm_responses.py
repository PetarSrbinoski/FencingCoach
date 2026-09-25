"""Opt-in evaluations of answers from the configured real coach model.

Run with RUN_LIVE_LLM_EVALS=1 uv run pytest backend/tests/test_live_llm_responses.py -q -s.
These tests send synthetic athlete data to the configured LLM endpoint.
"""

from __future__ import annotations

import asyncio
import os
import re

import pytest
from app.agents.coach import run_coach_chat
from app.agents.deps import get_active_provider, set_active_provider
from app.core.database import get_db
from app.main import app
from app.models import Competition, WorkoutOverride
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.getenv("RUN_LIVE_LLM_EVALS") != "1",
        reason="Set RUN_LIVE_LLM_EVALS=1 to call the configured LLM provider",
    ),
]


@pytest.fixture(autouse=True)
def select_eval_provider():
    """Allow evaluation of either configured provider without changing app settings."""
    original = get_active_provider()
    selected = os.getenv("LLM_EVAL_PROVIDER", original)
    if selected not in {"local", "cloud"}:
        pytest.fail("LLM_EVAL_PROVIDER must be local or cloud")
    set_active_provider(selected)
    try:
        yield
    finally:
        set_active_provider(original)


def _assert_read_only_reply(reply: str, db: Session) -> None:
    assert reply.strip(), "The coach returned an empty answer"
    assert "<think>" not in reply.lower(), "Internal reasoning leaked into the answer"
    assert db.query(Competition).count() == 0, "A fact question added a competition"
    assert db.query(WorkoutOverride).count() == 0, "A fact question changed a workout"


def test_coach_uses_the_recorded_hrv_value(db: Session) -> None:
    context = "CONTEXT SNAPSHOT: Today's recorded HRV is 55 ms. No other metrics are available."
    result = asyncio.run(
        run_coach_chat("What is my recorded HRV value? Answer briefly.", db=db, context_text=context)
    )

    assert re.search(r"\b55\b", result.reply), result.reply
    assert not result.ungrounded_claims, result.ungrounded_claims
    _assert_read_only_reply(result.reply, db)
    print(f"\nRecorded-HRV reply ({result.model}): {result.reply}")


def test_coach_does_not_invent_missing_hrv(db: Session) -> None:
    context = "CONTEXT SNAPSHOT: No HRV reading is available."
    result = asyncio.run(
        run_coach_chat("What is my exact HRV value? Answer briefly.", db=db, context_text=context)
    )

    assert "hrv" in result.reply.lower(), result.reply
    assert not re.search(r"\b\d+(?:\.\d+)?\b", result.reply), result.reply
    assert not result.ungrounded_claims, result.ungrounded_claims
    _assert_read_only_reply(result.reply, db)
    print(f"\nMissing-HRV reply ({result.model}): {result.reply}")


def test_coach_uses_recorded_sleep_in_training_advice(db: Session) -> None:
    context = "CONTEXT SNAPSHOT: Last night's recorded sleep was 5 hours. No other recovery metrics are available."
    result = asyncio.run(
        run_coach_chat(
            "I have a gym workout today. How should I adapt it to last night's sleep? Answer briefly.",
            db=db,
            context_text=context,
        )
    )

    assert re.search(r"\b5\b", result.reply), result.reply
    assert "sleep" in result.reply.lower(), result.reply
    _assert_read_only_reply(result.reply, db)
    print(f"\nSleep-advice reply ({result.model}): {result.reply}")


def test_coach_asks_for_missing_competition_date(db: Session) -> None:
    result = asyncio.run(
        run_coach_chat(
            "Please add the Harbor Open to my competition calendar. I don't know the date yet.",
            db=db,
            context_text="CONTEXT SNAPSHOT: No competition date is known for the Harbor Open.",
        )
    )

    assert re.search(r"\b(date|when)\b", result.reply, re.IGNORECASE), result.reply
    _assert_read_only_reply(result.reply, db)
    print(f"\nMissing-date reply ({result.model}): {result.reply}")


def test_coach_adds_requested_competition_once(db: Session) -> None:
    result = asyncio.run(
        run_coach_chat(
            "Add the Harbor Open to my calendar on 2027-03-14 as a B-priority competition. Confirm what you saved.",
            db=db,
            context_text="CONTEXT SNAPSHOT: There are no competitions on the calendar.",
        )
    )

    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app).get("/competitions")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    assert len(response.json()) == 1, response.json()
    saved = response.json()[0]
    assert saved["name"] == "Harbor Open", saved
    assert saved["event_date"] == "2027-03-14", saved
    assert saved["priority"] == "B", saved
    assert "Harbor Open" in result.reply, result.reply
    assert "<think>" not in result.reply.lower(), result.reply
    print(f"\nAdd-competition reply ({result.model}): {result.reply}")
