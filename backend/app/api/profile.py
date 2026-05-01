"""Athlete profile endpoints: GET and PUT the single-user profile."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models import AthleteProfile
from app.schemas import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])


def _get_or_create(db: Session) -> AthleteProfile:
    """Return the single AthleteProfile row, creating one if none exists."""
    profile = db.query(AthleteProfile).first()
    if profile is None:
        profile = AthleteProfile()
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("", response_model=ProfileOut)
def get_profile(_user: CurrentUser, db: Session = Depends(get_db)) -> ProfileOut:
    p = _get_or_create(db)
    return ProfileOut(
        id=p.id,
        name=p.name,
        sport=p.sport,
        level=p.level,
        age=p.age,
        height_cm=p.height_cm,
        weight_kg=p.weight_kg,
        fencing_style=p.fencing_style,
        goals=p.goals,
        weaknesses=p.weaknesses,
        body_comp_goal=p.body_comp_goal,
        dietary_restrictions=p.dietary_restrictions,
        food_budget=p.food_budget,
        supplements=p.supplements,
        notes=p.notes,
    )


@router.put("", response_model=ProfileOut)
def update_profile(
    body: ProfileUpdate,
    _user: CurrentUser,
    db: Session = Depends(get_db),
) -> ProfileOut:
    p = _get_or_create(db)
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return ProfileOut(
        id=p.id,
        name=p.name,
        sport=p.sport,
        level=p.level,
        age=p.age,
        height_cm=p.height_cm,
        weight_kg=p.weight_kg,
        fencing_style=p.fencing_style,
        goals=p.goals,
        weaknesses=p.weaknesses,
        body_comp_goal=p.body_comp_goal,
        dietary_restrictions=p.dietary_restrictions,
        food_budget=p.food_budget,
        supplements=p.supplements,
        notes=p.notes,
    )
