"""USDA FoodData Central import and cross-reference service.

Fetches common foods from the USDA FoodData Central API, caches them
locally, and provides fuzzy matching for nutrition log cross-referencing.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import USDAFood

log = logging.getLogger(__name__)

USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1"
USDA_API_KEY = settings.USDA_API_KEY

# Common food categories to prioritize during import
COMMON_CATEGORIES = [
    "Dairy and Egg Products",
    "Poultry Products",
    "Beef Products",
    "Pork Products",
    "Finfish and Shellfish Products",
    "Vegetables and Vegetable Products",
    "Fruits and Fruit Juices",
    "Legumes and Legume Products",
    "Nut and Seed Products",
    "Cereal Grains and Pasta",
    "Breakfast Cereals",
    "Baked Products",
    "Fats and Oils",
    "Sweets",
    "Beverages",
]

# Key nutrient IDs from USDA
NUTRIENT_MAP = {
    1008: "kcal",
    1003: "protein_g",
    1005: "carbs_g",
    1004: "fat_g",
    1079: "fiber_g",
    1089: "iron_mg",
    1114: "vitamin_d_iu",
    1178: "b12_mcg",
    1090: "magnesium_mg",
    1095: "zinc_mg",
    1292: "omega3_dha_g",
    1191: "folate_mcg",
    1162: "vitamin_c_mg",
    1087: "calcium_mg",
    1093: "sodium_mg",
    1092: "potassium_mg",
}


def import_common_foods(
    db: Session,
    *,
    api_key: str | None = None,
    page_size: int = 200,
    max_pages: int = 25,
) -> dict[str, int]:
    """Import common foods from USDA FoodData Central.

    Focuses on SR Legacy and Foundation data types which cover
    common grocery items.

    Returns: {"imported": N, "skipped": N, "errors": N}
    """
    key = api_key or USDA_API_KEY
    imported = 0
    skipped = 0
    errors = 0

    for page in range(1, max_pages + 1):
        try:
            data = _fetch_page(key, page, page_size)
        except Exception as e:  # noqa: BLE001
            log.error("USDA API fetch failed page %d: %s", page, e)
            errors += 1
            break

        foods = data.get("foods", [])
        if not foods:
            break

        for food in foods:
            try:
                result = _upsert_food(db, food)
                if result == "imported":
                    imported += 1
                else:
                    skipped += 1
            except Exception as e:  # noqa: BLE001
                log.warning("Failed to import food %s: %s", food.get("fdcId"), e)
                errors += 1

        db.commit()
        log.info("USDA import page %d: %d foods processed", page, len(foods))

        # Stop if we got fewer results than page_size (last page)
        if len(foods) < page_size:
            break

    return {"imported": imported, "skipped": skipped, "errors": errors}


def _fetch_page(api_key: str, page: int, page_size: int) -> dict[str, Any]:
    """Fetch a page of foods from the USDA API."""
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{USDA_API_BASE}/foods/search",
            params={"api_key": api_key},
            json={
                "query": "",
                "dataType": ["SR Legacy", "Foundation"],
                "pageSize": page_size,
                "pageNumber": page,
                "sortBy": "dataType.keyword",
                "sortOrder": "asc",
            },
        )
        resp.raise_for_status()
        return resp.json()


def _upsert_food(db: Session, food_data: dict[str, Any]) -> str:
    """Insert or skip a single USDA food item."""
    fdc_id = food_data.get("fdcId")
    if not fdc_id:
        return "skipped"

    existing = db.get(USDAFood, fdc_id)
    if existing:
        return "skipped"

    description = food_data.get("description", "")
    nutrients = _extract_nutrients(food_data.get("foodNutrients", []))

    food = USDAFood(
        fdc_id=fdc_id,
        description=description,
        description_lower=description.lower(),
        data_type=food_data.get("dataType"),
        category=food_data.get("foodCategory"),
        nutrients=nutrients,
        serving_size_g=food_data.get("servingSize"),
    )
    db.add(food)
    return "imported"


def _extract_nutrients(nutrient_list: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract key nutrients from USDA nutrient array into a flat dict."""
    result: dict[str, Any] = {}
    for n in nutrient_list:
        nutrient_id = n.get("nutrientId")
        if nutrient_id in NUTRIENT_MAP:
            key = NUTRIENT_MAP[nutrient_id]
            result[key] = n.get("value", 0)
    return result


def search_foods(
    db: Session,
    query: str,
    *,
    limit: int = 10,
) -> list[USDAFood]:
    """Search local USDA food cache by description.

    Uses case-insensitive LIKE matching with word boundaries.
    For better results, we split the query into terms and require all
    terms to appear in the description.
    """
    if not query.strip():
        return []

    terms = query.lower().strip().split()
    stmt = select(USDAFood)

    for term in terms:
        stmt = stmt.where(USDAFood.description_lower.contains(term))

    return list(db.scalars(stmt.limit(limit)).all())


def match_food(
    db: Session,
    food_name: str,
) -> USDAFood | None:
    """Find the best USDA match for a food name.

    Returns the closest match or None if nothing reasonable is found.
    """
    results = search_foods(db, food_name, limit=5)
    if not results:
        return None

    # Score by how closely the description matches
    name_lower = food_name.lower().strip()
    best = None
    best_score = -1.0

    for r in results:
        desc = r.description_lower
        # Exact match is best
        if desc == name_lower:
            return r
        # Score by word overlap
        query_words = set(name_lower.split())
        desc_words = set(desc.split(",")[0].split())  # Use first part before comma
        overlap = len(query_words & desc_words)
        score = overlap / max(len(query_words), 1)
        # Penalize very long descriptions (less specific)
        score -= len(desc) * 0.001
        if score > best_score:
            best_score = score
            best = r

    return best if best_score > 0.3 else None


def cross_reference_meal(
    db: Session,
    raw_text: str,
) -> list[dict[str, Any]]:
    """Cross-reference a meal description against USDA data.

    Splits the raw text into likely food items and finds USDA matches.
    Returns a list of matches with USDA nutrient data.
    """
    # Simple heuristic: split on common separators
    separators = [" with ", " and ", ", ", "; ", " + "]
    items = [raw_text]
    for sep in separators:
        new_items = []
        for item in items:
            new_items.extend(item.split(sep))
        items = new_items

    # Clean up items
    items = [i.strip() for i in items if len(i.strip()) > 2]

    matches = []
    for item in items:
        # Strip common quantity prefixes
        cleaned = _strip_quantity(item)
        food = match_food(db, cleaned)
        if food:
            matches.append(
                {
                    "input": item,
                    "matched": food.description,
                    "fdc_id": food.fdc_id,
                    "nutrients_per_100g": food.nutrients,
                    "category": food.category,
                }
            )

    return matches


def _strip_quantity(text: str) -> str:
    """Remove leading quantity expressions like '200g', '1 cup', etc."""
    # Remove patterns like "200g", "1.5 cups", "2 tbsp", "a large"
    cleaned = re.sub(
        r"^\d+\.?\d*\s*(g|kg|oz|ml|l|cups?|tbsp|tsp|pieces?|slices?|servings?|medium|large|small)\s+",
        "",
        text.strip(),
        flags=re.IGNORECASE,
    )
    # Remove leading "a " or "an "
    cleaned = re.sub(r"^(a|an)\s+", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def get_food_count(db: Session) -> int:
    """Return the number of USDA foods in the local cache."""
    from sqlalchemy import func

    return db.scalar(select(func.count(USDAFood.fdc_id))) or 0
