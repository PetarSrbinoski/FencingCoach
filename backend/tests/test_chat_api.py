"""API-level tests for the coach chat endpoints (non-streaming + SSE)."""

from __future__ import annotations

import json

import pytest
from app.core.database import get_db
from app.main import app
from app.models import CoachConversation, CoachMessage
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


async def _fake_run_coach_chat(user_message, *, db=None, context_text="", history_messages=None):
    from app.agents.coach import ChatResult

    return ChatResult(reply="Sample coach reply.", model="test-model", ungrounded_claims=[])


def test_chat_returns_context_snapshot_and_ungrounded_claims(client, db, monkeypatch):
    monkeypatch.setattr("app.api.chat.run_coach_chat", _fake_run_coach_chat)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "## Readiness\nSome context")

    res = client.post("/chat", json={"message": "how am I doing?"})
    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "Sample coach reply."
    assert body["context_snapshot"] == "## Readiness\nSome context"
    assert body["ungrounded_claims"] == []

    # Both turns persisted
    conv = db.query(CoachConversation).one()
    messages = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conv.id)
        .order_by(CoachMessage.created_at)
        .all()
    )
    assert [m.role for m in messages] == ["user", "assistant"]


def test_chat_without_context_omits_snapshot(client, db, monkeypatch):
    monkeypatch.setattr("app.api.chat.run_coach_chat", _fake_run_coach_chat)
    monkeypatch.setattr(
        "app.api.chat.build_context",
        lambda db: (_ for _ in ()).throw(AssertionError("should not be called")),
    )

    res = client.post("/chat", json={"message": "hi", "include_context": False})
    assert res.status_code == 200
    assert res.json()["context_snapshot"] is None


def test_chat_stream_emits_deltas_then_done(client, db, monkeypatch):
    async def fake_stream_coach_chat(user_message, *, db=None, context_text="", history_messages=None):
        yield {"delta": "Hello "}
        yield {"delta": "there."}
        yield {
            "done": True,
            "reply": "Hello there.",
            "model": "test-model",
            "ungrounded_claims": [],
        }

    monkeypatch.setattr("app.api.chat.stream_coach_chat", fake_stream_coach_chat)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "## Context\nfoo")

    with client.stream("POST", "/chat/stream", json={"message": "hi"}) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        frames = [
            json.loads(line[len("data: ") :])
            for line in res.iter_lines()
            if line.startswith("data: ")
        ]

    deltas = [f["delta"] for f in frames if "delta" in f]
    assert deltas == ["Hello ", "there."]

    done_frame = next(f for f in frames if f.get("done"))
    assert done_frame["reply"] == "Hello there."
    assert done_frame["context_snapshot"] == "## Context\nfoo"
    assert done_frame["ungrounded_claims"] == []

    # Both turns persisted after the stream completes
    conv = db.query(CoachConversation).one()
    messages = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conv.id)
        .order_by(CoachMessage.created_at)
        .all()
    )
    assert [m.role for m in messages] == ["user", "assistant"]
    assert messages[1].content == "Hello there."


def test_chat_stream_emits_error_frame_on_failure(client, db, monkeypatch):
    async def failing_stream(user_message, *, db=None, context_text="", history_messages=None):
        raise RuntimeError("upstream failure")
        yield  # pragma: no cover - unreachable, makes this an async generator

    monkeypatch.setattr("app.api.chat.stream_coach_chat", failing_stream)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "")

    with client.stream("POST", "/chat/stream", json={"message": "hi"}) as res:
        frames = [
            json.loads(line[len("data: ") :])
            for line in res.iter_lines()
            if line.startswith("data: ")
        ]

    assert any("error" in f and "upstream failure" in f["error"] for f in frames)

    # User turn is still persisted even though the assistant reply failed.
    conv = db.query(CoachConversation).one()
    messages = db.query(CoachMessage).filter(CoachMessage.conversation_id == conv.id).all()
    assert len(messages) == 1
    assert messages[0].role == "user"
