"""Persistent completion signal for manual and scheduled Garmin syncs."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import AppSetting


def record_sync_result(db: Session, *, ok: bool) -> None:
    db.merge(AppSetting(key="garmin_last_sync_at", value=datetime.now(UTC).isoformat()))
    db.merge(AppSetting(key="garmin_last_sync_ok", value="true" if ok else "false"))
    db.commit()
