"""Food library invariants through real API writes, chat tools and estimation."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest
from app.agents.coach import log_saved_foods, save_personal_food
from app.agents.deps import CoachDeps
from app.agents.nutrition import (
    MealSelection,
    NutritionEstimateOutput,
    NutritionMicros,
    SelectedFood,
    estimate_nutrition,
)
from app.core.clock import athlete_today
from app.core.database import get_db
from app.main import app
from app.models import NutritionLog, SavedFood
from app.schemas.foods import FoodPortion, SavedFoodInput
from fastapi.testclient import TestClient
from pydantic_ai import RunContext
from pydantic_ai.exceptions import ModelRetry
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr("app.services.generation.SessionLocal", sessionmaker(bind=db.get_bind()))
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def yogurt(**overrides):
    return {
        "name": "My yogurt",
        "kcal": 62.3,
        "protein_g": 5.12,
        "carbs_g": 4.1,
        "fat_g": 2.03,
        "micros": [{"name": "Calcium", "amount": 0.125, "unit": "g"}],
        "serving_name": "1 pot",
        "serving_size_g": 150,
        **overrides,
    }


def test_library_creation_is_not_consumption_and_search_is_case_insensitive(client, db):
    response = client.post("/nutrition/foods", json=yogurt())
    assert response.status_code == 201
    saved = response.json()
    assert saved["protein_g"] == 5.12
    assert saved["micros"] == yogurt()["micros"]  # original supplied units survive
    assert saved["fiber_g"] is None
    assert db.query(NutritionLog).count() == 0
    assert client.get("/nutrition/foods?q=YOGURT").json() == [saved]


def test_portions_use_exact_values_and_history_survives_edit_and_delete(client, db):
    saved = client.post("/nutrition/foods", json=yogurt()).json()
    response = client.post(
        "/nutrition/foods/log",
        json={
            "portions": [{"food_id": saved["id"], "servings": 0.5}],
            "meal": "snack",
        },
    )
    assert response.status_code == 200
    log = response.json()
    assert log["kcal"] == 46.725  # 75 g, no estimator's rounding
    assert log["protein_g"] == 3.84
    assert log["micros"]["calcium_mg"] == 93.75
    assert "iron_mg" not in log["micros"]
    assert log["micros"]["items"][0]["qty_g"] == 75
    assert log["fiber_g"] is None
    assert log["estimated_by"] == "saved"
    assert client.put(f"/nutrition/foods/{saved['id']}", json=yogurt(kcal=100)).status_code == 200
    assert client.delete(f"/nutrition/foods/{saved['id']}").status_code == 204
    db.expire_all()
    row = db.get(NutritionLog, log["id"])
    assert row.kcal == 46.725
    assert row.micros["items"][0]["name"] == "My yogurt"


def test_duplicate_name_requires_explicit_update_or_distinct_variant(client):
    saved = client.post("/nutrition/foods", json=yogurt()).json()
    response = client.post("/nutrition/foods", json=yogurt(name=" MY  YOGURT ", kcal=90))
    assert response.status_code == 409
    assert str(saved["id"]) in response.json()["detail"]
    assert client.get("/nutrition/foods").json()[0]["kcal"] == 62.3
    assert (
        client.post("/nutrition/foods", json=yogurt(name="My yogurt, vanilla")).status_code == 201
    )


def test_incomplete_food_can_be_saved_but_cannot_be_logged(client, db):
    saved = client.post("/nutrition/foods", json={"name": "Unfinished", "protein_g": 20}).json()
    response = client.post(
        "/nutrition/foods/log", json={"portions": [{"food_id": saved["id"], "grams": 100}]}
    )
    assert response.status_code == 422
    assert "kcal" in response.json()["detail"]
    assert db.query(NutritionLog).count() == 0


@pytest.mark.parametrize(
    "values",
    [
        {"kcal": -1},
        {"name": "  "},
        {"serving_size_g": 0},
        {"micros": [{"name": "Iron", "amount": -1, "unit": "mg"}]},
        {"micros": [{"name": "Iron", "amount": 1, "unit": "unknown"}]},
        {
            "micros": [
                {"name": "Iron", "amount": 1, "unit": "mg"},
                {"name": "iron", "amount": 0.001, "unit": "g"},
            ]
        },
    ],
)
def test_bad_nutrients_and_servings_are_rejected(client, values):
    assert client.post("/nutrition/foods", json=yogurt(**values)).status_code == 422


@pytest.mark.parametrize(
    "amount", [{}, {"grams": 0}, {"grams": -10}, {"grams": 100, "servings": 1}]
)
def test_missing_or_ambiguous_portions_never_log(client, db, amount):
    saved = client.post("/nutrition/foods", json=yogurt()).json()
    response = client.post(
        "/nutrition/foods/log", json={"portions": [{"food_id": saved["id"], **amount}]}
    )
    assert response.status_code == 422
    assert db.query(NutritionLog).count() == 0


def test_totals_distinguish_missing_micros_from_known_zero(client):
    first = client.post("/nutrition/foods", json=yogurt()).json()
    second = client.post(
        "/nutrition/foods",
        json=yogurt(
            name="Other",
            micros=[
                {"name": "Iron", "amount": 0, "unit": "mg"},
            ],
        ),
    ).json()
    client.post("/nutrition/foods/log", json={"portions": [{"food_id": first["id"], "grams": 100}]})
    client.post(
        "/nutrition/foods/log", json={"portions": [{"food_id": second["id"], "grams": 100}]}
    )
    total = client.get(f"/nutrition/totals/{athlete_today().isoformat()}").json()
    assert total["micros"] == {"calcium_mg": 125, "iron_mg": 0}
    assert total["incomplete_micros"] == ["calcium_mg", "iron_mg"]


def test_chat_tools_normalize_supplied_label_serving_and_deduplicate_writes(db):
    ctx = cast(RunContext[CoachDeps], SimpleNamespace(deps=CoachDeps(db=db)))
    data = SavedFoodInput(**yogurt())
    # Numbers are supplied for a 50 g label serving, normalized by server code.
    saved = asyncio.run(save_personal_food(ctx, data, values_for_g=50))
    repeated = asyncio.run(save_personal_food(ctx, data, values_for_g=50))
    assert repeated.id == saved.id
    assert saved.kcal == 124.6
    assert ctx.deps.side_effect_committed
    portions = [FoodPortion(food_id=saved.id, grams=50)]
    first = asyncio.run(log_saved_foods(ctx, portions))
    second = asyncio.run(log_saved_foods(ctx, portions))
    assert first == second
    assert first["kcal"] == 62.3
    assert db.query(NutritionLog).count() == 1
    assert db.query(SavedFood).count() == 1


def test_chat_duplicate_requires_choice_and_updates_preserve_unspecified_fields(db):
    ctx = cast(RunContext[CoachDeps], SimpleNamespace(deps=CoachDeps(db=db)))
    first = asyncio.run(save_personal_food(ctx, SavedFoodInput(**yogurt())))
    with pytest.raises(ModelRetry, match="already exists"):
        asyncio.run(save_personal_food(ctx, SavedFoodInput(**yogurt(kcal=90))))
    updated = asyncio.run(
        save_personal_food(ctx, SavedFoodInput(name="My yogurt", kcal=90), first.id)
    )
    assert updated.kcal == 90
    assert updated.protein_g == 5.12
    assert updated.micros == first.micros


def test_mixed_meal_estimates_only_unsaved_foods_and_preserves_missing_coverage(
    client, db, monkeypatch
):
    saved = client.post("/nutrition/foods", json=yogurt()).json()

    async def select(*args, **kwargs):
        return SimpleNamespace(
            output=MealSelection(
                saved=[SelectedFood(food_id=saved["id"], grams=150)],
                other_foods="1 banana",
            )
        )

    async def estimate(text, db=None):
        assert text == "1 banana"
        return NutritionEstimateOutput(
            kcal=100,
            protein_g=1,
            carbs_g=25,
            fat_g=0,
            micros=NutritionMicros(iron_mg=0.5),
            fiber_g=None,
            confidence="medium",
            notes="Estimated banana",
        )

    monkeypatch.setattr("app.agents.nutrition.food_selection_agent.run", select)
    monkeypatch.setattr("app.agents.nutrition._estimate_unlisted", estimate)
    response = client.post("/nutrition/estimate", json={"text": "150 g my yogurt and 1 banana"})
    result = client.get(f"/nutrition/estimate/{response.json()['id']}").json()
    assert result["status"] == "done"
    assert result["kcal"] == 193.45
    assert result["protein_g"] == 8.68
    assert result["estimated_by"] == "mixed"
    assert result["micros"] == {"calcium_mg": 187.5, "iron_mg": 0.5}
    assert result["incomplete_micros"] == ["calcium_mg", "iron_mg"]
    assert [item["source"] for item in result["items"]] == ["saved", "estimated"]
    assert db.query(NutritionLog).count() == 0
    body = {
        key: result[key]
        for key in (
            "kcal",
            "protein_g",
            "carbs_g",
            "fat_g",
            "micros",
            "incomplete_micros",
            "estimated_by",
            "items",
        )
    }
    assert (
        client.post("/nutrition/log", json={"raw_text": "yogurt and banana", **body}).status_code
        == 200
    )
    total = client.get(f"/nutrition/totals/{athlete_today().isoformat()}").json()
    assert total["incomplete_micros"] == ["calcium_mg", "iron_mg"]


def test_saved_only_meal_never_calls_nutrient_estimator(client, db, monkeypatch):
    saved = client.post("/nutrition/foods", json=yogurt()).json()

    async def select(*args, **kwargs):
        return SimpleNamespace(
            output=MealSelection(saved=[SelectedFood(food_id=saved["id"], servings=1)])
        )

    async def fail(*args, **kwargs):
        raise AssertionError("Saved values must not go through nutrient estimation")

    monkeypatch.setattr("app.agents.nutrition.food_selection_agent.run", select)
    monkeypatch.setattr("app.agents.nutrition._estimate_unlisted", fail)
    result = asyncio.run(estimate_nutrition("1 pot my yogurt", db))
    assert result.kcal == 93.45
    assert result.estimated_by == "saved"
    assert result.micros.model_dump(exclude_none=True) == {"calcium_mg": 187.5}


def test_ambiguous_match_surfaces_question_instead_of_estimated_numbers(client, monkeypatch):
    client.post("/nutrition/foods", json=yogurt())

    async def select(*args, **kwargs):
        return SimpleNamespace(output=MealSelection(clarification="How many grams of yogurt?"))

    monkeypatch.setattr("app.agents.nutrition.food_selection_agent.run", select)
    response = client.post("/nutrition/estimate", json={"text": "my yogurt"})
    result = client.get(f"/nutrition/estimate/{response.json()['id']}").json()
    assert result["status"] == "error"
    assert "How many grams" in result["error"]
    assert result["kcal"] is None
