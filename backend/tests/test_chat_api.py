"""API-level tests for the coach chat endpoint (async + poll)."""

from __future__ import annotations

import pytest
from app.core.database import get_db
from app.main import app
from app.models import CoachConversation, CoachMessage
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    # Jobs use distinct sessions against the same test database.
    monkeypatch.setattr("app.services.generation.SessionLocal", sessionmaker(bind=db.get_bind()))
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


async def _fake_run_coach_chat(user_message, *, db=None, context_text="", history_messages=None,
                               conversation_id=None, message_id=None):
    from app.agents.coach import ChatResult

    return ChatResult(reply="Sample coach reply.", model="test-model", ungrounded_claims=[])


def test_chat_accepted_then_poll_returns_reply(client, db, monkeypatch):
    monkeypatch.setattr("app.api.chat.run_coach_chat", _fake_run_coach_chat)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "## Readiness\nSome context")

    res = client.post("/chat", json={"message": "how am I doing?"})
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "pending"
    message_id = body["message_id"]

    # TestClient runs FastAPI BackgroundTasks synchronously before
    # returning, so the job has already completed by this point.
    poll = client.get(f"/chat/messages/{message_id}")
    assert poll.status_code == 200
    poll_body = poll.json()
    assert poll_body["status"] == "done"
    assert poll_body["content"] == "Sample coach reply."
    assert poll_body["context_snapshot"] == "## Readiness\nSome context"
    assert poll_body["ungrounded_claims"] == []

    # Both turns persisted
    conv = db.query(CoachConversation).one()
    messages = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conv.id)
        .order_by(CoachMessage.created_at)
        .all()
    )
    assert [m.role for m in messages] == ["user", "assistant"]
    assert messages[1].status == "done"


def test_chat_without_context_omits_snapshot(client, db, monkeypatch):
    monkeypatch.setattr("app.api.chat.run_coach_chat", _fake_run_coach_chat)
    monkeypatch.setattr(
        "app.api.chat.build_context",
        lambda db: (_ for _ in ()).throw(AssertionError("should not be called")),
    )

    res = client.post("/chat", json={"message": "hi", "include_context": False})
    assert res.status_code == 202
    message_id = res.json()["message_id"]

    poll = client.get(f"/chat/messages/{message_id}")
    assert poll.json()["context_snapshot"] is None


def test_chat_job_failure_marks_message_as_error(client, db, monkeypatch):
    async def failing_run_coach_chat(
        user_message, *, db=None, context_text="", history_messages=None,
        conversation_id=None, message_id=None,
    ):
        raise RuntimeError("upstream failure")

    monkeypatch.setattr("app.api.chat.run_coach_chat", failing_run_coach_chat)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "")

    res = client.post("/chat", json={"message": "hi"})
    assert res.status_code == 202
    message_id = res.json()["message_id"]

    poll = client.get(f"/chat/messages/{message_id}")
    body = poll.json()
    assert body["status"] == "error"
    assert "upstream failure" in body["error"]

    # User turn is still persisted even though the assistant reply failed.
    conv = db.query(CoachConversation).one()
    messages = db.query(CoachMessage).filter(CoachMessage.conversation_id == conv.id).all()
    assert [m.role for m in messages] == ["user", "assistant"]


def test_get_message_status_404_for_unknown_id(client):
    res = client.get("/chat/messages/999999")
    assert res.status_code == 404


def test_committed_tool_receipts_survive_failed_reply_and_deleted_conversation(client, db, monkeypatch):
    from types import SimpleNamespace
    from typing import cast

    from app.agents.coach import (
        add_competition,
        log_saved_foods,
        save_personal_food,
        update_day_workout,
    )
    from app.agents.deps import CoachDeps
    from app.schemas import ExerciseOverrideIn
    from app.schemas.foods import FoodPortion, SavedFoodInput
    from pydantic_ai import RunContext

    async def commit_then_fail(user_message, *, db=None, context_text="", history_messages=None,
                              conversation_id=None, message_id=None):
        deps = CoachDeps(db=db)
        deps.extra.update(conversation_id=conversation_id, message_id=message_id)
        ctx = cast("RunContext[CoachDeps]", SimpleNamespace(deps=deps))
        await update_day_workout(ctx, day="2026-10-05", exercises=[ExerciseOverrideIn(exercise="Squat", sets=3, reps=5)])
        await add_competition(ctx, name="Cup", event_date="2026-10-10")
        food = await save_personal_food(ctx, food=SavedFoodInput(name="Rice", kcal=360, protein_g=7, carbs_g=80, fat_g=1))
        await log_saved_foods(ctx, portions=[FoodPortion(food_id=food.id, grams=100)], day="2026-10-05")
        raise RuntimeError("reply failed after tools committed")

    monkeypatch.setattr("app.api.chat.run_coach_chat", commit_then_fail)
    response = client.post("/chat", json={"message": "Do these updates", "include_context": False}).json()
    poll = client.get(f"/chat/messages/{response['message_id']}").json()
    assert poll["status"] == "error"
    receipts = client.get("/agent-actions").json()["items"]
    assert len(receipts) == 4 and all(row["status"] == "committed" for row in receipts)
    assert len({row["id"] for row in receipts}) == 4
    assert all(row["message_id"] == response["message_id"] for row in receipts)
    client.delete(f"/chat/conversations/{response['conversation_id']}")
    retained = client.get("/agent-actions").json()["items"]
    assert len(retained) == 4 and all(not row["conversation_available"] for row in retained)
