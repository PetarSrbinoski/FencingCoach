"""Recipe composition, revision checks and atomic consumption shared by all entry points."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentAction, NutritionDraft, NutritionLog, Recipe, SavedFood
from app.schemas.foods import FoodNutrient
from app.schemas.recipes import RecipeInput, RecipeLogInput
from app.services import foods
from app.services.agent_actions import present, record_action, snapshot
from app.services.transactions import lock_meal_inputs


class RecipeError(foods.FoodError):
    pass


def get_recipe(db: Session, recipe_id: int) -> Recipe:
    row = db.get(Recipe, recipe_id, populate_existing=True)
    if row is None or row.deleted:
        raise RecipeError("Recipe not found. Select a saved recipe again.", 404)
    return row


def list_recipes(db: Session, query: str = "") -> list[dict]:
    stmt = select(Recipe).where(Recipe.deleted.is_(False)).order_by(Recipe.name_key)
    if query.strip():
        stmt = stmt.where(Recipe.name_key.contains(foods.normalized_name(query), autoescape=True))
    return [recipe_out(row) for row in db.scalars(stmt)]


def recipe_out(row: Recipe) -> dict:
    return {"id": row.id, "revision": row.revision, **row.composition}


def recipe_snapshot(row: Recipe) -> dict:
    return {"name": row.name, "name_key": row.name_key, "composition": deepcopy(row.composition),
            "revision": row.revision, "deleted": row.deleted}


def calculate(ingredients: list[dict], portions: float | None) -> dict:
    """Unknown coverage is retained alongside known subtotals, including mass-unit micros."""
    keys = set(foods.MACROS).union(*(item.get("nutrients_per_100g", {}) for item in ingredients))
    subtotals: dict[str, float] = {}
    totals: dict[str, float | None] = {}
    for key in sorted(keys):
        known = [Decimal(str(item["nutrients_per_100g"][key])) * Decimal(str(item["qty_g"])) / 100
                 for item in ingredients if item.get("qty_g") is not None
                 and item.get("nutrients_per_100g", {}).get(key) is not None]
        subtotals[key] = float(sum(known, Decimal(0)))
        totals[key] = subtotals[key] if len(known) == len(ingredients) else None
    return {"totals": totals, "known_subtotals": subtotals,
            "incomplete_nutrients": sorted(key for key, value in totals.items() if value is None),
            "per_portion": {key: float(Decimal(str(value)) / Decimal(str(portions)))
                            if value is not None and portions else None for key, value in totals.items()}}


def compose(db: Session, data: RecipeInput, existing: Recipe | None = None) -> tuple[dict, dict]:
    ingredients: list[dict] = []
    refs: dict[str, str] = {}
    questions = []
    for index, line in enumerate(data.ingredients):
        item: dict[str, Any]
        if line.snapshot_index is not None:
            if existing is None or line.snapshot_index >= len(existing.composition["ingredients"]):
                raise RecipeError("That ingredient snapshot is unavailable. Choose a source again.")
            item = deepcopy(existing.composition["ingredients"][line.snapshot_index])
            item.update(qty_g=line.qty_g, basis=line.basis)
        elif line.food_id is not None:
            food = foods.get_food(db, line.food_id)
            refs[str(food.id)] = food.revision
            item = {"name": food.name, "food_id": food.id, "food_revision": food.revision,
                    "source": "saved", "qty_g": line.qty_g, "basis": line.basis,
                    "nutrients_per_100g": {**{key: getattr(food, key) for key in foods.MACROS},
                        **foods.nutrient_values([FoodNutrient(**m) for m in food.micros])}}
        elif line.values is not None and line.source in {"supplied", "estimated"}:
            # Exact names are matched before estimates; ambiguous partial names remain unresolved.
            matches = foods.list_foods(db, line.name or line.values.name)
            if matches and line.source == "estimated":
                questions.append(f"Choose the saved product for ingredient {index + 1}; do not replace its values with estimates.")
                item = {"name": line.name or line.values.name, "qty_g": line.qty_g, "basis": line.basis,
                        "source": "unresolved", "nutrients_per_100g": {}}
            else:
                item = {"name": line.name or line.values.name, "qty_g": line.qty_g, "basis": line.basis,
                        "source": line.source, "nutrients_per_100g": {
                            **{key: getattr(line.values, key) for key in foods.MACROS},
                            **foods.nutrient_values(line.values.micros)}}
        else:
            item = {"name": line.name or f"Ingredient {index + 1}", "qty_g": line.qty_g,
                    "basis": line.basis, "source": "unresolved", "nutrients_per_100g": {}}
            questions.append(f"Select a saved food or supply values for {item['name']}.")
        if line.qty_g is None:
            questions.append(f"Specify the gram quantity of {item['name']}; volume needs an explicit conversion.")
        if line.basis is None:
            questions.append(f"Confirm whether {item['name']} was weighed raw, cooked, or as sold.")
        ingredients.append(item)
    if data.portions is None:
        questions.append("Confirm the number of portions.")
    values = calculate(ingredients, data.portions)
    return {"name": data.name, "portions": data.portions,
            "prepared_weight_g": data.prepared_weight_g, "prep_time_min": data.prep_time_min,
            "ingredients": ingredients, **values, "questions": questions,
            "loggable": not questions and all(values["totals"][key] is not None for key in foods.CORE)}, refs


def check_refs(db: Session, refs: dict) -> None:
    for key, revision in refs.items():
        food = db.get(SavedFood, int(key), populate_existing=True)
        if food is None or food.revision != revision:
            raise RecipeError("An ingredient food changed or was removed. Refresh and review the draft.", 409)


def draft_out(row: NutritionDraft) -> dict:
    return {"id": row.id, "kind": row.kind, "status": row.status, "inputs": row.inputs,
            "payload": row.payload, "error": row.error, "revision": row.revision,
            "accepted_actions": row.accepted_actions}


def get_draft(db: Session, draft_id: int, kind: str, *, locked: bool = False) -> NutritionDraft:
    stmt = select(NutritionDraft).where(NutritionDraft.id == draft_id, NutritionDraft.kind == kind).execution_options(populate_existing=True)
    row = db.scalar(stmt.with_for_update() if locked else stmt)
    if row is None:
        raise RecipeError("Draft not found.", 404)
    return row


def check_draft(row: NutritionDraft, revision: str) -> None:
    if row.revision != revision:
        raise RecipeError("Draft changed. Review its latest version.", 409)
    if row.status != "done":
        raise RecipeError("Review a completed, uncancelled draft first.", 409)


def save_composition(db: Session, composition: dict, *, recipe_id: int | None = None,
                     expected_revision: str | None = None) -> AgentAction:
    if composition["questions"]:
        raise RecipeError(" ".join(composition["questions"]))
    key = foods.normalized_name(composition["name"])
    duplicate = db.scalar(select(Recipe).where(Recipe.name_key == key))
    if duplicate is not None and duplicate.id != recipe_id:
        raise RecipeError("Recipe name already exists. Choose a distinct name.", 409)
    before = None
    if recipe_id is not None:
        row = get_recipe(db, recipe_id)
        if row.revision != expected_revision:
            raise RecipeError("Recipe changed. Open its latest version and review your edit.", 409)
        before = recipe_snapshot(row)
    else:
        row = Recipe()
        db.add(row)
    row.name, row.name_key = composition["name"], key
    row.composition = deepcopy(composition)
    row.revision = uuid4().hex
    row.deleted = False
    db.flush()
    return record_action(db, "recipe", row.id, f"{'Updated' if before else 'Saved'} recipe {row.name}",
                         before, recipe_snapshot(row))


def fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def write_consumption(db: Session, composition: dict, *, portions: float, day: date, meal: str,
                      recipe_id: int | None = None, revision: str | None = None) -> AgentAction:
    if not composition["loggable"]:
        raise RecipeError("Resolve ingredient quantities, measurement basis and core nutrients before logging.")
    factor = Decimal(str(portions)) / Decimal(str(composition["portions"]))
    items = deepcopy(composition["ingredients"])
    for item in items:
        item["qty_g"] = float(Decimal(str(item["qty_g"])) * factor)
        item["nutrients"] = {key: float(Decimal(str(value)) * Decimal(str(item["qty_g"])) / 100)
                             if value is not None else None for key, value in item["nutrients_per_100g"].items()}
    values = calculate(items, 1)
    totals = values["totals"]
    meta = {key: value for key, value in totals.items() if key not in foods.MACROS and value is not None}
    # Partial micronutrient sums remain explicitly incomplete, matching the diary convention.
    meta.update({key: value for key, value in values["known_subtotals"].items()
                 if key not in foods.MACROS and totals[key] is None})
    meta.update(items=items, incomplete_micros=[key for key in values["incomplete_nutrients"]
                                               if key not in foods.MACROS],
                recipe_id=recipe_id, recipe_revision=revision, consumed_portions=portions,
                composition={**deepcopy(composition), "ingredients": items, "portions": 1,
                             **values, "prepared_weight_g": None})
    row = NutritionLog(day=day, meal=meal, raw_text=f"{portions:g} portion(s) of {composition['name']}",
                       **{key: totals[key] for key in foods.MACROS}, micros=meta, estimated_by="recipe")
    db.add(row)
    db.flush()
    return record_action(db, "meal", row.id, f"Logged {meal}: {row.raw_text}", None, snapshot(row, "meal"))


def portion_amount(composition: dict, portions: float | None, grams: float | None) -> float:
    if (portions is None) == (grams is None):
        raise RecipeError("Choose either portions or grams.")
    if portions is not None:
        return portions
    weight = composition["prepared_weight_g"]
    if weight is None:
        raise RecipeError("Logging by grams needs the total prepared recipe weight. Use portions.")
    return float(Decimal(str(grams)) / Decimal(str(weight)) * Decimal(str(composition["portions"])))


def log_recipe(db: Session, recipe_id: int, body: RecipeLogInput) -> dict:
    lock_meal_inputs(db)
    key = f"recipe-log:{body.request_id}"
    stamp = fingerprint({"recipe_id": recipe_id, **body.model_dump(mode="json")})
    previous = db.scalar(select(AgentAction).where(AgentAction.request_key == key))
    if previous:
        if previous.request_fingerprint != stamp:
            raise RecipeError("Request was already used for a different meal.", 409)
        return present(db, previous)
    row = get_recipe(db, recipe_id)
    if row.revision != body.expected_revision:
        raise RecipeError("Recipe changed. Review the latest portion values.", 409)
    portions = portion_amount(row.composition, body.portions, body.grams)
    action = write_consumption(db, row.composition, portions=portions, day=body.day, meal=body.meal,
                               recipe_id=row.id, revision=row.revision)
    action.request_key, action.request_fingerprint = key, stamp
    db.commit()
    return present(db, action)


def undo_recipe(db: Session, action: AgentAction) -> bool:
    lock_meal_inputs(db)
    row = db.get(Recipe, int(action.resource_id))
    if row is None or recipe_snapshot(row) != action.after:
        action.status, action.error = "conflict", "Recipe changed since this action. Inspect its newer version."
    elif action.before is None and any((entry.micros or {}).get("recipe_id") == row.id
                                      for entry in db.scalars(select(NutritionLog))):
        action.status, action.error = "conflict", "Recipe has recorded consumption. Undo its logs first."
    else:
        if action.before is None:
            row.deleted = True
            row.name_key = f"deleted:{row.id}:{uuid4().hex}"
        else:
            duplicate = db.scalar(select(Recipe).where(Recipe.name_key == action.before["name_key"], Recipe.id != row.id))
            if duplicate is not None:
                action.status, action.error = "conflict", "The previous name now belongs to another recipe."
                db.commit()
                return False
            row.name, row.name_key = action.before["name"], action.before["name_key"]
            row.composition = deepcopy(action.before["composition"])
        row.revision = uuid4().hex
        action.status, action.error, action.undone_at = "undone", None, datetime.now(UTC)
        record_action(db, "reversal", row.id, f"Undid {action.summary}", action.after,
                      {"reversal_of": action.id, "restored": action.before})
    db.commit()
    return action.status == "undone"


def reference_catalog(db: Session, query: str = "", source_day: date | None = None) -> list[dict]:
    if source_day is None:
        return [{"recipe_id": row["id"], **row} for row in list_recipes(db, query)]
    matches = db.scalars(select(NutritionLog).where(NutritionLog.day == source_day).order_by(NutritionLog.id))
    return [{"source_log_id": row.id, "source_version": row.version, "day": row.day.isoformat(),
             "name": row.raw_text, "composition": (row.micros or {}).get("composition")}
            for row in matches if foods.normalized_name(query) in foods.normalized_name(row.raw_text)]


def resolve_composition(db: Session, *, recipe_id: int | None = None, source_log_id: int | None = None,
                        expected_revision: str | None = None, expected_source_version: int | None = None) -> tuple[dict, dict]:
    if (recipe_id is None) == (source_log_id is None):
        raise RecipeError("Select exactly one saved recipe or historical meal.")
    if recipe_id is not None:
        row = get_recipe(db, recipe_id)
        if expected_revision != row.revision:
            raise RecipeError("Recipe changed. Select and review its current version.", 409)
        return deepcopy(row.composition), {"recipe_id": row.id, "recipe_revision": row.revision}
    history = db.get(NutritionLog, source_log_id, populate_existing=True)
    if history is None:
        raise RecipeError("Historical meal no longer exists. Select another source.", 404)
    if history.version != expected_source_version:
        raise RecipeError("Historical meal changed. Review it again.", 409)
    composition = (history.micros or {}).get("composition")
    if not composition or (history.micros or {}).get("totals_edited"):
        raise RecipeError("Historical meal has no reliable ingredient composition. Specify foods and quantities.")
    return deepcopy(composition), {"source_log_id": history.id, "source_version": history.version,
                                    "recipe_id": (history.micros or {}).get("recipe_id"),
                                    "recipe_revision": (history.micros or {}).get("recipe_revision")}
