"""Athlete controls for inspectable coach memory."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.coach_memory import MemoryCreate, MemoryEdit, MemoryGuard
from app.services import coach_memory as memory

router = APIRouter(prefix="/coach-memory", tags=["coach memory"])


class MemorySetting(BaseModel):
    enabled: StrictBool


@router.get("")
def list_memories(db: Session = Depends(get_db)) -> dict:
    return memory.list_memories(db)


@router.put("/settings")
def set_setting(body: MemorySetting, db: Session = Depends(get_db)) -> dict:
    memory.set_enabled(db, body.enabled)
    return memory.list_memories(db)


def apply(db: Session, operation: str, body: MemoryCreate | MemoryGuard, memory_id: int | None = None) -> dict:
    try:
        return memory.mutate(db, operation, request_key=f"memory:ui:{body.request_id}",
                             memory_id=memory_id,
                             expected_revision=getattr(body, "expected_revision", None),
                             content=body if isinstance(body, (MemoryCreate, MemoryEdit)) else None)
    except memory.MemoryConflict as exc:
        db.rollback()
        raise HTTPException(409, str(exc)) from exc
    except LookupError as exc:
        db.rollback()
        raise HTTPException(404, str(exc)) from exc


@router.post("")
def create(body: MemoryCreate, db: Session = Depends(get_db)) -> dict:
    return apply(db, "create", body)


@router.put("/{memory_id}")
def edit(memory_id: int, body: MemoryEdit, db: Session = Depends(get_db)) -> dict:
    return apply(db, "edit", body, memory_id)


@router.post("/{memory_id}/confirm")
def confirm(memory_id: int, body: MemoryGuard, db: Session = Depends(get_db)) -> dict:
    return apply(db, "confirm", body, memory_id)


@router.delete("/{memory_id}")
def delete(memory_id: int, body: MemoryGuard, db: Session = Depends(get_db)) -> dict:
    return apply(db, "delete", body, memory_id)
