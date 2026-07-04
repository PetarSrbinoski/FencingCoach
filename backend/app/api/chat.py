"""Chat endpoints — PydanticAI agent with context injection.

Stores user/assistant turns in `coach_conversations` and `coach_messages`.
On each turn, we (optionally) inject a fresh `system` message containing
the latest snapshot of Garmin/training/nutrition state via
`build_context`. The snapshot is rebuilt every request so the coach
always sees current data.

Two response modes:
- `POST /chat` — single JSON response (async, non-streaming).
- `POST /chat/stream` — Server-Sent Events, text deltas as they're
  generated, for a responsive typing-style UI.

Both responses include `context_snapshot` ("what the coach saw" — the
exact context text injected into the prompt) and `ungrounded_claims`
(heuristic grounding check — see `services.grounding`) for transparency.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.coach import run_coach_chat, stream_coach_chat
from app.core.database import get_db
from app.models import CoachConversation, CoachMessage
from app.schemas import (
    ChatRequest,
    ChatResponse,
    CoachConversationOut,
    CoachConversationSummary,
    CoachMessageOut,
)
from app.services.context import build_context

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/conversations", response_model=list[CoachConversationSummary])
def list_conversations(
    db: Session = Depends(get_db),
) -> list[CoachConversationSummary]:
    message_count = func.count(CoachMessage.id)
    rows = db.execute(
        select(
            CoachConversation.id,
            CoachConversation.title,
            CoachConversation.created_at,
            CoachConversation.updated_at,
            message_count.label("message_count"),
        )
        .outerjoin(CoachMessage, CoachMessage.conversation_id == CoachConversation.id)
        .group_by(
            CoachConversation.id,
            CoachConversation.title,
            CoachConversation.created_at,
            CoachConversation.updated_at,
        )
        .order_by(CoachConversation.updated_at.desc(), CoachConversation.id.desc())
    ).all()
    return [
        CoachConversationSummary(
            id=row.id,
            title=row.title,
            created_at=row.created_at,
            updated_at=row.updated_at,
            message_count=row.message_count,
            last_message_preview=row.title,
        )
        for row in rows
    ]


@router.get("/conversations/{conversation_id}", response_model=CoachConversationOut)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
) -> CoachConversationOut:
    conv = db.get(CoachConversation, conversation_id)
    if conv is None:
        raise HTTPException(404, "conversation not found")
    messages = db.scalars(
        select(CoachMessage)
        .where(CoachMessage.conversation_id == conv.id)
        .order_by(CoachMessage.created_at, CoachMessage.id)
    ).all()
    return CoachConversationOut(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[
            CoachMessageOut(
                id=message.id,
                role=message.role,
                content=message.content,
                created_at=message.created_at,
            )
            for message in messages
            if message.role in {"user", "assistant"}
        ],
    )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
) -> Response:
    conv = db.get(CoachConversation, conversation_id)
    if conv is None:
        raise HTTPException(404, "conversation not found")
    db.delete(conv)
    db.commit()

    # IMPORTANT: return empty response for 204
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── shared conversation/history helpers ────────────────────────────────
def _get_or_create_conversation(db: Session, req: ChatRequest) -> CoachConversation:
    conv: CoachConversation | None
    if req.conversation_id is not None:
        conv = db.get(CoachConversation, req.conversation_id)
        if conv is None:
            raise HTTPException(404, "conversation not found")
    else:
        conv = CoachConversation(title=req.message[:80])
        db.add(conv)
        db.flush()

    if not conv.title:
        conv.title = req.message[:80]
    conv.updated_at = datetime.now(UTC)
    return conv


def _history_for_agent(db: Session, conversation_id: int) -> list[CoachMessage]:
    """Last 20 prior turns for the agent, excluding the just-added latest
    user message (that's sent separately as the run's user prompt)."""
    history = db.scalars(
        select(CoachMessage)
        .where(CoachMessage.conversation_id == conversation_id)
        .order_by(CoachMessage.created_at)
    ).all()
    history_for_agent = [m for m in history if m.role in ("user", "assistant")]
    return history_for_agent[-21:-1]


@router.post("", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
) -> ChatResponse:
    conv = _get_or_create_conversation(db, req)

    # Store user turn
    db.add(CoachMessage(conversation_id=conv.id, role="user", content=req.message))
    db.flush()

    history_for_agent = _history_for_agent(db, conv.id)
    context_text = build_context(db) if req.include_context else ""

    try:
        result = await run_coach_chat(
            user_message=req.message,
            db=db,
            context_text=context_text,
            history_messages=history_for_agent if history_for_agent else None,
        )
    except TimeoutError as e:
        raise HTTPException(
            504,
            "The LLM request timed out. This model is running in quality-first mode and can take a while.",
        ) from e

    db.add(
        CoachMessage(
            conversation_id=conv.id,
            role="assistant",
            content=result.reply,
        )
    )
    db.commit()
    db.refresh(conv)

    return ChatResponse(
        conversation_id=conv.id,
        reply=result.reply,
        model=result.model,
        context_snapshot=context_text or None,
        ungrounded_claims=result.ungrounded_claims,
    )


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Server-Sent Events variant of `POST /chat`.

    Emits `data: {"delta": "..."}` frames as the reply is generated, then
    a terminal `data: {"done": true, "reply": ..., "model": ...,
    "context_snapshot": ..., "ungrounded_claims": [...]}` frame.
    On failure mid-stream, emits `data: {"error": "..."}` instead.
    """
    conv = _get_or_create_conversation(db, req)

    db.add(CoachMessage(conversation_id=conv.id, role="user", content=req.message))
    db.flush()
    # Commit now so the user turn is durable even if the stream fails or
    # the client disconnects before the assistant reply is saved.
    db.commit()

    conversation_id = conv.id
    history_for_agent = _history_for_agent(db, conversation_id)
    context_text = build_context(db) if req.include_context else ""

    async def event_gen():
        yield f"data: {json.dumps({'conversation_id': conversation_id})}\n\n"
        try:
            async for item in stream_coach_chat(
                user_message=req.message,
                db=db,
                context_text=context_text,
                history_messages=history_for_agent if history_for_agent else None,
            ):
                if item.get("done"):
                    db.add(
                        CoachMessage(
                            conversation_id=conversation_id,
                            role="assistant",
                            content=item["reply"],
                        )
                    )
                    db.commit()
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "done": True,
                                "conversation_id": conversation_id,
                                "reply": item["reply"],
                                "model": item["model"],
                                "context_snapshot": context_text or None,
                                "ungrounded_claims": item["ungrounded_claims"],
                            }
                        )
                        + "\n\n"
                    )
                else:
                    yield f"data: {json.dumps({'delta': item['delta']})}\n\n"
        except Exception as e:  # noqa: BLE001
            log.exception("Coach stream failed: %s", e)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
