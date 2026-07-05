"""API-level tests for the coach chat endpoint (async + poll)."""

from __future__ import annotations

import pytest
from app.core.database import get_db
from app.main import app
from app.models import CoachConversation, CoachMessage
from fastapi.testclient import TestClient


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    # The background job opens its own `SessionLocal()` (see
    # api/chat.py's module docstring) — in tests, point that at the same
    # in-memory session the `db` fixture uses instead of the real
    # module-level engine (which has no tables in the test environment).
    monkeypatch.setattr("app.api.chat.SessionLocal", lambda: db)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


async def _fake_run_coach_chat(user_message, *, db=None, context_text="", history_messages=None):
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
        user_message, *, db=None, context_text="", history_messages=None
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
