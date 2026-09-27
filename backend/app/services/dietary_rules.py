"""Bounded ingredient-name checks for explicitly supported dietary exclusions.

These are screening rules, not product allergen or cross-contact guarantees.
Unrecognized free text must be clarified before a compliant plan is accepted.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.mealplan import plan_meals

INGREDIENT_TERMS = {
    "peanut": ("peanut", "groundnut", "satay"),
    "dairy": ("milk", "cheese", "yogurt", "yoghurt", "whey", "butter", "cream", "ghee", "casein"),
    "gluten": ("wheat", "barley", "rye", "spelt", "seitan", "bulgur", "couscous", "bread", "pasta"),
    "egg": ("egg", "mayonnaise"),
    "meat": ("beef", "chicken", "pork", "bacon", "ham", "lamb", "turkey", "fish", "salmon", "tuna", "shrimp", "prawn", "crab", "lobster", "gelatin"),
    "honey": ("honey",),
    "pork": ("pork", "bacon", "ham", "lard", "gelatin"),
    "shellfish": ("shrimp", "prawn", "crab", "lobster", "mussel", "oyster", "scallop"),
}
ALIASES = {
    "no peanuts": ("peanut",), "peanut-free": ("peanut",), "peanut allergy": ("peanut",),
    "dairy-free": ("dairy",), "no dairy": ("dairy",), "lactose intolerant": ("dairy",),
    "gluten-free": ("gluten",), "no gluten": ("gluten",), "celiac": ("gluten",),
    "egg-free": ("egg",), "no eggs": ("egg",),
    "vegetarian": ("meat",),
    "vegan": ("meat", "dairy", "egg", "honey"),
    "no pork": ("pork",), "pork-free": ("pork",),
    "shellfish-free": ("shellfish",), "no shellfish": ("shellfish",), "shellfish allergy": ("shellfish",),
}


def resolved_rules(text: str | None) -> tuple[str, ...]:
    if not text or not text.strip():
        return ()
    rules: set[str] = set()
    for clause in re.split(r"[,;\n]+", text.casefold()):
        phrase = " ".join(clause.split())
        if not phrase:
            continue
        found = ALIASES.get(phrase)
        if found is None:
            raise ValueError(f"Clarify dietary restriction '{phrase}' in Profile using a supported exclusion")
        rules.update(found)
    return tuple(sorted(rules))


def ingredient_conflicts(payload: Any, rules: tuple[str, ...]) -> list[str]:
    if not rules:
        return []
    conflicts: list[str] = []
    for meal in plan_meals(payload):
        ingredients = meal.get("ingredients")
        if not isinstance(ingredients, list) or not ingredients:
            conflicts.append(f"{meal['name']}: ingredients missing")
            continue
        for item in ingredients:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                conflicts.append(f"{meal['name']}: ingredient name missing")
                continue
            name = item["name"].casefold()
            for rule in rules:
                if any(re.search(rf"\b{re.escape(term)}\b", name) for term in INGREDIENT_TERMS[rule]):
                    conflicts.append(f"{meal['name']}: {item['name']} conflicts with {rule}")
    return conflicts
