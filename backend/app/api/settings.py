"""Manual LLM provider toggle (local vs cloud) — see app/services/llm_provider.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.deps import get_active_provider, set_active_provider
from app.core.database import get_db
from app.schemas import LLMProviderOut, LLMProviderRequest
from app.services.llm_provider import VALID_PROVIDERS, set_llm_provider

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/llm-provider", response_model=LLMProviderOut)
def get_llm_provider_setting() -> LLMProviderOut:
    """Currently active provider — the in-process value (kept in sync with
    the persisted one by `PUT`, and hydrated from it at startup)."""
    return LLMProviderOut(provider=get_active_provider())


@router.put("/llm-provider", response_model=LLMProviderOut)
def set_llm_provider_setting(
    body: LLMProviderRequest,
    db: Session = Depends(get_db),
) -> LLMProviderOut:
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid provider '{body.provider}'. Must be one of: {VALID_PROVIDERS}",
        )
    set_llm_provider(db, body.provider)
    # Take effect immediately for every agent, no backend restart needed.
    set_active_provider(body.provider)
    return LLMProviderOut(provider=body.provider)
