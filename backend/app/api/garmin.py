"""Garmin endpoints: login, manual sync, status."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import GarminMetric
from app.schemas import GarminLoginRequest, GarminSyncResult
from app.services.garmin import get_garmin

router = APIRouter(prefix="/garmin", tags=["garmin"])


@router.post("/login")
def login(req: GarminLoginRequest) -> dict[str, str]:
    try:
        get_garmin().login(email=req.email, password=req.password)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "429" in msg or "too many" in msg.lower():
            raise HTTPException(
                429,
                "Garmin rate-limited login. This usually means the current auth "
                "flow is blocked or too many attempts were made. After dependency "
                "upgrade, rebuild the backend and try again.",
            ) from e
        raise HTTPException(400, f"Garmin login failed: {e}") from e
    return {"status": "ok"}


@router.post("/sync/recent", response_model=GarminSyncResult)
def sync_recent(
    days: int = settings.GARMIN_RECENT_SYNC_DAYS,
    db: Session = Depends(get_db),
) -> GarminSyncResult:
    started = datetime.now(timezone.utc)
    try:
        result = get_garmin().sync_recent(db, days=days)
        return GarminSyncResult(
            ok=True,
            fetched=result,
            started_at=started,
            finished_at=datetime.now(timezone.utc),
        )
    except Exception as e:  # noqa: BLE001
        return GarminSyncResult(
            ok=False,
            fetched={},
            started_at=started,
            finished_at=datetime.now(timezone.utc),
            error=str(e),
        )


@router.post("/sync/full", response_model=GarminSyncResult)
def sync_full(
    days: int = settings.GARMIN_FULL_SYNC_DAYS,
    db: Session = Depends(get_db),
) -> GarminSyncResult:
    started = datetime.now(timezone.utc)
    try:
        result = get_garmin().sync_full(db, days=days)
        return GarminSyncResult(
            ok=True,
            fetched=result,
            started_at=started,
            finished_at=datetime.now(timezone.utc),
        )
    except Exception as e:  # noqa: BLE001
        return GarminSyncResult(
            ok=False,
            fetched={},
            started_at=started,
            finished_at=datetime.now(timezone.utc),
            error=str(e),
        )


@router.get("/status")
def status(db: Session = Depends(get_db)) -> dict[str, object]:
    last = db.scalar(select(func.max(GarminMetric.fetched_at)))
    count = db.scalar(select(func.count()).select_from(GarminMetric)) or 0
    return {
        "last_fetch": last.isoformat() if last else None,
        "metric_rows": int(count),
    }
