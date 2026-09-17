"""Explicit review and application of coach-generated target previews."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import CoachPlanProposal, Competition
from app.services.agent_actions import record_action
from app.services.competition_nutrition import preview, stage_accepted_plan
from app.services.transactions import lock_nutrition_inputs

router = APIRouter(prefix="/coach-plan-proposals", tags=["coach plan proposals"])


def _out(row: CoachPlanProposal) -> dict[str, Any]:
    return {"id": row.id, "event_id": row.event_id, "inputs": row.inputs,
            "preview": row.preview, "token": row.token, "status": row.status,
            "conversation_id": row.conversation_id, "message_id": row.message_id,
            "applied_plan_id": row.applied_plan_id, "action_id": row.action_id,
            "created_at": row.created_at.isoformat() if row.created_at else None}


@router.get("")
def list_proposals(conversation_id: int | None = None, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    stmt = select(CoachPlanProposal).order_by(CoachPlanProposal.created_at.desc(), CoachPlanProposal.id.desc()).limit(50)
    if conversation_id is not None:
        stmt = stmt.where(CoachPlanProposal.conversation_id == conversation_id)
    return [_out(row) for row in db.scalars(stmt).all()]


@router.get("/{proposal_id}")
def get_proposal(proposal_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(CoachPlanProposal, proposal_id)
    if row is None:
        raise HTTPException(404, "Coach plan proposal not found")
    return _out(row)


@router.post("/{proposal_id}/cancel")
def cancel_proposal(proposal_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.scalar(select(CoachPlanProposal).where(CoachPlanProposal.id == proposal_id).with_for_update())
    if row is None:
        raise HTTPException(404, "Coach plan proposal not found")
    if row.status == "applied":
        raise HTTPException(409, "This plan was already applied; use Agent logs to review undo")
    row.status = "cancelled"
    db.commit()
    return _out(row)


@router.post("/{proposal_id}/apply")
def apply_proposal(proposal_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    lock_nutrition_inputs(db)
    row = db.scalar(select(CoachPlanProposal).where(CoachPlanProposal.id == proposal_id).with_for_update())
    if row is None:
        raise HTTPException(404, "Coach plan proposal not found")
    if row.status == "applied":
        return _out(row)
    if row.status != "pending":
        raise HTTPException(409, "This proposal was cancelled; request a new preview")
    event = db.get(Competition, row.event_id)
    if event is None:
        raise HTTPException(409, "Competition is no longer present; request a fresh preview")
    try:
        draft = preview(db, event, row.inputs)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    if draft["token"] != row.token:
        raise HTTPException(409, "Coach preview is stale; request a fresh comparison before applying")
    plan, before, after = stage_accepted_plan(db, draft, f"coach-proposal-{row.id}")
    action = record_action(db, "nutrition_plan", plan.id,
                           f"Applied nutrition plan v{plan.version} for {event.name}",
                           {"assignments": before, "proposal_id": row.id},
                           {"assignments": after, "plan_id": plan.id, "version": plan.version, "event_id": event.id},
                           conversation_id=row.conversation_id, message_id=row.message_id)
    row.status = "applied"
    row.applied_plan_id = plan.id
    row.action_id = action.id
    db.commit()
    return _out(row)
