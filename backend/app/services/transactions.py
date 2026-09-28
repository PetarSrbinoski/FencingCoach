"""Shared transaction locks for reviewed nutrition writes and resource undo."""

from __future__ import annotations

import hashlib

from sqlalchemy import text
from sqlalchemy.orm import Session


def _lock(db: Session, key: int) -> None:
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def lock_nutrition_inputs(db: Session) -> None:
    _lock(db, 71248791)


def lock_meal_inputs(db: Session) -> None:
    _lock(db, 71248792)


def lock_resource(db: Session, kind: str, resource_id: str | int) -> None:
    if kind in {"food_create", "food_update", "food"}:
        kind = "food"
        lock_meal_inputs(db)
    elif kind in {"workout", "competition"}:
        lock_nutrition_inputs(db)
    key = int.from_bytes(hashlib.sha256(f"{kind}:{resource_id}".encode()).digest()[:8], "big", signed=True)
    _lock(db, key)
