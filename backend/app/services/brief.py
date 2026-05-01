"""Daily brief generation.

Composes today's data context + the brief prompt, calls the LLM, and
upserts the result into `daily_briefs`. The structured `payload` field
also stores the readiness object so the frontend can render the gauge
without re-computing.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import DailyBrief
from app.services.context import build_context
from app.services.llm import get_llm
from app.services.prompts import COACH_SYSTEM_PROMPT, DAILY_BRIEF_PROMPT
from app.services.readiness import compute_readiness

log = logging.getLogger(__name__)


def generate_daily_brief(db: Session, day: date | None = None) -> DailyBrief:
    day = day or date.today()
    readiness = compute_readiness(db, day)
    context = build_context(db, day)

    messages = [
        {"role": "system", "content": COACH_SYSTEM_PROMPT},
        {"role": "system", "content": context},
        {"role": "user", "content": DAILY_BRIEF_PROMPT},
    ]
    resp = get_llm().chat(messages, temperature=0.5, max_tokens=600)

    payload = {
        "readiness": readiness.to_dict(),
        "model": resp.model,
        "prompt_tokens": resp.prompt_tokens,
        "completion_tokens": resp.completion_tokens,
    }

    stmt = pg_insert(DailyBrief).values(
        day=day,
        readiness_score=readiness.score,
        summary=resp.content,
        payload=payload,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["day"],
        set_={
            "readiness_score": stmt.excluded.readiness_score,
            "summary": stmt.excluded.summary,
            "payload": stmt.excluded.payload,
            "generated_at": func.now(),
        },
    )
    db.execute(stmt)
    db.commit()

    brief = db.query(DailyBrief).filter(DailyBrief.day == day).one()
    return brief
