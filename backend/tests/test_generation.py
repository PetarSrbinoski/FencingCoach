"""Generation lifecycle tested with independent request, job and reader sessions."""

import asyncio
from typing import Any

import pytest
from app.models import CoachConversation, CoachMessage, NutritionEstimate, NutritionLog
from app.services.generation import (
    INTERRUPTED_ERROR,
    fail_interrupted_generations,
    submit_generation,
)
from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def sessions(db, monkeypatch):
    factory = sessionmaker(bind=db.get_bind())
    monkeypatch.setattr("app.services.generation.SessionLocal", factory)
    return factory


@pytest.mark.parametrize("kind", ["chat", "nutrition"])
def test_pending_is_durable_before_job_uses_its_own_session(sessions, kind):
    tasks = BackgroundTasks()
    with sessions() as request:
        row: CoachMessage | NutritionEstimate
        values: dict[str, Any]
        if kind == "chat":
            conv = CoachConversation(title="test")
            request.add(conv)
            request.flush()
            row = CoachMessage(conversation_id=conv.id, role="assistant", content="")
            values = {"content": "reply"}
        else:
            row = NutritionEstimate(raw_text="rice")
            values = {"kcal": 120.0}

        async def generate(job):
            assert job is not request
            return values

        submit_generation(request, tasks, row, generate)
        model, row_id = type(row), row.id
    with sessions() as reader:
        assert reader.get(model, row_id).status == "pending"
    asyncio.run(tasks())
    with sessions() as reader:
        result = reader.get(model, row_id)
        assert result.status == "done"
        for key, value in values.items():
            assert getattr(result, key) == value
        assert reader.scalars(select(NutritionLog)).all() == []


def test_failed_flush_is_rolled_back_before_recording_error(sessions):
    tasks = BackgroundTasks()

    async def generate(job):
        job.add(NutritionEstimate(raw_text=None))  # violates NOT NULL
        job.flush()
        return {}

    with sessions() as request:
        row = NutritionEstimate(raw_text="rice")
        submit_generation(request, tasks, row, generate)
        row_id = row.id
    asyncio.run(tasks())
    with sessions() as reader:
        result = reader.get(NutritionEstimate, row_id)
        assert result.status == "error"
        assert "NOT NULL" in result.error


def test_failed_result_commit_is_rolled_back_before_recording_error(sessions):
    tasks = BackgroundTasks()

    async def generate(job):
        return {"raw_text": None}

    with sessions() as request:
        row = NutritionEstimate(raw_text="rice")
        submit_generation(request, tasks, row, generate)
        row_id = row.id
    asyncio.run(tasks())
    with sessions() as reader:
        result = reader.get(NutritionEstimate, row_id)
        assert result.status == "error"
        assert result.raw_text == "rice"


def test_restart_marks_pending_as_failed_without_replaying_committed_work(sessions):
    tasks = BackgroundTasks()

    async def should_not_run(job):
        pytest.fail("interrupted generation must not replay")

    with sessions() as request:
        conv = CoachConversation(title="test")
        request.add(conv)
        request.flush()
        done = CoachMessage(conversation_id=conv.id, role="user", content="hello", status="done")
        request.add(done)
        reply = CoachMessage(conversation_id=conv.id, role="assistant", content="")
        estimate = NutritionEstimate(raw_text="rice")
        submit_generation(request, tasks, reply, should_not_run)
        submit_generation(request, tasks, estimate, should_not_run)
        ids = reply.id, estimate.id, done.id
    with sessions() as startup:
        fail_interrupted_generations(startup)
    asyncio.run(tasks())
    with sessions() as reader:
        for model, row_id in [(CoachMessage, ids[0]), (NutritionEstimate, ids[1])]:
            row = reader.get(model, row_id)
            assert row.status == "error"
            assert row.error == INTERRUPTED_ERROR
        assert reader.get(CoachMessage, ids[2]).status == "done"


def test_cancellation_records_interruption_and_preserves_cancellation(sessions):
    tasks = BackgroundTasks()

    async def generate(job):
        raise asyncio.CancelledError()

    with sessions() as request:
        row = NutritionEstimate(raw_text="rice")
        submit_generation(request, tasks, row, generate)
        row_id = row.id
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(tasks())
    with sessions() as reader:
        row = reader.get(NutritionEstimate, row_id)
        assert row.status == "error"
        assert row.error == INTERRUPTED_ERROR


def test_deleted_result_is_not_recreated(sessions):
    tasks = BackgroundTasks()
    with sessions() as request:
        row = NutritionEstimate(raw_text="rice")

        async def generate(job):
            with sessions() as other:
                other.delete(other.get(NutritionEstimate, row_id))
                other.commit()
            return {"kcal": 120}

        submit_generation(request, tasks, row, generate)
        row_id = row.id
    asyncio.run(tasks())
    with sessions() as reader:
        assert reader.get(NutritionEstimate, row_id) is None


def test_web_startup_recovers_pending_jobs(sessions, monkeypatch):
    from app.main import app, lifespan

    monkeypatch.setattr("app.core.database.SessionLocal", sessions)
    with sessions() as request:
        row = NutritionEstimate(raw_text="rice", status="pending")
        request.add(row)
        request.commit()
        row_id = row.id

    async def startup():
        async with lifespan(app):
            with sessions() as reader:
                assert reader.get(NutritionEstimate, row_id).status == "error"

    asyncio.run(startup())


def test_failure_preserves_committed_tool_write_without_replay(sessions):
    tasks = BackgroundTasks()
    calls = 0

    async def generate(job):
        nonlocal calls
        calls += 1
        job.add(CoachConversation(title="committed tool effect"))
        job.commit()
        raise RuntimeError("failure after tool commit")

    with sessions() as request:
        row = NutritionEstimate(raw_text="test")
        submit_generation(request, tasks, row, generate)
        row_id = row.id
    asyncio.run(tasks())
    # Even accidental redispatch must not replay a terminal job.
    asyncio.run(tasks())
    with sessions() as reader:
        assert calls == 1
        assert reader.get(NutritionEstimate, row_id).status == "error"
        assert len(reader.scalars(select(CoachConversation)).all()) == 1
