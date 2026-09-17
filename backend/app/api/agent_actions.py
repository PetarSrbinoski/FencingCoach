"""User-facing coach action receipts and guarded undo."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import AgentAction
from app.services.agent_actions import present, undo

router = APIRouter(prefix="/agent-actions", tags=["agent actions"])


class UndoInput(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)


@router.get("")
def list_actions(
    kind: str | None = None, status: str | None = None,
    start: date | None = None, end: date | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
) -> dict:
    conditions = []
    if kind:
        conditions.append(AgentAction.kind == kind)
    if status:
        conditions.append(AgentAction.status == status)
    if start:
        conditions.append(func.date(AgentAction.created_at) >= start)
    if end:
        conditions.append(func.date(AgentAction.created_at) <= end)
    count = db.scalar(select(func.count()).select_from(AgentAction).where(*conditions)) or 0
    rows = db.scalars(select(AgentAction).where(*conditions).order_by(
        AgentAction.created_at.desc(), AgentAction.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [present(db, row) for row in rows], "total": count, "page": page, "page_size": page_size}


@router.get("/{action_id}")
def get_action(action_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(AgentAction, action_id)
    if row is None:
        raise HTTPException(404, "Action not found")
    return present(db, row)


@router.post("/{action_id}/undo")
def undo_action(action_id: int, body: UndoInput, db: Session = Depends(get_db)) -> dict:
    try:
        row, success = undo(db, action_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not success:
        raise HTTPException(409, row["error"])
    return row
