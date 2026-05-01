"""Health / readiness probes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import HealthResponse
from app.services.llm import get_llm

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    db_ok = False
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False

    llm_ok = get_llm().health()
    return HealthResponse(
        status="ok" if (db_ok and llm_ok) else "degraded",
        db=db_ok,
        llm=llm_ok,
    )
