"""Public recipe composition and review contracts; amounts always have a basis."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.foods import PositiveAmount, SavedFoodInput


class IngredientInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    food_id: int | None = Field(default=None, gt=0)
    qty_g: PositiveAmount | None = None
    basis: Literal["raw", "cooked", "as_sold"] | None = None
    source: Literal["saved", "supplied", "estimated"] = "saved"
    values: SavedFoodInput | None = None
    # Existing saved snapshots can be kept by line index, even after source removal.
    snapshot_index: int | None = Field(default=None, ge=0)


class RecipeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    portions: PositiveAmount | None = None
    prepared_weight_g: PositiveAmount | None = None
    prep_time_min: int | None = Field(default=None, ge=0, le=240)
    ingredients: list[IngredientInput] = Field(min_length=1, max_length=100)


class RecipeDraftInput(BaseModel):
    recipe: RecipeInput | None = None
    text: str | None = Field(default=None, min_length=1, max_length=20000)
    recipe_id: int | None = Field(default=None, gt=0)
    expected_recipe_revision: str | None = None

    @model_validator(mode="after")
    def one_input(self):
        if (self.recipe is None) == (self.text is None):
            raise ValueError("Provide a recipe or text description.")
        if self.recipe_id is not None and not self.expected_recipe_revision:
            raise ValueError("Review the current recipe revision before editing.")
        return self


class RevisionInput(BaseModel):
    expected_revision: str


class RecipeReviewInput(RevisionInput):
    recipe: RecipeInput


class RecipeAcceptInput(RevisionInput):
    request_id: str = Field(min_length=1, max_length=100)


class RecipeLogInput(RecipeAcceptInput):
    portions: PositiveAmount | None = None
    grams: PositiveAmount | None = None
    day: date
    meal: str = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def one_amount(self):
        if (self.portions is None) == (self.grams is None):
            raise ValueError("Specify portions or grams.")
        return self


class RecipeReference(BaseModel):
    recipe_id: int | None = Field(default=None, gt=0)
    source_log_id: int | None = Field(default=None, gt=0)
    expected_revision: str | None = None
    expected_source_version: int | None = Field(default=None, ge=1)
    portions: PositiveAmount = 1


class IngredientChange(BaseModel):
    ingredient_index: int = Field(ge=0)
    multiplier: PositiveAmount
