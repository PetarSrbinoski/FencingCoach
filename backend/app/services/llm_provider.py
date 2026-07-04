"""Manual LLM provider toggle (local vs cloud).

Replaces the old automatic "primary fails -> silently escalate to cloud
fallback" behavior for the local/cloud split specifically: the athlete
explicitly picks which pool of models to use (see the sidebar toggle),
persisted in `app_settings` and cached in-process (`app.agents.deps`) so
it takes effect immediately without a backend restart.

Within the "cloud" pool, `LLM_FALLBACK_MODEL` -> `LLM_FALLBACK2_MODEL`
still cascade automatically on transient errors (capacity/rate-limit) —
that's unrelated to this toggle, both tiers are already "cloud".
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import AppSetting

SETTING_KEY = "llm_provider"
VALID_PROVIDERS = ("local", "cloud")
DEFAULT_PROVIDER = "local"


def get_llm_provider(db: Session) -> str:
    """Read the persisted provider choice, defaulting to `DEFAULT_PROVIDER`
    if never set (or set to something no longer valid)."""
    row = db.scalar(select(AppSetting).where(AppSetting.key == SETTING_KEY))
    if row is not None and row.value in VALID_PROVIDERS:
        return row.value
    return DEFAULT_PROVIDER


def set_llm_provider(db: Session, provider: str) -> str:
    """Persist the provider choice. Raises `ValueError` for an unknown
    provider. Returns the stored value."""
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"invalid LLM provider {provider!r}, must be one of {VALID_PROVIDERS}")

    stmt = pg_insert(AppSetting).values(key=SETTING_KEY, value=provider)
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value": stmt.excluded.value},
    )
    db.execute(stmt)
    db.commit()
    return provider
