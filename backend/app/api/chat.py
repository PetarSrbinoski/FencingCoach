"""Chat endpoints — PydanticAI agent with context injection.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.coach import run_coach_chat
from app.core.database import SessionLocal, get_db
from app.models import CoachConversation, CoachMessage
from app.schemas import (
    ChatAccepted,
    ChatMessageStatus,
    ChatRequest,
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
                status=message.status,
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


@router.post("", response_model=ChatAccepted, status_code=status.HTTP_202_ACCEPTED)
async def chat(
    req: ChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ChatAccepted:
    """Store the athlete's turn and hand the reply off to a background
    job — see module docstring. Poll `GET /chat/messages/{message_id}`
    (returned here) for the result."""
    conv = _get_or_create_conversation(db, req)

    # Store user turn.
    db.add(CoachMessage(conversation_id=conv.id, role="user", content=req.message))
    db.flush()

    history_for_agent = _history_for_agent(db, conv.id)
    # Snapshot history as plain (role, content) pairs now — the ORM
    # objects are bound to this request-scoped session, which is closed
    # (see module docstring) before the background job runs.
    history_snapshot = [(m.role, m.content) for m in history_for_agent]
    context_text = build_context(db) if req.include_context else ""

    placeholder = CoachMessage(
        conversation_id=conv.id, role="assistant", content="", status="pending"
    )
    db.add(placeholder)
    # Commit now so both turns are durable even if the background job
    # never gets to run (e.g. a restart before it starts).
    db.commit()
    db.refresh(placeholder)

    background_tasks.add_task(
        _generate_reply,
        message_id=placeholder.id,
        user_message=req.message,
        context_text=context_text,
        history_snapshot=history_snapshot,
    )

    return ChatAccepted(conversation_id=conv.id, message_id=placeholder.id)


async def _generate_reply(
    *,
    message_id: int,
    user_message: str,
    context_text: str,
    history_snapshot: list[tuple[str, str]],
) -> None:
    """Background job: runs the LLM call and writes the result back to
    `message_id`, regardless of whether any client is still around to
    see it happen live. Opens its own DB session — see module
    docstring for why it can't reuse the request's."""
    db = SessionLocal()
    try:
        history_messages = [
            SimpleNamespace(role=role, content=content) for role, content in history_snapshot
        ]
        result = await run_coach_chat(
            user_message=user_message,
            db=db,
            context_text=context_text,
            history_messages=history_messages or None,
        )
        msg = db.get(CoachMessage, message_id)
        if msg is None:
            return
        msg.content = result.reply
        msg.status = "done"
        msg.meta = {
            "model": result.model,
            "context_snapshot": context_text or None,
            "ungrounded_claims": result.ungrounded_claims,
        }
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("Coach reply generation failed for message %d", message_id)
        msg = db.get(CoachMessage, message_id)
        if msg is not None:
            msg.status = "error"
            msg.error = str(e)
            db.commit()
    finally:
        db.close()


@router.get("/messages/{message_id}", response_model=ChatMessageStatus)
def get_message_status(
    message_id: int,
    db: Session = Depends(get_db),
) -> ChatMessageStatus:
    """Poll the result of a `POST /chat` reply. `status` is `"pending"`
    while the background job is still running, `"done"` with `content`
    filled in once it finishes, or `"error"` with `error` set."""
    msg = db.get(CoachMessage, message_id)
    if msg is None:
        raise HTTPException(404, "message not found")
    meta = msg.meta or {}
    return ChatMessageStatus(
        id=msg.id,
        status=msg.status,
        content=msg.content,
        model=meta.get("model"),
        context_snapshot=meta.get("context_snapshot"),
        ungrounded_claims=meta.get("ungrounded_claims", []),
        error=msg.error,
    )
