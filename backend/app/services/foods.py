"""Reusable food storage and deterministic portion arithmetic shared by UI and chat."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import NutritionLog, SavedFood
from app.schemas.foods import FoodNutrient, FoodPortion, SavedFoodInput

CORE = ("kcal", "protein_g", "carbs_g", "fat_g")
MACROS = (*CORE, "fiber_g")


class FoodError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def normalized_name(name: str) -> str:
    return " ".join(name.casefold().split())


def list_foods(db: Session, query: str = "") -> list[SavedFood]:
    stmt = select(SavedFood).order_by(SavedFood.name_key)
    if query.strip():
        stmt = stmt.where(SavedFood.name_key.contains(normalized_name(query), autoescape=True))
    return list(db.scalars(stmt).all())


def get_food(db: Session, food_id: int) -> SavedFood:
    food = db.get(SavedFood, food_id)
    if food is None:
        raise FoodError("Saved food not found. Search the library again.", 404)
    return food


def nutrient_key(nutrient: FoodNutrient) -> tuple[str, Decimal]:
    """Keep label units in the library; normalize mass units only for totals.

    IU is deliberately separate: conversion to mass depends on the substance.
    Known names retain the keys used by existing nutrition logs.
    """
    name = re.sub(r"[^\w]+", "_", nutrient.name.casefold()).strip("_")
    name = {"vitamin_b12": "b12", "vitamin_b_12": "b12", "omega_3": "omega3"}.get(name, name)
    if not name:
        raise FoodError("A nutrient name must contain letters or numbers.")
    if nutrient.unit == "IU":
        return f"{name}_iu", Decimal(str(nutrient.amount))
    unit = {"b12": "mcg", "vitamin_d": "mcg", "omega3": "g"}.get(name, "mg")
    factors = {"g": Decimal("1000"), "mg": Decimal("1"), "mcg": Decimal("0.001")}
    amount = Decimal(str(nutrient.amount)) * factors[nutrient.unit] / factors[unit]
    return f"{name}_{unit}", amount


def nutrient_values(micros: list[FoodNutrient]) -> dict[str, float]:
    values: dict[str, float] = {}
    for nutrient in micros:
        key, amount = nutrient_key(nutrient)
        if key in values:
            raise FoodError(f"Duplicate nutrient: {nutrient.name}. Supply one value per nutrient.")
        values[key] = float(amount)
    return values


def save_food(db: Session, data: SavedFoodInput, food_id: int | None = None) -> SavedFood:
    nutrient_values(data.micros)  # validate normalized duplicates before writing
    key = normalized_name(data.name)
    duplicate = db.scalar(select(SavedFood).where(SavedFood.name_key == key))
    if duplicate is not None and duplicate.id != food_id:
        raise FoodError(
            f"'{duplicate.name}' already exists (id {duplicate.id}). "
            "Choose to edit it, or give the new variant a distinct name.",
            409,
        )
    food = get_food(db, food_id) if food_id is not None else SavedFood()
    for name, value in data.model_dump().items():
        setattr(food, name, value)
    food.name_key = key
    db.add(food)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise FoodError(
            "That food name already exists. Edit it or use a distinct name.", 409
        ) from exc
    db.refresh(food)
    return food


def per_100g(data: SavedFoodInput, values_for_g: float) -> SavedFoodInput:
    """Normalize a supplied label serving without asking the LLM to do arithmetic."""
    factor = Decimal(100) / Decimal(str(values_for_g))
    updates: dict[str, Any] = {
        key: float(Decimal(str(getattr(data, key))) * factor)
        for key in MACROS
        if getattr(data, key) is not None
    }
    if "micros" in data.model_fields_set:
        updates["micros"] = [
            m.model_copy(update={"amount": float(Decimal(str(m.amount)) * factor)})
            for m in data.micros
        ]
    return data.model_copy(update=updates)


def portion_values(db: Session, portion: FoodPortion) -> dict[str, Any]:
    food = get_food(db, portion.food_id)
    missing = [key for key in CORE if getattr(food, key) is None]
    if missing:
        raise FoodError(f"Add {', '.join(missing)} to '{food.name}' before logging it.")
    if portion.grams is not None:
        grams = Decimal(str(portion.grams))
    elif food.serving_size_g is not None:
        grams = Decimal(str(portion.servings)) * Decimal(str(food.serving_size_g))
    else:
        raise FoodError(f"'{food.name}' has no saved serving weight. Specify grams.")
    factor = grams / Decimal(100)
    nutrients = {
        key: float(Decimal(str(getattr(food, key))) * factor)
        for key in MACROS
        if getattr(food, key) is not None
    }
    micros = {
        key: float(Decimal(str(value)) * factor)
        for key, value in nutrient_values([FoodNutrient(**m) for m in food.micros]).items()
    }
    return {
        **nutrients,
        "fiber_g": nutrients.get("fiber_g"),
        "micros": micros,
        "items": [
            {
                "name": food.name,
                "qty_g": float(grams),
                "food_id": food.id,
                "source": "saved",
                "nutrients": {**nutrients, **micros},
            }
        ],
        "incomplete_micros": [],
    }


def combine_portions(parts: list[dict[str, Any]]) -> dict[str, Any]:
    if not parts:
        raise FoodError("Select at least one food.")
    keys = set().union(*(part["micros"] for part in parts))
    incomplete = {
        key
        for key in keys
        if any(
            key not in part["micros"] or key in part.get("incomplete_micros", []) for part in parts
        )
    }
    return {
        **{
            key: float(sum((Decimal(str(part.get(key) or 0)) for part in parts), Decimal(0)))
            for key in CORE
        },
        "fiber_g": (
            float(sum(Decimal(str(part["fiber_g"])) for part in parts))
            if all(part.get("fiber_g") is not None for part in parts)
            else None
        ),
        "micros": {
            key: float(
                sum((Decimal(str(part["micros"].get(key, 0))) for part in parts), Decimal(0))
            )
            for key in sorted(keys)
        },
        "incomplete_micros": sorted(incomplete),
        "items": [item for part in parts for item in part.get("items", [])],
    }


def log_foods(
    db: Session, portions: list[FoodPortion], *, day: date | None = None, meal: str | None = None
) -> NutritionLog:
    values = combine_portions([portion_values(db, portion) for portion in portions])
    items = values.pop("items")
    incomplete = values.pop("incomplete_micros")
    values["micros"].update(items=items, incomplete_micros=incomplete)
    row = NutritionLog(
        **values,
        day=day or athlete_today(),
        meal=meal,
        estimated_by="saved",
        raw_text=", ".join(f"{item['qty_g']:g} g {item['name']}" for item in items),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
