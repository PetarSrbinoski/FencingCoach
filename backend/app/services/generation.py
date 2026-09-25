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
