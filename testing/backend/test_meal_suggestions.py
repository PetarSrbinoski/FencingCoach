import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from testing.backend.test_recipes import food, recipe_input


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr("app.services.meal_suggestions.SessionLocal", sessionmaker(bind=db.get_bind()))
    try:
        client = TestClient(app)
        assert client.put("/profile", json={"weight_kg": 70}).status_code == 200
        yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_suggestions_filter_constraints_calculate_and_save_separately(client, monkeypatch):
    rice = food(client, "Rice")
    yogurt = food(client, "Yogurt")
    client.put("/profile", json={"weight_kg": 70, "dietary_restrictions": "no dairy"})
    context_seen = []

    async def generate(context, catalog, recipes):
        context_seen.append(context)
        return {"options": [recipe_input(rice, name="Rice bowl", portions=1, prep_time_min=5,
                                         ingredients=[{"food_id": rice["id"], "qty_g": 150, "basis": "cooked"}]),
                            recipe_input(yogurt, name="Yogurt bowl", portions=1, prep_time_min=5),
                            recipe_input(rice, name="Unknown preparation", prep_time_min=None)]}

    monkeypatch.setattr("app.services.meal_suggestions.generate_options", generate)
    created = client.post("/nutrition/suggestions", json={
        "day": "2026-10-05", "available_foods": ["Rice", "Yogurt"], "prep_limit_min": 10,
    })
    assert created.status_code == 202, created.text
    draft = client.get(f"/nutrition/suggestions/{created.json()['id']}").json()
    assert draft["status"] == "done", draft
    assert len(draft["payload"]["options"]) == 1
    assert draft["payload"]["options"][0]["recipe"]["totals"]["kcal"] == 300
    assert draft["payload"]["context"]["diary_complete"] is None
    assert "recorded" in draft["payload"]["explanation"].lower()
    assert draft["payload"]["warnings"]
    assert context_seen[0]["restrictions"] == "no dairy"
    assert client.get("/nutrition/log?days=90").json() == []
    assert client.get("/nutrition/recipes").json() == []
    body = {"expected_revision": draft["revision"], "request_id": "save-bowl", "option_index": 0,
            "action": "save_recipe"}
    saved = client.post(f"/nutrition/suggestions/{draft['id']}/accept", json=body)
    assert saved.status_code == 200, saved.text
    assert client.get("/nutrition/log?days=90").json() == []
    assert client.post(f"/nutrition/suggestions/{draft['id']}/accept", json=body).json()["id"] == saved.json()["id"]
    logged = client.post(f"/nutrition/suggestions/{draft['id']}/accept", json={
        **body, "action": "log_consumption", "request_id": "ate-bowl", "meal": "lunch", "portions": 0.5,
    })
    assert logged.status_code == 200, logged.text
    assert logged.json()["after"]["kcal"] == 150


def test_changed_intake_requires_refreshed_review_and_changed_food_stays_stale(client, monkeypatch):
    rice = food(client)

    async def generate(*args):
        return {"options": [recipe_input(rice, name="Rice snack", portions=1, prep_time_min=5)]}

    monkeypatch.setattr("app.services.meal_suggestions.generate_options", generate)
    started = client.post("/nutrition/suggestions", json={"day": "2026-10-05", "available_foods": ["Rice"],
        "prep_limit_min": 10, "diary_complete": True}).json()
    draft = client.get(f"/nutrition/suggestions/{started['id']}").json()
    assert draft["status"] == "done", draft
    client.post("/nutrition/foods/log", json={"day": "2026-10-05", "meal": "breakfast",
        "portions": [{"food_id": rice["id"], "grams": 100}]})
    body = {"expected_revision": draft["revision"], "option_index": 0, "action": "log_consumption",
            "meal": "lunch", "request_id": "after-breakfast"}
    assert client.post(f"/nutrition/suggestions/{draft['id']}/accept", json=body).status_code == 409
    fresh = client.post(f"/nutrition/suggestions/{draft['id']}/refresh", json={"expected_revision": draft["revision"]}).json()
    assert fresh["payload"]["context"]["recorded_intake"]["kcal"] == 200
    assert fresh["payload"]["options"][0]["recipe"] == draft["payload"]["options"][0]["recipe"]
    assert client.post(f"/nutrition/suggestions/{draft['id']}/accept", json={**body, "expected_revision": fresh["revision"]}).status_code == 200
    client.put(f"/nutrition/foods/{rice['id']}", json={"name": "Rice", "kcal": 500})
    fresh = client.post(f"/nutrition/suggestions/{draft['id']}/refresh", json={"expected_revision": fresh["revision"]}).json()
    assert client.post(f"/nutrition/suggestions/{draft['id']}/accept", json={**body, "expected_revision": fresh["revision"],
        "action": "save_recipe", "request_id": "stale-food"}).status_code == 409


def test_unknown_restrictions_memory_and_infeasibility_are_visible(client, monkeypatch):
    rice = food(client)
    client.post("/coach-memory", json={"content": "I prefer rice", "request_id": "rice-memory"})
    observed = []

    async def generate(current, *args):
        observed.append(current)
        return {"options": [recipe_input(rice, prep_time_min=30)]}

    monkeypatch.setattr("app.services.meal_suggestions.generate_options", generate)
    inputs = {"day": "2026-10-05", "available_foods": ["Rice"], "prep_limit_min": 10}
    first = client.post("/nutrition/suggestions", json=inputs).json()
    result = client.get(f"/nutrition/suggestions/{first['id']}").json()
    assert result["status"] == "done", result
    assert result["payload"]["options"] == []
    assert "I prefer rice" in observed[-1]["memory"]
    client.put("/coach-memory/settings", json={"enabled": False})
    client.post("/nutrition/suggestions", json=inputs)
    assert "I prefer rice" not in observed[-1]["memory"]
    client.put("/profile", json={"dietary_restrictions": "avoid mystery allergens"})
    failed = client.post("/nutrition/suggestions", json=inputs).json()
    result = client.get(f"/nutrition/suggestions/{failed['id']}").json()
    assert result["status"] == "error"
    assert "Clarify dietary restriction" in result["error"]


def test_adjusted_quantities_keep_estimated_provenance_and_unknowns(client, monkeypatch):
    async def generate(*args):
        return {"options": [{"name": "Estimated beans", "portions": 1, "prep_time_min": 5,
            "ingredients": [{"name": "Beans", "qty_g": 200, "basis": "cooked", "source": "estimated",
                "values": {"name": "Beans", "kcal": 100, "protein_g": 8, "carbs_g": 15, "fat_g": 1}}]}]}

    monkeypatch.setattr("app.services.meal_suggestions.generate_options", generate)
    started = client.post("/nutrition/suggestions", json={"day": "2026-10-05", "available_foods": ["Beans"], "prep_limit_min": 10}).json()
    draft = client.get(f"/nutrition/suggestions/{started['id']}").json()
    assert draft["status"] == "done", draft
    adjusted = client.put(f"/nutrition/suggestions/{draft['id']}/review", json={"expected_revision": draft["revision"],
        "option_index": 0, "recipe": {"name": "Beans snack", "portions": 1, "prep_time_min": 5,
            "ingredients": [{"snapshot_index": 0, "qty_g": 100, "basis": "cooked"}]}})
    assert adjusted.status_code == 200, adjusted.text
    option = adjusted.json()["payload"]["options"][0]
    assert option["recipe"]["totals"]["kcal"] == 100
    assert option["recipe"]["totals"]["fiber_g"] is None
    assert option["fit"]["estimated_ingredients"] == ["Beans"]
