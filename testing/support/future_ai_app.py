"""Isolated browser server with controlled external speech and model responses."""

import json

from app.agents import coach
from app.api import voice
from app.core.clock import athlete_today
from app.services import meal_suggestions, nutrition_workflows
from pydantic_ai.messages import ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from testing.support.serve_app import app as app


def ingredient(food, grams=100):
    return {"food_id": food["id"], "qty_g": grams, "basis": "cooked"}


async def interpret_recipe(text, catalog):
    if text.startswith("FAIL:"):
        raise RuntimeError("Controlled recipe interpretation failure. Try manual composition.")
    rice = next((food for food in catalog if food["name"] == "Rice"), None)
    if rice is None:
        return {"name": "Rice batch", "portions": 4,
                "ingredients": [{"name": "Rice", "qty_g": 1000, "basis": None}]}
    line = ingredient(rice, 1000)
    if "unclear" in text.lower():
        line["basis"] = None
    return {"name": "Imported rice", "portions": 4, "prep_time_min": 5, "ingredients": [line]}


async def options(context, catalog, saved_recipes):
    return {"options": [{"name": f"{food['name']} option {index + 1}", "portions": 1,
                         "prep_time_min": food["prep_time_min"], "ingredients": [ingredient(food, 150)]}
                        for index, food in enumerate(catalog[:3])]}


async def transcribe(audio, filename):
    return audio.decode("utf-8", errors="replace")


async def interpret_voice(transcript, catalog):
    saved = [entry for entry in catalog if entry.get("type") == "recipe"]
    if "usual" in transcript.lower():
        return {"intent": "clarify", "question": "Which known meal do you mean?"}
    if saved:
        recipe = saved[0]
        rice = next((i for i, line in enumerate(recipe["ingredients"]) if "rice" in line["name"].lower()), 0)
        return {"intent": "log_consumption", "recipe": {"recipe_id": recipe["id"],
            "expected_revision": recipe["revision"], "portions": 1},
            "ingredient_changes": [{"ingredient_index": rice, "multiplier": 0.5}]}
    return {"intent": "clarify", "question": "Select a known recipe or describe the ingredients."}


async def chat_stream(messages, info):
    turns = [index for index, message in enumerate(messages)
             if any(isinstance(part, UserPromptPart) for part in message.parts)]
    recent = messages[turns[-1]:] if turns else messages
    prompt = " ".join(str(part.content) for message in recent for part in message.parts if isinstance(part, UserPromptPart))
    if "log" not in prompt.lower():
        yield "Choose a known recipe and tell me the amount you ate."
        return
    if "usual" in prompt.lower():
        yield "Which recipe do you mean? Please select the recipe name."
        return
    returns = [part for message in recent for part in message.parts if isinstance(part, ToolReturnPart)]
    if not returns:
        yield {0: DeltaToolCall(name="search_recipes", json_args=json.dumps({"query": "Rice batch"}))}
    elif returns[-1].tool_name == "search_recipes":
        matches = returns[-1].content
        if not isinstance(matches, list) or len(matches) != 1:
            yield "Which recipe do you mean? Please select the recipe name."
            return
        recipe = matches[0]
        yield {0: DeltaToolCall(name="log_recipe_portion", json_args=json.dumps({
            "recipe_id": recipe["id"], "expected_revision": recipe["revision"], "portions": 0.5,
            "day": athlete_today().isoformat(),
            "meal": "lunch"}))}
    else:
        yield "Logged half a portion of Rice batch for lunch. Inspect Nutrition and Agent logs."


nutrition_workflows.interpret_recipe = interpret_recipe
meal_suggestions.generate_options = options
voice.transcribe_audio = transcribe
voice.interpret_voice = interpret_voice
coach.get_active_model = lambda: FunctionModel(stream_function=chat_stream)
