"""Personal foods: supplied values per 100 g, with explicit nutrient units."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Amount = Annotated[float, Field(ge=0, allow_inf_nan=False)]
PositiveAmount = Annotated[float, Field(gt=0, allow_inf_nan=False)]


class FoodNutrient(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    amount: Amount
    unit: Literal["g", "mg", "mcg", "IU"]


class SavedFoodInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    kcal: Amount | None = None
    protein_g: Amount | None = None
    carbs_g: Amount | None = None
    fat_g: Amount | None = None
    fiber_g: Amount | None = None
    micros: list[FoodNutrient] = Field(default_factory=list)
    serving_name: str | None = Field(default=None, min_length=1, max_length=80)
    serving_size_g: PositiveAmount | None = None

    @model_validator(mode="after")
    def serving_has_weight(self) -> SavedFoodInput:
        if self.serving_name and self.serving_size_g is None:
            raise ValueError("A named serving needs its weight in grams.")
        return self


class SavedFoodOut(SavedFoodInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class FoodPortion(BaseModel):
    food_id: int = Field(gt=0)
    grams: PositiveAmount | None = None
    servings: PositiveAmount | None = None

    @model_validator(mode="after")
    def one_quantity(self) -> FoodPortion:
        if (self.grams is None) == (self.servings is None):
            raise ValueError("Specify either grams or a number of saved servings.")
        return self


class SavedFoodLogInput(BaseModel):
    portions: list[FoodPortion] = Field(min_length=1)
    day: date | None = None
    meal: str | None = Field(default=None, max_length=40)
