"""Review recipes before saving; log consumption as a separate operation."""

from datetime import date
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import AgentAction, NutritionDraft
from app.schemas.recipes import (
    RecipeAcceptInput,
    RecipeDraftInput,
    RecipeLogInput,
    RecipeReviewInput,
)
from app.services import recipes
from app.services.agent_actions import present
from app.services.transactions import lock_meal_inputs

router = APIRouter(prefix="/nutrition/recipes", tags=["nutrition"])


def domain_error(exc):
    return HTTPException(getattr(exc, "status_code", 422), str(exc))


@router.get("")
def list_recipes(q: str = Query("", max_length=200), db: Session = Depends(get_db)):
    return recipes.list_recipes(db, q)


@router.get("/references")
def references(day: date, q: str = Query("", max_length=200), db: Session = Depends(get_db)):
    return recipes.reference_catalog(db, q, day)


@router.post("/drafts", status_code=201)
def create_draft(body: RecipeDraftInput, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        lock_meal_inputs(db)
        existing = recipes.get_recipe(db, body.recipe_id) if body.recipe_id else None
        if existing and existing.revision != body.expected_recipe_revision:
            raise recipes.RecipeError("Recipe changed. Open the latest version.", 409)
        row = NutritionDraft(kind="recipe", inputs=body.model_dump(mode="json"),
                             status="pending", revision=uuid4().hex, accepted_actions={})
        if body.recipe:
            composition, refs = recipes.compose(db, body.recipe, existing)
            row.status = "done"
            row.payload = {"recipe": composition, "food_revisions": refs}
        db.add(row)
        db.commit()
        db.refresh(row)
        if body.text:
            from app.services.nutrition_workflows import process_recipe_import
            tasks.add_task(process_recipe_import, row.id, row.revision)
        return recipes.draft_out(row)
    except recipes.foods.FoodError as exc:
        db.rollback()
        raise domain_error(exc) from exc


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: int, db: Session = Depends(get_db)):
    try:
        return recipes.draft_out(recipes.get_draft(db, draft_id, "recipe"))
    except recipes.RecipeError as exc:
        raise domain_error(exc) from exc


@router.put("/drafts/{draft_id}/review")
def review_draft(draft_id: int, body: RecipeReviewInput, db: Session = Depends(get_db)):
    try:
        lock_meal_inputs(db)
        row = recipes.get_draft(db, draft_id, "recipe", locked=True)
        recipes.check_draft(row, body.expected_revision)
        if row.accepted_actions:
            raise recipes.RecipeError("Already saved. Edit the saved recipe instead.", 409)
        existing = recipes.get_recipe(db, row.inputs["recipe_id"]) if row.inputs.get("recipe_id") else None
        if existing and existing.revision != row.inputs["expected_recipe_revision"]:
            raise recipes.RecipeError("Recipe changed. Open its latest version before editing.", 409)
        composition, refs = recipes.compose(db, body.recipe, existing)
        row.payload = {"recipe": composition, "food_revisions": refs}
        row.inputs = {**row.inputs, "recipe": body.recipe.model_dump(mode="json")}
        row.revision = uuid4().hex
        db.commit()
        return recipes.draft_out(row)
    except recipes.foods.FoodError as exc:
        db.rollback()
        raise domain_error(exc) from exc


@router.post("/drafts/{draft_id}/cancel")
def cancel_draft(draft_id: int, db: Session = Depends(get_db)):
    try:
        row = recipes.get_draft(db, draft_id, "recipe", locked=True)
        if row.accepted_actions:
            raise recipes.RecipeError("Already saved. Use Agent logs to undo.", 409)
        row.status, row.revision = "cancelled", uuid4().hex
        db.commit()
        return recipes.draft_out(row)
    except recipes.RecipeError as exc:
        raise domain_error(exc) from exc


@router.post("/drafts/{draft_id}/accept")
def accept_draft(draft_id: int, body: RecipeAcceptInput, db: Session = Depends(get_db)):
    try:
        lock_meal_inputs(db)
        row = recipes.get_draft(db, draft_id, "recipe", locked=True)
        if row.accepted_actions.get("save"):
            previous = db.get(AgentAction, row.accepted_actions["save"])
            assert previous is not None
            return present(db, previous)
        recipes.check_draft(row, body.expected_revision)
        assert row.payload is not None
        recipes.check_refs(db, row.payload["food_revisions"])
        action = recipes.save_composition(db, row.payload["recipe"], recipe_id=row.inputs.get("recipe_id"),
                                          expected_revision=row.inputs.get("expected_recipe_revision"))
        action.request_key = f"recipe-draft:{row.id}"
        row.accepted_actions = {"save": action.id}
        db.commit()
        return present(db, action)
    except recipes.foods.FoodError as exc:
        db.rollback()
        raise domain_error(exc) from exc


@router.get("/{recipe_id}")
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    try:
        return recipes.recipe_out(recipes.get_recipe(db, recipe_id))
    except recipes.RecipeError as exc:
        raise domain_error(exc) from exc


@router.post("/{recipe_id}/log")
def log_recipe(recipe_id: int, body: RecipeLogInput, db: Session = Depends(get_db)):
    try:
        return recipes.log_recipe(db, recipe_id, body)
    except recipes.RecipeError as exc:
        db.rollback()
        raise domain_error(exc) from exc
