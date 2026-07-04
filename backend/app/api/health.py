"""Health / readiness probes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import HealthResponse

log = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


def _check_llm() -> bool:
    """Quick liveness probe against the LLM endpoint via OpenAI SDK."""
    try:
        from app.agents.deps import get_active_model

        # Just verify the model object can be constructed (provider is reachable
        # is checked lazily on first call). This is a lightweight check.
        model = get_active_model()
        return model is not None
    except Exception as e:  # noqa: BLE001
        log.warning("LLM health check failed: %s", e)
        return False


@router.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    db_ok = False
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False

    llm_ok = _check_llm()
    return HealthResponse(
        status="ok" if (db_ok and llm_ok) else "degraded",
        db=db_ok,
        llm=llm_ok,
    )
