"""Meal plans + shopping list."""

from __future__ import annotations

from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.database import get_db
from app.models import NutritionPlan
from app.schemas import MealPlanOut, ShoppingList
from app.agents.mealplan import generate_meal_plan
from app.services.mealplan import build_shopping_list

router = APIRouter(prefix="/mealplan", tags=["mealplan"])


# Note: order matters — literal-path routes must be declared BEFORE
# parameterized routes that would otherwise capture them.


@router.post("/today", response_model=MealPlanOut)
def generate_today(db: Session = Depends(get_db)) -> MealPlanOut:
    try:
        plan = generate_meal_plan(db, athlete_today())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"meal plan generation failed: {e}") from e
    return MealPlanOut(
        day=plan.day,
        targets=plan.targets,
        plan=plan.plan,
        generated_at=plan.generated_at,
    )


@router.post("/week", response_model=list[MealPlanOut])
def generate_week(
    start: Date | None = Query(None),
    db: Session = Depends(get_db),
) -> list[MealPlanOut]:
    """Generate (or refresh) plans for `start` through `start+6`."""
    start = start or athlete_today()
    out: list[MealPlanOut] = []
    for i in range(7):
        d = start + timedelta(days=i)
        try:
            plan = generate_meal_plan(db, d)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"week generation failed at {d}: {e}") from e
        out.append(
            MealPlanOut(
                day=plan.day,
                targets=plan.targets,
                plan=plan.plan,
                generated_at=plan.generated_at,
            )
        )
    return out


@router.post("/{day}", response_model=MealPlanOut)
def generate(
    day: Date, db: Session = Depends(get_db)
) -> MealPlanOut:
    try:
        plan = generate_meal_plan(db, day)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"meal plan generation failed: {e}") from e
    return MealPlanOut(
        day=plan.day,
        targets=plan.targets,
        plan=plan.plan,
        generated_at=plan.generated_at,
    )


@router.get("/{day}", response_model=MealPlanOut | None)
def get_plan(
    day: Date, db: Session = Depends(get_db)
) -> MealPlanOut | None:
    plan = db.scalar(select(NutritionPlan).where(NutritionPlan.day == day))
    if not plan:
        return None
    return MealPlanOut(
        day=plan.day,
        targets=plan.targets,
        plan=plan.plan,
        generated_at=plan.generated_at,
    )


# ── shopping list ─────────────────────────────────────────────────────
shopping_router = APIRouter(prefix="/shopping", tags=["shopping"])


@shopping_router.get("/week", response_model=ShoppingList)
def shopping_week(
    start: Date | None = Query(None),
    db: Session = Depends(get_db),
) -> ShoppingList:
    start = start or athlete_today()
    return ShoppingList(**build_shopping_list(db, start, start + timedelta(days=6)))


@shopping_router.get("/range", response_model=ShoppingList)
def shopping_range(
    start: Date,
    end: Date,
    db: Session = Depends(get_db),
) -> ShoppingList:
    if end < start:
        raise HTTPException(400, "end must be >= start")
    return ShoppingList(**build_shopping_list(db, start, end))
