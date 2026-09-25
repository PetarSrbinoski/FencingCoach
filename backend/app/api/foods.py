"""Personal food library and logging from saved portions."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import NutritionLogOut
from app.schemas.foods import SavedFoodInput, SavedFoodLogInput, SavedFoodOut
from app.services import foods

router = APIRouter(prefix="/nutrition/foods", tags=["nutrition"])


@router.get("", response_model=list[SavedFoodOut])
def list_foods(q: str = Query("", max_length=200), db: Session = Depends(get_db)):
    return foods.list_foods(db, q)


@router.post("", response_model=SavedFoodOut, status_code=201)
def create_food(body: SavedFoodInput, db: Session = Depends(get_db)):
    try:
        return foods.save_food(db, body)
    except foods.FoodError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.put("/{food_id}", response_model=SavedFoodOut)
def update_food(food_id: int, body: SavedFoodInput, db: Session = Depends(get_db)):
    try:
        return foods.save_food(db, body, food_id)
    except foods.FoodError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.delete("/{food_id}", status_code=204)
def delete_food(food_id: int, db: Session = Depends(get_db)):
    try:
        food = foods.get_food(db, food_id)
    except foods.FoodError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    db.delete(food)
    db.commit()


@router.post("/log", response_model=NutritionLogOut)
def log_saved_foods(body: SavedFoodLogInput, db: Session = Depends(get_db)):
    try:
        return foods.log_foods(db, body.portions, day=body.day, meal=body.meal)
    except foods.FoodError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
