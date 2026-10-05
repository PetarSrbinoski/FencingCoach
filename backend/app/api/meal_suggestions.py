from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Recipe
from app.schemas.meal_suggestions import SuggestionAccept, SuggestionInput, SuggestionReview
from app.schemas.recipes import RevisionInput
from app.services import meal_suggestions, recipes
from app.services.transactions import lock_meal_inputs, lock_nutrition_inputs

router = APIRouter(prefix="/nutrition/suggestions", tags=["nutrition"])


@router.post("", status_code=202)
def suggest(body: SuggestionInput, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        row = meal_suggestions.start(db, body)
        tasks.add_task(meal_suggestions.process_suggestions, row.id, row.revision)
        return recipes.draft_out(row)
    except recipes.RecipeError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get("/{draft_id}")
def get_suggestions(draft_id: int, db: Session = Depends(get_db)):
    try:
        return recipes.draft_out(recipes.get_draft(db, draft_id, "suggestions"))
    except recipes.RecipeError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/{draft_id}/cancel")
def cancel(draft_id: int, db: Session = Depends(get_db)):
    try:
        row = recipes.get_draft(db, draft_id, "suggestions", locked=True)
        row.status, row.revision = "cancelled", uuid4().hex
        db.commit()
        return recipes.draft_out(row)
    except recipes.RecipeError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/{draft_id}/refresh")
def refresh(draft_id: int, body: RevisionInput, db: Session = Depends(get_db)):
    try:
        lock_nutrition_inputs(db)
        lock_meal_inputs(db)
        row = recipes.get_draft(db, draft_id, "suggestions", locked=True)
        recipes.check_draft(row, body.expected_revision)
        meal_suggestions.refresh_context(db, row)
        db.commit()
        return recipes.draft_out(row)
    except recipes.RecipeError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.put("/{draft_id}/review")
def review(draft_id: int, body: SuggestionReview, db: Session = Depends(get_db)):
    try:
        lock_nutrition_inputs(db)
        lock_meal_inputs(db)
        row = recipes.get_draft(db, draft_id, "suggestions", locked=True)
        recipes.check_draft(row, body.expected_revision)
        assert row.payload is not None
        if body.option_index >= len(row.payload["options"]):
            raise recipes.RecipeError("Select an available option.")
        if any(key.startswith(f"{body.option_index}:") for key in row.accepted_actions):
            raise recipes.RecipeError("This option was already applied. Start fresh suggestions to change it.", 409)
        options = list(row.payload["options"])
        original = options[body.option_index]
        snapshot_source = Recipe(composition=original["recipe"])
        composition, refs = recipes.compose(db, body.recipe, snapshot_source)
        refs = {**original["food_revisions"], **refs}
        recipes.check_refs(db, refs)
        inputs = SuggestionInput.model_validate(row.inputs)
        current = meal_suggestions.context(db, inputs)
        meal_suggestions.validate_option(composition, inputs, current["restrictions"])
        options[body.option_index] = {**original, "recipe": composition, "food_revisions": refs,
                                     "input": body.recipe.model_dump(mode="json"),
                                     "fit": meal_suggestions.explain(composition, current)}
        row.payload = {**row.payload, "options": options, "context": current}
        row.revision = uuid4().hex
        db.commit()
        return recipes.draft_out(row)
    except (recipes.foods.FoodError, ValueError) as exc:
        db.rollback()
        raise HTTPException(getattr(exc, "status_code", 422), str(exc)) from exc


@router.post("/{draft_id}/accept")
def accept(draft_id: int, body: SuggestionAccept, db: Session = Depends(get_db)):
    try:
        return meal_suggestions.accept(db, draft_id, body)
    except (recipes.foods.FoodError, ValueError) as exc:
        db.rollback()
        raise HTTPException(getattr(exc, "status_code", 422), str(exc)) from exc
