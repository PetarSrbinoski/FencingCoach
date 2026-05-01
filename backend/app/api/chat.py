"""Chat endpoint — Phase 2: with RAG context injection.

Stores user/assistant turns in `coach_conversations` and `coach_messages`.
On each turn, we (optionally) inject a fresh `system` message containing
the latest snapshot of Garmin/training/nutrition state via
`build_context`. The snapshot is rebuilt every request so the coach
always sees current data.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from openai import APITimeoutError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models import CoachConversation, CoachMessage
from app.schemas import ChatRequest, ChatResponse
from app.services.context import build_context
from app.services.llm import get_llm
from app.services.prompts import COACH_SYSTEM_PROMPT

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    _user: CurrentUser,
    db: Session = Depends(get_db),
) -> ChatResponse:
    # ── conversation ──────────────────────────────────────────────────
    conv: CoachConversation | None
    if req.conversation_id is not None:
        conv = db.get(CoachConversation, req.conversation_id)
        if conv is None:
            raise HTTPException(404, "conversation not found")
    else:
        conv = CoachConversation(title=req.message[:80])
        db.add(conv)
        db.flush()

    # Store user turn
    db.add(CoachMessage(conversation_id=conv.id, role="user", content=req.message))
    db.flush()

    # ── build prompt ──────────────────────────────────────────────────
    history = db.scalars(
        select(CoachMessage)
        .where(CoachMessage.conversation_id == conv.id)
        .order_by(CoachMessage.created_at)
    ).all()
    history = history[-20:]

    messages: list[dict[str, str]] = [
        {"role": "system", "content": COACH_SYSTEM_PROMPT}
    ]
    if req.include_context:
        messages.append({"role": "system", "content": build_context(db)})
    messages.extend({"role": m.role, "content": m.content} for m in history)

    # ── call LLM ──────────────────────────────────────────────────────
    try:
        resp = get_llm().chat(
            messages,
            temperature=0.4,
            max_tokens=1200,
            reasoning_effort="high",
        )
    except APITimeoutError as e:
        raise HTTPException(
            504,
            "The LLM request timed out. This model is running in quality-first mode and can take a while.",
        ) from e

    db.add(
        CoachMessage(
            conversation_id=conv.id,
            role="assistant",
            content=resp.content,
            tokens=resp.completion_tokens,
        )
    )
    db.commit()
    db.refresh(conv)

    return ChatResponse(
        conversation_id=conv.id,
        reply=resp.content,
        model=resp.model,
        prompt_tokens=resp.prompt_tokens,
        completion_tokens=resp.completion_tokens,
    )
