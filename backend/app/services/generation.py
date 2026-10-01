"""Persist and finish detached chat replies and nutrition estimates.

The single backend process owns execution. On startup, unfinished work is
failed rather than replayed: a coach tool may already have committed a write.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import CoachMessage, NutritionEstimate

log = logging.getLogger(__name__)

type Generate = Callable[[Session], Awaitable[dict[str, Any]]]

INTERRUPTED_ERROR = "Generation was interrupted. Please submit a new request."

# Owned by the single backend event loop, including cancellation endpoints.
_running: dict[tuple[str, int], asyncio.Task[None]] = {}


async def cancel_generation[T: CoachMessage | NutritionEstimate](db: Session, row: T) -> None:
    """Persist cancellation and wait for the job's upstream connection to close.

    Also works before dispatch and is idempotent for terminal jobs. Committed
    tool actions survive; cancellation only rolls back uncommitted work.
    """
    model, row_id = type(row), row.id
    db.execute(
        update(model)
        .where(model.id == row_id, model.status == "pending")
        .values(status="cancelled", error=None)
    )
    db.commit()
    task = _running.get((model.__tablename__, row_id))
    if task is not None and not task.done():
        if not task.cancelling():
            task.cancel()
        # A disconnected cancellation caller must not interrupt stream cleanup.
        await asyncio.shield(asyncio.gather(task, return_exceptions=True))
    db.refresh(row)


def submit_generation[T: CoachMessage | NutritionEstimate](
    db: Session, tasks: BackgroundTasks, row: T, generate: Generate
) -> None:
    """Commit the pending result and any request writes before dispatching."""
    row.status = "pending"
    db.add(row)
    db.commit()
    db.refresh(row)
    tasks.add_task(_run_generation, type(row), row.id, generate)


async def _run_generation[T: CoachMessage | NutritionEstimate](
    model: type[T], row_id: int, generate: Generate
) -> None:
    key = (model.__tablename__, row_id)
    task = asyncio.create_task(_finish_generation(model, row_id, generate))
    _running[key] = task
    try:
        await task
    except asyncio.CancelledError:
        # User cancellation belongs to the child, not the HTTP response task.
        current = asyncio.current_task()
        if current is not None and current.cancelling():
            raise
    finally:
        _running.pop(key, None)


async def _finish_generation[T: CoachMessage | NutritionEstimate](
    model: type[T], row_id: int, generate: Generate
) -> None:
    with SessionLocal() as db:
        try:
            row = db.get(model, row_id)
            if row is None or row.status != "pending":
                return
            values = await generate(db)
            # Re-read after generation: the athlete may have deleted the chat.
            db.expire_all()
            row = db.get(model, row_id)
            if row is None or row.status != "pending":
                return
            for key, value in values.items():
                setattr(row, key, value)
            row.status = "done"
            row.error = None
            db.commit()
        except (Exception, asyncio.CancelledError) as exc:
            if not isinstance(exc, asyncio.CancelledError):
                log.exception("Generation failed for %s %d", model.__name__, row_id)
            # A failed flush/commit leaves the session unusable until rollback.
            db.rollback()
            try:
                row = db.get(model, row_id)
                if row is not None and row.status == "pending":
                    row.status = "error"
                    row.error = (
                        INTERRUPTED_ERROR if isinstance(exc, asyncio.CancelledError) else str(exc)
                    )
                    db.commit()
            except Exception:
                db.rollback()
                log.exception("Could not record generation failure for %s %d", model.__name__, row_id)
            if isinstance(exc, asyncio.CancelledError):
                raise


def fail_interrupted_generations(db: Session) -> None:
    """Run before accepting requests, in the single backend process only."""
    for model in (CoachMessage, NutritionEstimate):
        db.execute(
            update(model)
            .where(model.status == "pending")
            .values(status="error", error=INTERRUPTED_ERROR)
        )
    db.commit()
