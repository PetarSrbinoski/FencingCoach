"""Cancellation reaches the provider stream, including queued and repeated requests."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from app.core.database import get_db
from app.main import app
from app.models import CoachConversation, CoachMessage, NutritionEstimate
from app.services import generation
from openai import AsyncOpenAI
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def sessions(db, monkeypatch):
    factory = sessionmaker(bind=db.get_bind())

    def database():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(generation, "SessionLocal", factory)
    monkeypatch.setattr("app.agents.retry._llm_semaphore", None)
    monkeypatch.setattr("app.api.chat.build_context", lambda db: "")
    try:
        yield factory
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert not generation._running


@pytest.mark.parametrize("kind", ["chat", "nutrition", "delete_chat"])
def test_cancel_closes_live_provider_stream_and_stops_agent(sessions, monkeypatch, kind):
    async def scenario():
        started, closed = asyncio.Event(), asyncio.Event()
        requests = []

        class ProviderStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                chunk = {"id": "reply", "object": "chat.completion.chunk", "created": 1,
                         "model": "test", "choices": [{"index": 0,
                         "delta": {"role": "assistant", "content": "Thinking"},
                         "finish_reason": None}]}
                yield f"data: {json.dumps(chunk)}\n\n".encode()
                started.set()
                await asyncio.Event().wait()
                pytest.fail("a cancelled provider stream must never continue")

            async def aclose(self):
                closed.set()

        def upstream(request):
            body = json.loads(request.content)
            assert body["stream"] is True
            requests.append(body)
            return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                  stream=ProviderStream())

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as provider_http:
            model = OpenAIChatModel("test", provider=OpenAIProvider(openai_client=AsyncOpenAI(
                api_key="test", base_url="http://provider.invalid/v1", http_client=provider_http,
            )))
            monkeypatch.setattr("app.agents.coach.get_active_model", lambda: model)
            monkeypatch.setattr("app.agents.nutrition.get_active_model", lambda: model)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                         base_url="http://app") as client:
                is_chat = kind != "nutrition"
                submission = asyncio.create_task(client.post(
                    "/chat" if is_chat else "/nutrition/estimate",
                    json={"message": "hello", "include_context": False} if is_chat else {"text": "rice"},
                ))
                await asyncio.wait_for(started.wait(), timeout=5)
                row_model = CoachMessage if is_chat else NutritionEstimate
                with sessions() as db:
                    row = db.scalar(select(row_model).where(row_model.status == "pending"))
                    row_id = row.id
                    conversation_id = row.conversation_id if is_chat else None
                path = f"/chat/messages/{row_id}" if is_chat else f"/nutrition/estimate/{row_id}"
                if kind == "delete_chat":
                    response = await client.delete(f"/chat/conversations/{conversation_id}")
                    assert response.status_code == 204
                else:
                    response = await client.post(f"{path}/cancel")
                    assert response.status_code == 200, response.text
                    assert response.json()["status"] == "cancelled"
                    assert response.json()["error"] is None
                    assert (await client.post(f"{path}/cancel")).json()["status"] == "cancelled"
                assert closed.is_set()
                assert (await asyncio.wait_for(submission, timeout=5)).status_code == 202
                assert len(requests) == 1  # No retry, fallback, or follow-up tool/model turn.
                result = await client.get(path)
                if kind == "delete_chat":
                    assert result.status_code == 404
                else:
                    assert result.json()["status"] == "cancelled"
                    if is_chat:
                        history = (await client.get(f"/chat/conversations/{conversation_id}")).json()
                        assert [m["status"] for m in history["messages"]] == ["done", "cancelled"]

    asyncio.run(scenario())


@pytest.mark.parametrize("model", [CoachMessage, NutritionEstimate])
@pytest.mark.parametrize("initial_status", ["pending", "done", "error"])
def test_cancel_before_dispatch_and_terminal_jobs(sessions, model, initial_status):
    async def scenario():
        with sessions() as db:
            row: CoachMessage | NutritionEstimate
            if model is CoachMessage:
                conversation = CoachConversation(title="test")
                db.add(conversation)
                db.flush()
                row = CoachMessage(conversation_id=conversation.id, role="assistant", content="saved")
            else:
                row = NutritionEstimate(raw_text="rice", kcal=123)
            row.status = initial_status
            db.add(row)
            db.commit()
            row_id = row.id
            await generation.cancel_generation(db, row)
            await generation.cancel_generation(db, row)
            assert row.status == ("cancelled" if initial_status == "pending" else initial_status)
            assert row.content == "saved" if isinstance(row, CoachMessage) else row.kcal == 123

        async def never_run(db):
            pytest.fail("a cancelled or completed job must not start")

        await generation._run_generation(model, row_id, never_run)

    asyncio.run(scenario())


def test_cancel_unknown_or_user_message(sessions):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://app") as client:
            assert (await client.post("/chat/messages/999/cancel")).status_code == 404
            assert (await client.post("/nutrition/estimate/999/cancel")).status_code == 404
            with sessions() as db:
                conversation = CoachConversation(title="test")
                db.add(conversation)
                db.flush()
                message = CoachMessage(conversation_id=conversation.id, role="user", content="hello")
                db.add(message)
                db.commit()
                message_id = message.id
            assert (await client.post(f"/chat/messages/{message_id}/cancel")).status_code == 409

    asyncio.run(scenario())


def test_cancel_preserves_committed_tools_and_discards_late_result(sessions):
    from datetime import date

    from app.models import Competition

    async def scenario():
        started = asyncio.Event()
        with sessions() as db:
            conversation = CoachConversation(title="test")
            db.add(conversation)
            db.flush()
            message = CoachMessage(conversation_id=conversation.id, role="assistant", content="", status="pending")
            db.add(message)
            db.commit()
            message_id = message.id

        async def generate(db):
            db.add(Competition(name="Saved before cancel", event_date=date(2026, 10, 1)))
            db.commit()
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                return {"content": "Late reply"}

        job = asyncio.create_task(generation._run_generation(CoachMessage, message_id, generate))
        await asyncio.wait_for(started.wait(), 5)
        with sessions() as db:
            message = db.get(CoachMessage, message_id)
            await generation.cancel_generation(db, message)
            assert message.status == "cancelled"
            assert message.content == ""
            assert db.scalars(select(Competition.name)).all() == ["Saved before cancel"]
        await job

    asyncio.run(scenario())


def test_cancel_waiting_for_llm_slot_never_contacts_provider(sessions, monkeypatch):
    from app.agents.retry import llm_slot

    async def scenario():
        semaphore = asyncio.Semaphore(0)
        monkeypatch.setattr("app.agents.retry._llm_semaphore", semaphore)
        queued = asyncio.Event()
        with sessions() as db:
            estimate = NutritionEstimate(raw_text="rice", status="pending")
            db.add(estimate)
            db.commit()
            row_id = estimate.id

        async def generate(db):
            queued.set()
            async with llm_slot():
                pytest.fail("cancelled queued jobs must not contact the LLM")

        job = asyncio.create_task(generation._run_generation(NutritionEstimate, row_id, generate))
        await asyncio.wait_for(queued.wait(), 5)
        with sessions() as db:
            await generation.cancel_generation(db, db.get(NutritionEstimate, row_id))
        semaphore.release()
        await job

    asyncio.run(scenario())
