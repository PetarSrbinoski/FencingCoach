"""Coach memory behavior at the public API and provider boundaries."""

from datetime import date

import pytest
from app.core.database import get_db
from app.main import app
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr("app.services.generation.SessionLocal", sessionmaker(bind=db.get_bind()))
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def create(client, content="My gym has no squat rack", request_id="create-1", **extra):
    response = client.post("/coach-memory", json={
        "content": content, "request_id": request_id, **extra,
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_explicit_memory_survives_reads_and_retried_creation(client):
    first = create(client)
    assert first["provenance"] == "explicit"
    assert first["source"]["label"] == "Added by athlete"
    assert first["last_confirmed_at"] is not None
    assert first["created_at"] == first["updated_at"]
    assert first["revision"]
    assert first["active"] is True
    assert create(client)["id"] == first["id"]
    assert client.get("/coach-memory").json()["items"] == [first]
    assert client.get("/agent-actions?kind=memory").json()["total"] == 1
    assert client.post("/coach-memory", json={
        "content": "Different content", "request_id": "create-1",
    }).status_code == 409


def test_edit_confirm_delete_and_guarded_undo(client):
    first = create(client)
    url = f"/coach-memory/{first['id']}"
    edited_response = client.put(url, json={"content": "Only dumbbells at my gym",
        "expected_revision": first["revision"], "request_id": "edit-1"})
    assert edited_response.status_code == 200, edited_response.text
    edited = edited_response.json()
    assert edited["revision"] != first["revision"]
    assert client.put(url, json={"content": "Stale edit", "expected_revision": first["revision"],
                                  "request_id": "stale"}).status_code == 409
    actions = client.get("/agent-actions?kind=memory").json()["items"]
    assert client.post(f"/agent-actions/{actions[-1]['id']}/undo",
                       json={"request_id": "undo-create"}).status_code == 409
    reversed_ = client.post(f"/agent-actions/{actions[0]['id']}/undo", json={"request_id": "undo-edit"})
    assert reversed_.status_code == 200, reversed_.text
    restored = client.get("/coach-memory").json()["items"][0]
    assert restored["content"] == first["content"]
    assert restored["revision"] not in {first["revision"], edited["revision"]}
    confirmed = client.post(url + "/confirm", json={"expected_revision": restored["revision"],
                                                   "request_id": "confirm"}).json()
    assert confirmed["last_confirmed_at"]
    deleted = client.request("DELETE", url, json={"expected_revision": confirmed["revision"],
                                                  "request_id": "delete"})
    assert deleted.status_code == 200, deleted.text
    assert client.get("/coach-memory").json()["items"] == []
    assert create(client)["deleted"] is True  # replay never resurrects a tombstone
    removal = client.get("/agent-actions?kind=memory").json()["items"][0]
    assert client.post(f"/agent-actions/{removal['id']}/undo", json={"request_id": "restore"}).status_code == 200
    assert client.get("/coach-memory").json()["items"][0]["content"] == first["content"]
    # Repeating undo is harmless and cannot reset a subsequent edit.
    assert client.post(f"/agent-actions/{removal['id']}/undo", json={"request_id": "restore"}).status_code == 200
    assert client.get("/agent-actions?kind=reversal").json()["total"] == 2


def chat(client, message="What should I do today?", **extra):
    response = client.post("/chat", json={"message": message, **extra})
    assert response.status_code == 202, response.text
    result = client.get(f"/chat/messages/{response.json()['message_id']}").json()
    assert result["status"] == "done", result
    return response.json(), result


def test_context_filters_memory_at_read_time_and_keeps_profile(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ATHLETE_TIMEZONE", "Europe/Skopje")
    prompts = []

    def provider(messages, info):
        prompts.append(str(messages))
        return ModelResponse(parts=[TextPart("Let's review your current constraints.")])

    monkeypatch.setattr("app.agents.coach.get_active_model", lambda: FunctionModel(provider))
    monkeypatch.setattr("app.services.coach_memory.athlete_today", lambda: date(2026, 10, 4))
    client.put("/profile", json={"weight_kg": 75, "dietary_restrictions": "no peanuts"})
    travel = create(client, "Staying in a hotel without gym equipment", expires_on="2026-10-04")
    chat(client)
    assert travel["content"] in prompts[-1]
    assert "no peanuts" in prompts[-1]
    assert "clarif" in prompts[-1].lower()
    assert "Europe/Skopje" in prompts[-1]
    monkeypatch.setattr("app.services.coach_memory.athlete_today", lambda: date(2026, 10, 5))
    chat(client)
    assert travel["content"] not in prompts[-1]
    entry = client.get("/coach-memory").json()["items"][0]
    assert entry["expired"] is True and entry["active"] is False
    permanent = create(client, "Keep gym sessions under 45 minutes", "permanent")
    assert client.put("/coach-memory/settings", json={"enabled": False}).status_code == 200
    assert client.get("/coach-memory").json()["enabled"] is False
    chat(client)
    assert permanent["content"] not in prompts[-1]
    assert "no peanuts" in prompts[-1]
    client.put("/coach-memory/settings", json={"enabled": True})
    chat(client)
    assert permanent["content"] in prompts[-1]
    client.request("DELETE", f"/coach-memory/{permanent['id']}", json={
        "request_id": "delete-permanent", "expected_revision": permanent["revision"],
    })
    chat(client)
    assert permanent["content"] not in prompts[-1]


def scripted_provider(monkeypatch, calls):
    """Exercise real agent tool execution with only the external model replaced."""
    from pydantic_ai.messages import ToolCallPart

    remaining = iter(calls)
    responses = []

    def provider(messages, info):
        responses.append(str(messages))
        call = next(remaining, None)
        if call is not None:
            return ModelResponse(parts=[ToolCallPart("remember_context", call)])
        return ModelResponse(parts=[TextPart("Review the memory and any clarification needed.")])

    monkeypatch.setattr("app.agents.coach.get_active_model", lambda: FunctionModel(provider))
    return responses


def test_chat_remembers_current_evidence_and_deduplicates_tool_retries(client, monkeypatch):
    tool = {"memory": {"content": "My gym only has dumbbells"}, "provenance": "explicit",
            "evidence": "my gym only has dumbbells"}
    scripted_provider(monkeypatch, [tool, tool])
    accepted, _ = chat(client, "Remember that my gym only has dumbbells")
    items = client.get("/coach-memory").json()["items"]
    assert len(items) == 1
    memory = items[0]
    assert memory["content"] == "My gym only has dumbbells"
    assert memory["provenance"] == "explicit"
    assert memory["last_confirmed_at"]
    assert memory["source"]["conversation_id"] == accepted["conversation_id"]
    assert memory["source"]["excerpt"] == "my gym only has dumbbells"
    conversation = client.get(f"/chat/conversations/{accepted['conversation_id']}").json()
    assert memory["source"]["message_id"] == conversation["messages"][0]["id"]
    receipt = client.get("/agent-actions?kind=memory").json()
    assert receipt["total"] == 1
    assert receipt["items"][0]["conversation_id"] == accepted["conversation_id"]
    assert client.delete(f"/chat/conversations/{accepted['conversation_id']}").status_code == 204
    assert client.get("/coach-memory").json()["items"][0]["source"]["excerpt"] == tool["evidence"]
    assert client.post(f"/agent-actions/{receipt['items'][0]['id']}/undo", json={"request_id": "undo"}).status_code == 200
    assert client.get("/coach-memory").json()["items"] == []


def test_inferences_are_bounded_unconfirmed_and_cannot_replace_confirmed_facts(client, monkeypatch):
    tool = {"memory": {"content": "Prefers rice for lunch"}, "provenance": "inferred",
            "evidence": "I usually eat rice for lunch"}
    scripted_provider(monkeypatch, [tool])
    chat(client, "I usually eat rice for lunch")
    inferred = client.get("/coach-memory").json()["items"][0]
    assert inferred["last_confirmed_at"] is None
    assert inferred["provenance"] == "inferred"
    confirmed = client.post(f"/coach-memory/{inferred['id']}/confirm", json={
        "expected_revision": inferred["revision"], "request_id": "confirm-inference",
    }).json()
    assert confirmed["last_confirmed_at"] is not None
    assert confirmed["source"] == inferred["source"]
    assert confirmed["provenance"] == "inferred"
    revised = {**tool, "memory": {"content": "Prefers pasta for lunch"},
               "evidence": "I usually eat pasta for lunch", "memory_id": inferred["id"],
               "expected_revision": confirmed["revision"]}
    responses = scripted_provider(monkeypatch, [revised])
    chat(client, "I usually eat pasta for lunch")
    assert client.get("/coach-memory").json()["items"][0]["content"] == inferred["content"]
    assert "clarif" in responses[-1].lower()
    # Explicit correction uses the same service and keeps original source/provenance inspectable.
    revised["provenance"] = "explicit"
    scripted_provider(monkeypatch, [revised])
    chat(client, "Remember this correction: I usually eat pasta for lunch")
    corrected = client.get("/coach-memory").json()["items"][0]
    assert corrected["content"] == "Prefers pasta for lunch"
    assert corrected["source"]["excerpt"] == inferred["source"]["excerpt"]
    assert corrected["source"]["last_update"]["excerpt"] == revised["evidence"]


@pytest.mark.parametrize("message", [
    "I ate rice today", "Maybe I prefer rice", "I usually have knee pain", "I always take aspirin",
])
def test_transient_uncertain_and_health_inferences_require_clarification(client, monkeypatch, message):
    responses = scripted_provider(monkeypatch, [{
        "memory": {"content": message}, "provenance": "inferred", "evidence": message,
    }])
    chat(client, message)
    assert client.get("/coach-memory").json()["items"] == []
    assert "clarif" in responses[-1].lower()


def test_chat_disable_history_replay_and_temporary_expiration(client, monkeypatch):
    monkeypatch.setattr("app.services.coach_memory.athlete_today", lambda: date(2026, 10, 1))
    tool = {"memory": {"content": "Traveling without gym access", "expires_on": "2026-10-04"},
            "provenance": "explicit", "evidence": "traveling until Sunday"}
    client.put("/coach-memory/settings", json={"enabled": False})
    scripted_provider(monkeypatch, [tool])
    chat(client, "Remember I am traveling until Sunday")
    assert client.get("/coach-memory").json()["items"] == []
    client.put("/coach-memory/settings", json={"enabled": True})
    scripted_provider(monkeypatch, [tool])
    accepted, _ = chat(client, "Remember I am traveling until Sunday")
    memory = client.get("/coach-memory").json()["items"][0]
    assert memory["expires_on"] == "2026-10-04"
    client.request("DELETE", f"/coach-memory/{memory['id']}", json={
        "expected_revision": memory["revision"], "request_id": "delete-travel",
    })
    scripted_provider(monkeypatch, [tool])
    chat(client, "Review my training", conversation_id=accepted["conversation_id"])
    assert client.get("/coach-memory").json()["items"] == []
    assert client.get("/agent-actions?kind=memory").json()["total"] == 2


@pytest.mark.parametrize(("message", "expires_on"), [
    ("Remember I am traveling until Sunday", None),
    ("Remember I am traveling until Sunday", "2026-10-05"),
    ("Remember I am traveling for a while", "2026-10-04"),
])
def test_chat_ambiguous_or_inconsistent_expiration_needs_clarification(client, monkeypatch, message, expires_on):
    monkeypatch.setattr("app.services.coach_memory.athlete_today", lambda: date(2026, 10, 1))
    responses = scripted_provider(monkeypatch, [{
        "memory": {"content": "Traveling without equipment", "expires_on": expires_on},
        "provenance": "explicit", "evidence": message,
    }])
    chat(client, message)
    assert client.get("/coach-memory").json()["items"] == []
    assert "clarif" in responses[-1].lower()


@pytest.mark.parametrize("evidence", [
    "I usually eat peanuts for lunch", "I prefer peanuts without salt for lunch",
    "I prefer peanuts and no salt for lunch",
])
def test_chat_food_preference_cannot_override_profile_restriction(client, monkeypatch, evidence):
    client.put("/profile", json={"dietary_restrictions": "no peanuts"})
    responses = scripted_provider(monkeypatch, [{
        "memory": {"content": evidence}, "provenance": "inferred",
        "evidence": evidence,
    }])
    chat(client, evidence)
    assert client.get("/coach-memory").json()["items"] == []
    assert "clarif" in responses[-1].lower()
    assert client.get("/profile").json()["dietary_restrictions"] == "no peanuts"


def test_corrected_memory_is_used_by_chat_and_dated_meal_planning(client, monkeypatch):
    from pydantic_ai.messages import ToolCallPart

    monkeypatch.setattr("app.services.coach_memory.athlete_today", lambda: date(2026, 10, 1))
    client.put("/profile", json={"weight_kg": 75, "dietary_restrictions": "no peanuts"})
    memory = create(client, "Prefer cold lunches", expires_on="2026-10-04")
    client.put(f"/coach-memory/{memory['id']}", json={"content": "Prefer warm lunches",
        "expires_on": "2026-10-04", "request_id": "edit-context", "expected_revision": memory["revision"]})
    prompts = []

    def provider(messages, info):
        prompts.append(str(messages))
        if info.output_tools:
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
                "meals": [{"slot": "lunch", "name": "Rice bowl", "time": "12:00",
                           "ingredients": [{"name": "rice", "qty_g": 100}]}],
            })])
        return ModelResponse(parts=[TextPart("Review current context.")])

    monkeypatch.setattr("app.agents.coach.get_active_model", lambda: FunctionModel(provider))
    monkeypatch.setattr("app.agents.mealplan.get_active_model", lambda: FunctionModel(provider))
    chat(client)
    assert "Prefer warm lunches" in prompts[-1]
    assert "Prefer cold lunches" not in prompts[-1]
    assert client.post("/mealplan/2026-10-04").status_code == 200
    assert "Prefer warm lunches" in prompts[-1]
    assert "no peanuts" in prompts[-1]
    assert client.post("/mealplan/2026-10-05").status_code == 200
    assert "Prefer warm lunches" not in prompts[-1]


@pytest.mark.parametrize("body", [
    {"content": "", "request_id": "empty"},
    {"content": " " * 5, "request_id": "blank"},
    {"content": "x" * 1001, "request_id": "long"},
    {"content": "Valid", "request_id": "invalid-date", "expires_on": "Sunday"},
    {"content": "Valid", "request_id": "fake-provenance", "provenance": "inferred"},
])
def test_invalid_manual_memories_do_not_create_records_or_receipts(client, body):
    assert client.post("/coach-memory", json=body).status_code == 422
    assert client.get("/coach-memory").json()["items"] == []
    assert client.get("/agent-actions?kind=memory").json()["total"] == 0


@pytest.mark.parametrize(("message", "evidence", "content", "provenance"), [
    ("Remember my gym has no squat rack. What workout should I do today?",
     "my gym has no squat rack", "My gym has no squat rack", "explicit"),
    ("Remember my gym has no squat rack. What workout should I do today?",
     "my gym has no squat rack.", "My gym has no squat rack", "explicit"),
    ("I dislike peanuts at lunch", "I dislike peanuts at lunch", "Dislikes peanuts at lunch", "inferred"),
    ("Remember I avoid peanuts", "I avoid peanuts", "Avoid peanuts", "explicit"),
    ("I usually eat rice for lunch. What should I eat today?", "I usually eat rice for lunch",
     "Prefers rice for lunch", "inferred"),
])
def test_memory_eligibility_uses_relevant_evidence_and_respects_avoidance(client, monkeypatch, message, evidence, content, provenance):
    client.put("/profile", json={"dietary_restrictions": "no peanuts"})
    scripted_provider(monkeypatch, [{
        "memory": {"content": content}, "evidence": evidence, "provenance": provenance,
    }])
    chat(client, message)
    items = client.get("/coach-memory").json()["items"]
    assert len(items) == 1
    assert items[0]["content"] == content
    assert items[0]["expires_on"] is None
