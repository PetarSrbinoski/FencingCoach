"""Activity endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models import Activity
from app.schemas import ActivityOut

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/recent", response_model=list[ActivityOut])
def recent(
    _user: CurrentUser,
    days: int = Query(14, ge=1, le=180),
    db: Session = Depends(get_db),
) -> list[ActivityOut]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    acts = db.scalars(
        select(Activity)
        .where(Activity.start_time >= since)
        .order_by(Activity.start_time.desc())
    ).all()
    return [ActivityOut.model_validate(a, from_attributes=True) for a in acts]
