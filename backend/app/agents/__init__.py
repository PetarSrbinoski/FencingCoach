"""PydanticAI agents for FencingCoach AI.

Each agent replaces a direct LLM call from the old services layer.
All agents share a common model factory and dependency injection pattern.
"""

from app.agents.deps import CoachDeps, get_model
from app.agents.nutrition import nutrition_agent, estimate_nutrition
from app.agents.mealplan import mealplan_agent, generate_meal_plan
from app.agents.brief import brief_agent, generate_brief
from app.agents.mental import mental_agent, generate_mental_insight
from app.agents.coach import coach_agent, run_coach_chat

__all__ = [
    "CoachDeps",
    "get_model",
    "nutrition_agent",
    "estimate_nutrition",
    "mealplan_agent",
    "generate_meal_plan",
    "brief_agent",
    "generate_brief",
    "mental_agent",
    "generate_mental_insight",
    "coach_agent",
    "run_coach_chat",
]
