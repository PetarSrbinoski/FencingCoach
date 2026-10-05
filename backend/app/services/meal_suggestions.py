"""Read-only meal choices with deterministic nutrition and reviewed acceptance."""

from __future__ import annotations

import asyncio
import json
from datetime import date
from decimal import Decimal
from uuid import uuid4

from pydantic_ai import Agent
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.deps import get_active_model, get_model
from app.core.database import SessionLocal
from app.models import AgentAction, AthleteProfile, NutritionDraft, NutritionLog
from app.schemas.meal_suggestions import SuggestionAccept, SuggestionInput, SuggestionOutput
from app.schemas.recipes import RecipeInput
from app.services import coach_memory, recipes
from app.services.agent_actions import present
from app.services.dietary_rules import ingredient_conflicts, resolved_rules
from app.services.nutrition_workflows import food_catalog
from app.services.targets import resolve_effective_targets
from app.services.transactions import lock_meal_inputs, lock_nutrition_inputs

suggestion_agent = Agent(
    get_model(), output_type=SuggestionOutput,
    instructions="""Propose 2–3 distinct practical meals using the supplied context.
Respect hard Profile restrictions, exact available foods and preparation limit. Unknown
preparation time is not zero. Do not invent replacement targets or interpret missing diary
entries as a true deficit. Include concrete gram quantities and raw/cooked/as_sold basis.
Use saved foods first with food_id. Never fill unknown saved nutrients with estimates.
Unmatched ingredients may have explicitly identified estimated per-100g values. A saved
recipe may use recipe_id, expected_recipe_revision and snapshot_index for its ingredients.
Current instructions and structured restrictions override tentative memory preferences.
Return no options and a question when constraints or source information need clarification.
Never treat a suggestion as consumption and never provide model-calculated totals.""",
)


def context(db: Session, inputs: SuggestionInput) -> dict:
    profile = db.scalar(select(AthleteProfile).limit(1))
    target = resolve_effective_targets(db, inputs.day).to_dict()
    rows = list(db.scalars(select(NutritionLog).where(NutritionLog.day == inputs.day)))
    intake = {key: float(sum((Decimal(str(getattr(row, key) or 0)) for row in rows), Decimal(0)))
              if all(getattr(row, key) is not None for row in rows) else None for key in recipes.foods.MACROS}
    remaining = {key: max(0, float(Decimal(str(target[key])) - Decimal(str(value))))
                 if value is not None else None for key, value in intake.items()}
    return {**inputs.model_dump(mode="json"), "targets": target, "recorded_intake": intake,
            "remaining": remaining, "entry_count": len(rows),
            "restrictions": profile.dietary_restrictions or "" if profile else "",
            "preferences": profile.food_preferences or "" if profile else "",
            "memory": coach_memory.context_section(db, inputs.day)}


async def generate_options(context: dict, catalog: list[dict], saved_recipes: list[dict]) -> dict:
    result = await suggestion_agent.run(json.dumps({"context": context, "saved_foods": catalog,
                                                    "saved_recipes": saved_recipes}), model=get_active_model())
    return result.output.model_dump()


def validate_option(composition: dict, inputs: SuggestionInput, restrictions: str) -> None:
    if composition["questions"]:
        raise recipes.RecipeError(" ".join(composition["questions"]))
    if composition["prep_time_min"] is None or composition["prep_time_min"] > inputs.prep_limit_min:
        raise recipes.RecipeError("Preparation time is unknown or exceeds your limit.")
    available = {recipes.foods.normalized_name(name) for name in inputs.available_foods if name.strip()}
    if any(recipes.foods.normalized_name(line["name"]) not in available for line in composition["ingredients"]):
        raise recipes.RecipeError("An ingredient is outside the foods you said are available.")
    rules = resolved_rules(restrictions)
    conflicts = ingredient_conflicts({"meals": [{"name": composition["name"],
                                                 "ingredients": composition["ingredients"]}]}, rules)
    if conflicts:
        raise recipes.RecipeError("; ".join(conflicts))


def explain(composition: dict, current: dict) -> dict:
    nutrients = composition["per_portion"]
    after = {key: max(0, current["remaining"][key] - nutrients[key])
             if current["remaining"][key] is not None and nutrients[key] is not None else None
             for key in recipes.foods.MACROS}
    return {"remaining_after_one_portion": after,
            "exceeds_remaining": [key for key in recipes.foods.CORE
                                  if current["remaining"][key] is not None and nutrients[key] is not None
                                  and nutrients[key] > current["remaining"][key]],
            "estimated_ingredients": [line["name"] for line in composition["ingredients"] if line["source"] == "estimated"],
            "explanation": "Calculated against recorded intake and effective targets. " + (
                "You confirmed your diary is complete." if current["diary_complete"] is True else
                "Your diary may be incomplete; these amounts are based only on recorded intake. Have you logged everything you ate?")}


async def process_suggestions(draft_id: int, revision: str) -> None:
    try:
        with SessionLocal() as db:
            row = recipes.get_draft(db, draft_id, "suggestions")
            if row.status != "pending" or row.revision != revision:
                return
            inputs = SuggestionInput.model_validate(row.inputs)
            current, catalog, saved = context(db, inputs), food_catalog(db), recipes.list_recipes(db)
            resolved_rules(current["restrictions"])
        output = SuggestionOutput.model_validate(await generate_options(current, catalog, saved))
        with SessionLocal() as db:
            lock_nutrition_inputs(db)
            lock_meal_inputs(db)
            row = recipes.get_draft(db, draft_id, "suggestions", locked=True)
            if row.status != "pending" or row.revision != revision:
                return
            latest = context(db, inputs)
            options, warnings, signatures = [], [], set()
            for candidate in output.options:
                try:
                    original = recipes.get_recipe(db, candidate.recipe_id) if candidate.recipe_id else None
                    if original and original.revision != candidate.expected_recipe_revision:
                        raise recipes.RecipeError("Recipe changed during generation. Review the current version.")
                    composition, refs = recipes.compose(db, candidate, original)
                    revisions = {str(food["id"]): food["revision"] for food in catalog}
                    if any(revisions.get(key) != value for key, value in refs.items()):
                        raise recipes.RecipeError("Food changed during generation. Request fresh options.")
                    validate_option(composition, inputs, latest["restrictions"])
                    signature = recipes.fingerprint({"ingredients": composition["ingredients"], "portions": composition["portions"]})
                    if signature in signatures:
                        continue
                    signatures.add(signature)
                    options.append({"recipe": composition, "food_revisions": refs,
                                    "recipe_id": candidate.recipe_id,
                                    "recipe_revision": candidate.expected_recipe_revision,
                                    "input": RecipeInput.model_validate(candidate.model_dump(exclude={"recipe_id", "expected_recipe_revision"})).model_dump(mode="json"),
                                    "fit": explain(composition, latest)})
                except (recipes.foods.FoodError, ValueError) as exc:
                    warnings.append(f"{candidate.name}: {exc}")
            if len(options) < 2:
                warnings.append("Fewer than two feasible options. Add available foods or revise your preparation limit.")
            row.payload = {"options": options, "context": latest, "warnings": warnings,
                           "question": output.question,
                           "explanation": "Suggestions use recorded intake; confirm diary completeness before interpreting a shortfall."}
            row.status, row.error = "done", None
            db.commit()
    except (Exception, asyncio.CancelledError) as exc:
        with SessionLocal() as db:
            failed = recipes.get_draft(db, draft_id, "suggestions", locked=True)
            if failed.status == "pending" and failed.revision == revision:
                failed.status, failed.error = "error", str(exc) or "Generation interrupted. Try again."
                db.commit()
        if isinstance(exc, asyncio.CancelledError):
            raise


def start(db: Session, inputs: SuggestionInput) -> NutritionDraft:
    if not all(name.strip() for name in inputs.available_foods):
        raise recipes.RecipeError("Name each available food.")
    row = NutritionDraft(kind="suggestions", status="pending", inputs=inputs.model_dump(mode="json"),
                         revision=uuid4().hex, accepted_actions={})
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def refresh_context(db: Session, row: NutritionDraft) -> None:
    assert row.payload is not None
    inputs = SuggestionInput.model_validate(row.inputs)
    current = context(db, inputs)
    row.payload = {**row.payload, "context": current,
                   "options": [{**option, "fit": explain(option["recipe"], current)}
                               for option in row.payload["options"]]}
    row.revision = uuid4().hex


def accept(db: Session, draft_id: int, body: SuggestionAccept) -> dict:
    lock_nutrition_inputs(db)
    lock_meal_inputs(db)
    row = recipes.get_draft(db, draft_id, "suggestions", locked=True)
    slot = f"{body.option_index}:{body.action}"
    stamp = recipes.fingerprint(body.model_dump(mode="json", exclude={"request_id"}))
    if row.accepted_actions.get(slot):
        previous = db.get(AgentAction, row.accepted_actions[slot])
        assert previous is not None
        if previous.request_fingerprint != stamp:
            raise recipes.RecipeError("This option was already applied with different reviewed inputs.", 409)
        return present(db, previous)
    recipes.check_draft(row, body.expected_revision)
    assert row.payload is not None
    if body.option_index >= len(row.payload["options"]):
        raise recipes.RecipeError("Select an available option.")
    option = row.payload["options"][body.option_index]
    inputs = SuggestionInput.model_validate(row.inputs)
    current = context(db, inputs)
    if current != row.payload["context"]:
        raise recipes.RecipeError("Intake, targets or preferences changed. Refresh the fit explanation and review again.", 409)
    recipes.check_refs(db, option["food_revisions"])
    if option.get("recipe_id"):
        original = recipes.get_recipe(db, option["recipe_id"])
        if original.revision != option["recipe_revision"]:
            raise recipes.RecipeError("Source recipe changed. Request fresh suggestions.", 409)
    validate_option(option["recipe"], inputs, current["restrictions"])
    if body.action == "save_recipe":
        action = recipes.save_composition(db, option["recipe"])
    else:
        if not body.meal:
            raise recipes.RecipeError("Confirm the meal before logging consumption.")
        action = recipes.write_consumption(db, option["recipe"], portions=body.portions,
                                           day=date.fromisoformat(row.inputs["day"]), meal=body.meal)
    action.request_key = f"suggestion:{row.id}:{slot}"
    action.request_fingerprint = stamp
    row.accepted_actions = {**row.accepted_actions, slot: action.id}
    db.commit()
    return present(db, action)
