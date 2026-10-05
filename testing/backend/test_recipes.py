from __future__ import annotations

import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def food(client, name="Rice", **values):
    return client.post("/nutrition/foods", json={
        "name": name, "kcal": 200, "protein_g": 10, "carbs_g": 30,
        "fat_g": 4, "prep_time_min": 5, **values,
    }).json()


def recipe_input(saved, **changes):
    return {"name": "Rice batch", "portions": 4, "ingredients": [
        {"food_id": saved["id"], "qty_g": 1000, "basis": "cooked"},
    ], **changes}


def review(client, recipe, **changes):
    response = client.post("/nutrition/recipes/drafts", json={"recipe": recipe, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def accept(client, draft, **changes):
    return client.post(f"/nutrition/recipes/drafts/{draft['id']}/accept", json={
        "expected_revision": draft["revision"], "request_id": f"save-{draft['id']}",
        **changes,
    })


def test_review_save_log_fraction_and_undo(client):
    saved = food(client)
    draft = review(client, recipe_input(saved))
    assert draft["payload"]["recipe"]["totals"]["kcal"] == 2000
    assert draft["payload"]["recipe"]["per_portion"]["kcal"] == 500
    assert draft["payload"]["recipe"]["totals"]["fiber_g"] is None
    assert client.get("/nutrition/recipes").json() == []
    receipt = accept(client, draft).json()
    assert accept(client, draft).json()["id"] == receipt["id"]
    recipes = client.get("/nutrition/recipes").json()
    assert len(recipes) == 1
    recipe = recipes[0]
    assert client.get("/nutrition/log?days=90").json() == []

    body = {"expected_revision": recipe["revision"], "portions": 0.5,
            "day": "2026-10-05", "meal": "lunch", "request_id": "half-portion"}
    response = client.post(f"/nutrition/recipes/{recipe['id']}/log", json=body)
    assert response.status_code == 200, response.text
    logged = response.json()
    assert logged["after"]["kcal"] == 250
    assert logged["after"]["fiber_g"] is None
    assert client.post(f"/nutrition/recipes/{recipe['id']}/log", json=body).json()["id"] == logged["id"]
    assert client.post(f"/agent-actions/{receipt['id']}/undo", json={"request_id": "undo"}).status_code == 409
    assert client.post(f"/agent-actions/{logged['id']}/undo", json={"request_id": "undo-meal"}).status_code == 200
    assert client.get("/nutrition/log?days=90").json() == []


def test_edit_keeps_source_snapshots_and_historical_values(client):
    saved = food(client)
    first = accept(client, review(client, recipe_input(saved))).json()
    recipe = client.get(f"/nutrition/recipes/{first['resource_id']}").json()
    logged = client.post(f"/nutrition/recipes/{recipe['id']}/log", json={
        "expected_revision": recipe["revision"], "portions": 1, "day": "2026-10-05",
        "meal": "lunch", "request_id": "original-portion",
    }).json()
    client.put(f"/nutrition/foods/{saved['id']}", json={key: value for key, value in {**saved, "kcal": 300}.items() if key != "id"})
    client.delete(f"/nutrition/foods/{saved['id']}")
    edit = review(client, recipe_input(saved, portions=2, ingredients=[
        {"snapshot_index": 0, "qty_g": 1000, "basis": "cooked"},
    ]), recipe_id=recipe["id"], expected_recipe_revision=recipe["revision"])
    updated = accept(client, edit)
    assert updated.status_code == 200, updated.text
    current = client.get(f"/nutrition/recipes/{recipe['id']}").json()
    assert current["per_portion"]["kcal"] == 1000
    assert current["revision"] != recipe["revision"]
    assert client.get("/nutrition/log?days=90").json()[0]["kcal"] == 500
    repeat = client.post(f"/nutrition/log/{logged['resource_id']}/repeat", json={
        "day": "2026-10-05", "meal": "dinner", "multiplier": 0.5, "request_id": "repeat-old",
    })
    assert repeat.status_code == 201
    assert repeat.json()["kcal"] == 250
    assert client.post(f"/agent-actions/{first['id']}/undo", json={"request_id": "old"}).status_code == 409
    assert client.post(f"/agent-actions/{updated.json()['id']}/undo", json={"request_id": "edit"}).status_code == 200
    assert client.get(f"/nutrition/recipes/{recipe['id']}").json()["per_portion"]["kcal"] == 500


def test_stale_source_cancel_unknowns_and_invalid_quantities(client):
    saved = food(client)
    draft = review(client, recipe_input(saved))
    client.put(f"/nutrition/foods/{saved['id']}", json={"name": "Rice", "kcal": 250})
    assert accept(client, draft).status_code == 409
    assert client.get("/nutrition/recipes").json() == []
    draft = review(client, recipe_input(saved))
    assert accept(client, draft).status_code == 200
    recipe = client.get("/nutrition/recipes").json()[0]
    assert recipe["totals"]["protein_g"] is None
    assert recipe["loggable"] is False
    assert client.post(f"/nutrition/recipes/{recipe['id']}/log", json={
        "expected_revision": recipe["revision"], "portions": 1, "day": "2026-10-05",
        "meal": "lunch", "request_id": "unknown",
    }).status_code == 422
    assert accept(client, review(client, recipe_input(saved))).status_code == 409
    unresolved = review(client, recipe_input(saved, name="Draft", portions=None))
    assert unresolved["payload"]["recipe"]["questions"]
    assert accept(client, unresolved).status_code == 422
    client.post(f"/nutrition/recipes/drafts/{unresolved['id']}/cancel")
    assert accept(client, unresolved).status_code == 409
    for changes in ({"portions": 0}, {"ingredients": [{"food_id": saved["id"], "qty_g": -1}]}):
        assert client.post("/nutrition/recipes/drafts", json={"recipe": recipe_input(saved, **changes)}).status_code == 422


def test_text_import_is_editable_read_only_and_rejects_stale_acceptance(client, db, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    saved = food(client)
    monkeypatch.setattr("app.services.nutrition_workflows.SessionLocal", sessionmaker(bind=db.get_bind()))

    async def interpret(text, catalog):
        assert text == "Made rice for four"
        assert catalog[0]["id"] == saved["id"]
        return recipe_input(saved, ingredients=[{"food_id": saved["id"], "qty_g": 1000}])

    monkeypatch.setattr("app.services.nutrition_workflows.interpret_recipe", interpret)
    response = client.post("/nutrition/recipes/drafts", json={"text": "Made rice for four"})
    draft = client.get(f"/nutrition/recipes/drafts/{response.json()['id']}").json()
    assert draft["status"] == "done"
    assert draft["payload"]["recipe"]["questions"]
    assert accept(client, draft).status_code == 422
    corrected = client.put(f"/nutrition/recipes/drafts/{draft['id']}/review", json={
        "expected_revision": draft["revision"], "recipe": recipe_input(saved),
    }).json()
    assert accept(client, draft).status_code == 409
    assert accept(client, corrected).status_code == 200
    assert client.get("/nutrition/log?days=90").json() == []


@pytest.mark.parametrize("amount", [{"portions": 0.5}, {"grams": 62.5}])
def test_chat_logs_saved_recipe_once_and_undo_preserves_other_meals(client, db, monkeypatch, amount):
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.function import DeltaToolCall, FunctionModel
    from sqlalchemy.orm import sessionmaker

    saved = food(client)
    receipt = accept(client, review(client, recipe_input(saved, prepared_weight_g=500))).json()
    recipe = client.get(f"/nutrition/recipes/{receipt['resource_id']}").json()
    monkeypatch.setattr("app.services.generation.SessionLocal", sessionmaker(bind=db.get_bind()))
    calls = iter([0, 1, 2])

    def provider(messages, info):
        if next(calls, 3) < 2:
            return ModelResponse(parts=[ToolCallPart("log_recipe_portion", {
                "recipe_id": recipe["id"], "expected_revision": recipe["revision"],
                **amount, "day": "2026-10-05", "meal": "lunch",
            })])
        return ModelResponse(parts=[TextPart("Logged half a portion of Rice batch for lunch.")])

    async def stream(messages, info):
        import json
        response = provider(messages, info)
        part = response.parts[0]
        if isinstance(part, ToolCallPart):
            yield {0: DeltaToolCall(name=part.tool_name, json_args=json.dumps(part.args))}
        else:
            yield part.content

    monkeypatch.setattr("app.agents.coach.get_active_model", lambda: FunctionModel(stream_function=stream))
    started = client.post("/chat", json={"message": "Log half a portion of Rice batch for lunch today"}).json()
    result = client.get(f"/chat/messages/{started['message_id']}").json()
    assert result["status"] == "done", result
    logs = client.get("/nutrition/log?days=90").json()
    assert len(logs) == 1
    assert logs[0]["kcal"] == 250
    actions = client.get("/agent-actions?kind=meal").json()["items"]
    assert len(actions) == 1
    assert actions[0]["conversation_id"] == started["conversation_id"]
    assert client.post(f"/agent-actions/{actions[0]['id']}/undo", json={"request_id": "undo-chat"}).status_code == 200


def test_recipe_preserves_partial_micro_coverage_and_logs_by_known_prepared_weight(client):
    first = food(client, "Rice", micros=[{"name": "Iron", "amount": 0, "unit": "mg"}])
    second = food(client, "Beans", micros=[{"name": "Vitamin D", "amount": 20, "unit": "IU"}])
    draft = review(client, recipe_input(first, prepared_weight_g=500, ingredients=[
        {"food_id": first["id"], "qty_g": 100, "basis": "raw"},
        {"food_id": second["id"], "qty_g": 100, "basis": "raw"},
    ]))
    composition = draft["payload"]["recipe"]
    assert composition["totals"]["iron_mg"] is None
    assert composition["known_subtotals"]["iron_mg"] == 0
    assert composition["totals"]["vitamin_d_iu"] is None
    assert composition["known_subtotals"]["vitamin_d_iu"] == 20
    recipe = accept(client, draft).json()
    current = client.get(f"/nutrition/recipes/{recipe['resource_id']}").json()
    response = client.post(f"/nutrition/recipes/{current['id']}/log", json={
        "expected_revision": current["revision"], "grams": 250, "day": "2026-10-05", "meal": "lunch", "request_id": "grams",
    })
    assert response.status_code == 200, response.text
    assert response.json()["after"]["kcal"] == 200
    assert response.json()["after"]["micros"]["vitamin_d_iu"] == 10
    assert response.json()["after"]["micros"]["incomplete_micros"] == ["iron_mg", "vitamin_d_iu"]


def test_explicit_refresh_requires_review_and_old_undo_cannot_overwrite_later_edit(client):
    product = food(client)
    original_action = accept(client, review(client, recipe_input(product))).json()
    original = client.get(f"/nutrition/recipes/{original_action['resource_id']}").json()
    assert client.put(f"/nutrition/foods/{product['id']}", json={"name": "Rice", "kcal": 300, "protein_g": 10, "carbs_g": 30, "fat_g": 4}).status_code == 200
    assert client.get(f"/nutrition/recipes/{original['id']}").json()["totals"]["kcal"] == 2000
    refreshed = review(client, recipe_input(product), recipe_id=original["id"], expected_recipe_revision=original["revision"])
    assert refreshed["payload"]["recipe"]["totals"]["kcal"] == 3000
    edit_action = accept(client, refreshed).json()
    edited = client.get(f"/nutrition/recipes/{original['id']}").json()
    later = review(client, recipe_input(product, portions=2), recipe_id=edited["id"], expected_recipe_revision=edited["revision"])
    assert accept(client, later).status_code == 200
    assert client.post(f"/agent-actions/{edit_action['id']}/undo", json={"request_id": "old-edit"}).status_code == 409
    assert client.get(f"/nutrition/recipes/{original['id']}").json()["per_portion"]["kcal"] == 1500


def test_undo_creation_releases_the_recipe_name(client):
    saved = food(client)
    first = accept(client, review(client, recipe_input(saved))).json()
    assert client.post(f"/agent-actions/{first['id']}/undo", json={"request_id": "undo-name"}).status_code == 200
    assert client.get("/nutrition/recipes").json() == []
    replacement = accept(client, review(client, recipe_input(saved)))
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["resource_id"] != first["resource_id"]


@pytest.mark.parametrize("case", ["historical", "ambiguous", "unknown", "stale", "grams_unknown"])
def test_chat_recipe_sources_require_reliable_explicit_choices(client, db, monkeypatch, case):
    import json

    from pydantic_ai.messages import RetryPromptPart, ToolReturnPart
    from pydantic_ai.models.function import DeltaToolCall, FunctionModel
    from sqlalchemy.orm import sessionmaker

    saved = food(client, protein_g=None) if case == "unknown" else food(client)
    created = accept(client, review(client, recipe_input(saved))).json()
    recipe = client.get(f"/nutrition/recipes/{created['resource_id']}").json()
    arguments = {"recipe_id": recipe["id"], "expected_revision": recipe["revision"],
                 "portions": 0.5, "day": "2026-10-05", "meal": "lunch"}
    if case == "historical":
        client.post(f"/nutrition/recipes/{recipe['id']}/log", json={"expected_revision": recipe["revision"],
                    "portions": 0.5, "day": "2026-10-04", "meal": "dinner", "request_id": "history"})
        source = client.get("/nutrition/log?day=2026-10-04").json()[0]
        client.put(f"/nutrition/foods/{saved['id']}", json={"name": "Rice", "kcal": 900})
        arguments = {"source_log_id": source["id"], "expected_source_version": source["version"],
                     "portions": 0.5, "day": "2026-10-05", "meal": "lunch"}
    elif case == "ambiguous":
        accept(client, review(client, recipe_input(saved, name="Rice batch two")))
    elif case == "stale":
        edit = client.post("/nutrition/recipes/drafts", json={"recipe_id": recipe["id"],
             "expected_recipe_revision": recipe["revision"], "recipe": recipe_input(saved, portions=3)}).json()
        accept(client, edit)
    elif case == "grams_unknown":
        arguments.pop("portions")
        arguments["grams"] = 100
    observed = []

    async def stream(messages, info):
        returns = [part for message in messages for part in message.parts if isinstance(part, (ToolReturnPart, RetryPromptPart))]
        if not returns:
            if case == "ambiguous":
                yield {0: DeltaToolCall(name="search_recipes", json_args=json.dumps({"query": "Rice batch"}))}
            else:
                yield {0: DeltaToolCall(name="log_recipe_portion", json_args=json.dumps(arguments))}
        else:
            observed.append(str(messages))
            yield "Review the source and clarify its amount before continuing."

    monkeypatch.setattr("app.services.generation.SessionLocal", sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr("app.agents.coach.get_active_model", lambda: FunctionModel(stream_function=stream))
    started = client.post("/chat", json={"message": "Log half of yesterday's dinner" if case == "historical" else "Log my rice lunch"}).json()
    result = client.get(f"/chat/messages/{started['message_id']}").json()
    assert result["status"] == "done", result
    logs = client.get("/nutrition/log?day=2026-10-05").json()
    if case == "historical":
        assert len(logs) == 1 and logs[0]["kcal"] == 125
        action = client.get("/agent-actions?kind=meal").json()["items"][0]
        edited = client.put(f"/nutrition/log/{logs[0]['id']}", json={
            **{key: logs[0][key] for key in ("day", "meal", "raw_text", "protein_g", "carbs_g", "fat_g", "fiber_g")},
            "expected_version": logs[0]["version"], "kcal": 140})
        assert edited.status_code == 200, edited.text
        assert client.post(f"/agent-actions/{action['id']}/undo", json={"request_id": "later-edit"}).status_code == 409
    else:
        assert logs == []
        assert client.get("/agent-actions?kind=meal").json()["total"] == 0
