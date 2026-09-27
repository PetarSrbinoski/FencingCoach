"""Reviewable meal drafts calculated from known per-100 g food records."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AthleteProfile,
    CompetitionMealPlan,
    CompetitionNutritionPlan,
    NutritionTargetAssignment,
    SavedFood,
    USDAFood,
)
from app.services.dietary_rules import ingredient_conflicts, resolved_rules

MACROS = ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")


def _catalog(db: Session, rules: tuple[str, ...], preferences: str, budget: str,
             prep_limit_minutes: int | None) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for saved in db.scalars(select(SavedFood).order_by(SavedFood.id)).all():
        item: dict[str, Any] = {"id": saved.id, "name": saved.name, "source": "saved", "revision": saved.revision,
                "prep_time_min": saved.prep_time_min,
                "nutrients_per_100g": {key: getattr(saved, key) for key in MACROS}}
        catalog.append(item)
    for usda in db.scalars(select(USDAFood).order_by(USDAFood.fdc_id).limit(100)).all():
        nutrients = usda.nutrients or {}
        item = {"id": usda.fdc_id, "name": usda.description, "source": "usda",
                "revision": str(usda.imported_at),
                "prep_time_min": None,
                "nutrients_per_100g": {key: nutrients.get(key) for key in MACROS}}
        catalog.append(item)
    allowed = []
    for item in catalog:
        if prep_limit_minutes is not None and (item["prep_time_min"] is None or item["prep_time_min"] > prep_limit_minutes):
            continue
        if any(item["nutrients_per_100g"][key] is None for key in MACROS[:4]):
            continue
        try:
            values = [float(item["nutrients_per_100g"][key]) for key in MACROS[:4]]
        except (TypeError, ValueError):
            continue
        if any(not 0 <= value < 100_000 for value in values):
            continue
        if ingredient_conflicts({"meals": [{"name": item["name"], "ingredients": [{"name": item["name"]}]}]}, rules):
            continue
        allowed.append(item)
    choices: list[tuple[str, int]] = []
    for part in re.split(r"[,;\n]", preferences.casefold()):
        part = part.strip()
        negative = re.match(r"^(?:i\s+)?(?:dislike|avoid|hate|no|don't like|do not like)\s+", part)
        positive = re.match(r"^(?:i\s+)?(?:prefer|like|love)\s+", part)
        prefix = negative or positive
        word = part[prefix.end():] if prefix is not None else part
        if word:
            choices.append((word, -1 if negative else 1))
    for item in allowed:
        item["preference_score"] = sum(score for word, score in choices if word in item["name"].casefold())
        # A transparent staple-food heuristic shapes low-budget choices; it does not assert prices.
        item["budget_score"] = int(budget.casefold() == "low" and bool(re.search(
            r"\b(rice|oats?|beans?|lentils?|potatoes?|eggs?|banana|yogurt|pasta|bread|milk)\b",
            item["name"], re.IGNORECASE)))
    allowed.sort(key=lambda item: (item["name"].casefold(), item["source"], item["id"]))
    return allowed


def _pick(catalog: list[dict[str, Any]], key: str, *, exclude: int | None = None) -> dict[str, Any]:
    candidates = [item for item in catalog if item["id"] != exclude] or catalog
    candidates = [item for item in candidates if float(item["nutrients_per_100g"][key]) > 0] or candidates
    return max(candidates, key=lambda item: (
        item["preference_score"], item["budget_score"],
        item["source"] == "saved",
        float(item["nutrients_per_100g"][key]) / max(1, float(item["nutrients_per_100g"]["kcal"])),
    ))


def _ingredient(item: dict[str, Any], grams: float) -> dict[str, Any]:
    per_100 = item["nutrients_per_100g"]
    return {"name": item["name"], "qty_g": grams, "source": item["source"],
            "source_id": item["id"], "source_revision": item["revision"],
            "nutrients_per_100g": per_100,
            "nutrients": {key: round(float(value) * grams / 100, 1) if value is not None else None
                          for key, value in per_100.items()}}


def _totals(ingredients: list[dict[str, Any]]) -> dict[str, float | None]:
    return {key: round(sum(float(item["nutrients"][key]) for item in ingredients), 1)
            if all(item["nutrients"][key] is not None for item in ingredients) else None
            for key in MACROS}


def _meal(slot: str, time: str | None, target: dict[str, Any], catalog: list[dict[str, Any]],
          share: float, *, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    old_first = None
    if previous and previous.get("ingredients"):
        old_first = previous["ingredients"][0].get("source_id")
    carb = _pick(catalog, "carbs_g", exclude=old_first)
    protein = _pick(catalog, "protein_g", exclude=carb["id"])
    desired_carbs = float(target["carbs_g"]) * share
    desired_protein = float(target["protein_g"]) * share
    carb_g = round(max(30, min(500, desired_carbs / max(1, float(carb["nutrients_per_100g"]["carbs_g"])) * 100)) / 5) * 5
    protein_g = round(max(30, min(350, desired_protein / max(1, float(protein["nutrients_per_100g"]["protein_g"])) * 100)) / 5) * 5
    ingredients = [_ingredient(carb, carb_g), _ingredient(protein, protein_g)]
    # If there is only one eligible food, count it once rather than duplicate it.
    if carb["id"] == protein["id"] and carb["source"] == protein["source"]:
        ingredients = [_ingredient(carb, round(carb_g + protein_g, 1))]
    return {"slot": slot, "time": time, "name": " and ".join(item["name"] for item in ingredients),
            "ingredients": ingredients, "totals": _totals(ingredients),
            "notes": ("Use a familiar, tolerated option around exercise. Timing and fibre tolerance are personal."
                      if slot in {"before_event", "event_break"} else "Portions are a calculated starting point; review appetite and logistics.")}


def _slots(context: str, start_time: str | None, break_times: list[str]) -> list[tuple[str, str | None, float]]:
    if context == "event":
        before = (datetime.strptime(start_time, "%H:%M") - timedelta(hours=2)).strftime("%H:%M") if start_time else None
        breaks: list[str | None] = [value for value in break_times] if break_times else [None]
        shares = [0.25, *([0.15 / len(breaks)] * len(breaks)), 0.3, 0.3]
        return [("before_event", before, shares[0]),
                *(("event_break" if index == 0 else f"event_break_{index + 1}", time, shares[index + 1])
                  for index, time in enumerate(breaks)),
                ("after_event", None, shares[-2]), ("dinner", None, shares[-1])]
    return [("breakfast", None, 0.25), ("lunch", None, 0.3),
            ("snack", None, 0.15), ("dinner", None, 0.3)]


def preview_meals(db: Session, plan: CompetitionNutritionPlan, inputs: dict[str, Any]) -> dict[str, Any]:
    start, end = date.fromisoformat(inputs["start"]), date.fromisoformat(inputs["end"])
    if end < start or (end - start).days > 6:
        raise ValueError("Choose 1–7 dates in chronological order")
    if not plan.active:
        raise ValueError("This target plan is inactive; review an active version")
    profile = db.scalar(select(AthleteProfile).limit(1))
    rules = resolved_rules(profile.dietary_restrictions if profile else None)
    catalog = _catalog(db, rules, profile.food_preferences or "" if profile else "",
                       profile.food_budget or "" if profile else "",
                       inputs.get("prep_limit_minutes"))
    if len(catalog) < 2:
        if inputs.get("prep_limit_minutes") is not None:
            raise ValueError("Add at least two allowed foods with known macros and preparation times within your limit in My foods")
        raise ValueError("Add at least two allowed foods with known calories and macros per 100 g to My foods, or clarify dietary restrictions")
    plan_days = {item["day"]: item for item in plan.days}
    current = start
    drafts: list[dict[str, Any]] = []
    old_versions: list[dict[str, Any]] = []
    while current <= end:
        day_key = current.isoformat()
        source = plan_days.get(day_key)
        assignment = db.get(NutritionTargetAssignment, current)
        if source is None or assignment is None or assignment.plan_id != plan.id:
            raise ValueError(f"{day_key} does not currently use this accepted target plan")
        existing = db.scalar(select(CompetitionMealPlan).where(
            CompetitionMealPlan.day == current, CompetitionMealPlan.active.is_(True)))
        old_versions.append({"day": day_key, "id": existing.id if existing else None,
                             "version": existing.version if existing else None})
        replace_slot = inputs.get("replace_slot")
        slots = _slots(source["context"], inputs.get("start_time") or plan.inputs.get("start_time"), inputs.get("break_times") or [])
        if replace_slot:
            if existing is None:
                raise ValueError(f"No accepted meals exist on {day_key}; generate the date first")
            if replace_slot not in {meal["slot"] for meal in existing.meals}:
                raise ValueError(f"Meal slot {replace_slot} is not present on {day_key}")
            if {slot for slot, _, _ in slots} != {meal["slot"] for meal in existing.meals}:
                raise ValueError("Break layout changed; regenerate the whole date to review all affected meals")
        meals = []
        for slot, time, share in slots:
            previous = next((meal for meal in existing.meals if meal["slot"] == slot), None) if existing else None
            if replace_slot and slot != replace_slot:
                assert previous is not None
                meals.append(previous)
            else:
                meals.append(_meal(slot, time, source, catalog, share, previous=previous if replace_slot else None))
        daily = {key: round(sum(float(meal["totals"][key]) for meal in meals), 1)
                 if all(meal["totals"][key] is not None for meal in meals) else None for key in MACROS}
        deviations = {key: round(float(value) - float(source[key]), 1) if value is not None else None
                      for key in MACROS[:4] for value in [daily[key]]}
        warnings = [f"{key} differs from the accepted target by {deviations[key]:+g} {'kcal' if key == 'kcal' else 'g'}"
                    for key in MACROS[:4] if abs(deviations[key] or 0) > max(5, float(source[key]) * 0.1)]
        if source["context"] == "event" and not (inputs.get("start_time") or plan.inputs.get("start_time")):
            warnings.append("Event start time is unknown; meal slots need timing review")
        if source["context"] == "event" and not inputs.get("break_times"):
            warnings.append("Break opportunity is unconfirmed; review the event-break slot")
        if daily["fiber_g"] is None:
            warnings.append("Fibre is unknown for at least one ingredient")
        if profile and profile.food_budget:
            warnings.append(f"Food budget is {profile.food_budget}; prices are unavailable, so check affordability before accepting")
            if profile.food_budget.casefold() == "low":
                warnings.append("Low budget prioritizes familiar staple foods; actual prices are unverified")
        if profile and profile.food_preferences:
            warnings.append(f"Soft preferences used for meal selection: {profile.food_preferences}")
        warnings.append("Ingredient-name screening cannot verify packaged allergens or cross-contact")
        drafts.append({"day": day_key, "context": source["context"], "target_plan_id": plan.id,
                       "target_version": plan.version,
                       "target": {key: source[key] for key in MACROS},
                       "meals": meals, "totals": daily, "deviations": deviations,
                       "warnings": warnings, "replaces_meal_plan_id": existing.id if existing else None})
        current += timedelta(days=1)
    payload = {"plan_id": plan.id, "plan_version": plan.version, "inputs": inputs,
               "profile_snapshot": {"restrictions": profile.dietary_restrictions if profile else None,
                                    "preferences": profile.food_preferences if profile else None,
                                    "budget": profile.food_budget if profile else None,
                                    "updated_at": profile.updated_at.isoformat() if profile and profile.updated_at else None},
               "catalog": catalog, "old_versions": old_versions, "days": drafts}
    token = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return {"plan_id": plan.id, "plan_version": plan.version, "inputs": inputs,
            "days": drafts, "token": token}


def stage_accepted_meals(db: Session, plan: CompetitionNutritionPlan, draft: dict[str, Any],
                         acceptance_id: str) -> list[CompetitionMealPlan]:
    """Stage immutable dated menus and supersede existing menus; caller commits."""
    saved = []
    for day in draft["days"]:
        parsed_day = date.fromisoformat(day["day"])
        old = db.scalars(select(CompetitionMealPlan).where(
            CompetitionMealPlan.day == parsed_day, CompetitionMealPlan.active.is_(True)).with_for_update()).all()
        version = (db.scalar(select(func.max(CompetitionMealPlan.version)).where(
            CompetitionMealPlan.day == parsed_day)) or 0) + 1
        for row in old:
            row.active = False
        row = CompetitionMealPlan(day=parsed_day, target_plan_id=plan.id,
                                  target_version=plan.version, version=version,
                                  meals=day["meals"], totals=day["totals"], warnings=day["warnings"],
                                  inputs=draft["inputs"], preview_token=draft["token"],
                                  acceptance_id=acceptance_id, active=True)
        db.add(row)
        saved.append(row)
    db.flush()
    return saved
