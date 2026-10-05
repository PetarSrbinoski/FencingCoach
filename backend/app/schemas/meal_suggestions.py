from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.foods import PositiveAmount
from app.schemas.recipes import RecipeInput, RevisionInput


class SuggestionInput(BaseModel):
    day: date
    available_foods: list[str] = Field(min_length=1, max_length=100)
    prep_limit_min: int = Field(ge=0, le=240)
    diary_complete: bool | None = None


class SuggestedRecipe(RecipeInput):
    recipe_id: int | None = Field(default=None, gt=0)
    expected_recipe_revision: str | None = None


class SuggestionOutput(BaseModel):
    options: list[SuggestedRecipe] = Field(default_factory=list, max_length=3)
    question: str | None = None


class SuggestionReview(RevisionInput):
    option_index: int = Field(ge=0)
    recipe: RecipeInput


class SuggestionAccept(RevisionInput):
    option_index: int = Field(ge=0)
    action: Literal["save_recipe", "log_consumption"]
    request_id: str = Field(min_length=1, max_length=100)
    portions: PositiveAmount = 1
    meal: str | None = Field(default=None, min_length=1, max_length=40)
