"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Chat ──────────────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str = Field(pattern=r"^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    conversation_id: int | None = None
    message: str
    include_context: bool = True


class ChatResponse(BaseModel):
    conversation_id: int
    reply: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


# ── Health ────────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    db: bool
    llm: bool
    version: str = "0.3.0-phase3"


# ── Garmin ────────────────────────────────────────────────────────────
class GarminLoginRequest(BaseModel):
    email: str | None = None
    password: str | None = None


class GarminSyncResult(BaseModel):
    ok: bool
    fetched: dict[str, Any]
    started_at: datetime
    finished_at: datetime
    error: str | None = None


# ── Readiness ─────────────────────────────────────────────────────────
class ReadinessResponse(BaseModel):
    day: str
    score: float
    band: str
    components: dict[str, dict[str, Any]]
    inputs: dict[str, Any]


# ── Metrics ───────────────────────────────────────────────────────────
class MetricPoint(BaseModel):
    day: Date
    value: float | None = None


class MetricSeries(BaseModel):
    kind: str
    points: list[MetricPoint]


# ── Activities ────────────────────────────────────────────────────────
class ActivityOut(BaseModel):
    id: int
    activity_type: str | None
    name: str | None
    start_time: datetime
    duration_s: int | None
    distance_m: float | None
    calories: int | None
    avg_hr: int | None
    max_hr: int | None
    training_load: float | None


# ── Nutrition ─────────────────────────────────────────────────────────
class NutritionLogCreate(BaseModel):
    text: str
    meal: str | None = None
    day: Date | None = None


class NutritionLogOut(BaseModel):
    id: int
    day: Date
    meal: str | None
    raw_text: str
    kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    fiber_g: float | None
    micros: dict[str, Any] | None
    estimated_by: str | None
    logged_at: datetime


class NutritionDayTotals(BaseModel):
    day: Date
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    micros: dict[str, float]
    entry_count: int


# ── Brief ─────────────────────────────────────────────────────────────
class BriefOut(BaseModel):
    day: Date
    readiness_score: float | None
    summary: str
    payload: dict[str, Any] | None
    generated_at: datetime


# ── Phase / targets / mealplan / training (Phase 3) ───────────────────
class PhaseOut(BaseModel):
    name: str
    days_to_event: int | None
    next_event_id: int | None
    next_event_name: str | None
    next_event_date: Date | None
    notes: str


class TargetsOut(BaseModel):
    day: Date
    day_type: str
    phase: str
    weight_kg: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    micros: dict[str, float]
    notes: str
    override_source: str = "auto"  # "auto" or "manual"


class DayTypeOverrideRequest(BaseModel):
    day_type: str


class MealPlanOut(BaseModel):
    day: Date
    targets: dict[str, Any]
    plan: dict[str, Any]
    generated_at: datetime


class ShoppingList(BaseModel):
    start: Date
    end: Date
    days_covered: list[str]
    missing_days: list[str]
    items: list[dict[str, Any]]
    item_count: int


class ExerciseRxOut(BaseModel):
    exercise: str
    sets: int
    reps: int
    load_kg: float | None
    target_rpe: float
    intent: str
    notes: str


class TrainingSessionOut(BaseModel):
    day: Date
    weekday: str
    session: dict[str, Any] | None
    phase: dict[str, Any]
    readiness: dict[str, Any]
    reason: str | None = None


class WorkoutLogCreate(BaseModel):
    exercise: str
    set_number: int
    reps: int | None = None
    weight_kg: float | None = None
    rpe: float | None = None
    notes: str | None = None
    day: Date | None = None


class WorkoutLogOut(BaseModel):
    id: int
    day: Date
    exercise: str
    set_number: int
    reps: int | None
    weight_kg: float | None
    rpe: float | None
    notes: str | None
    logged_at: datetime


class ExerciseProgress(BaseModel):
    exercise: str
    points: list[dict[str, Any]]
    plateau: dict[str, Any]


# ── Competition (Phase 3) ─────────────────────────────────────────────
class CompetitionCreate(BaseModel):
    name: str
    location: str | None = None
    event_date: Date
    end_date: Date | None = None
    level: str | None = None
    priority: str = "A"
    notes: str | None = None


class CompetitionOut(CompetitionCreate):
    id: int
    result: dict[str, Any] | None = None


# ── Profile ───────────────────────────────────────────────────────────
class ProfileOut(BaseModel):
    id: int
    name: str | None = None
    sport: str = "fencing-epee"
    level: str = "elite"
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    fencing_style: str | None = None
    goals: str | None = None
    weaknesses: str | None = None
    body_comp_goal: str | None = None
    dietary_restrictions: str | None = None
    food_budget: str | None = None
    supplements: str | None = None
    notes: str | None = None


class ProfileUpdate(BaseModel):
    name: str | None = None
    sport: str | None = None
    level: str | None = None
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    fencing_style: str | None = None
    goals: str | None = None
    weaknesses: str | None = None
    body_comp_goal: str | None = None
    dietary_restrictions: str | None = None
    food_budget: str | None = None
    supplements: str | None = None
    notes: str | None = None


# ── Mental Training ───────────────────────────────────────────────────
class MentalEntryCreate(BaseModel):
    entry_type: str = Field(pattern=r"^(check_in|pre_comp|reflection)$")
    mood_score: int | None = Field(None, ge=1, le=10)
    energy_score: int | None = Field(None, ge=1, le=10)
    focus_score: int | None = Field(None, ge=1, le=10)
    confidence_score: int | None = Field(None, ge=1, le=10)
    content: str | None = None
    tags: list[str] | None = None
    day: Date | None = None


class MentalEntryOut(BaseModel):
    id: int
    day: Date
    entry_type: str
    mood_score: int | None
    energy_score: int | None
    focus_score: int | None
    confidence_score: int | None
    content: str | None
    tags: dict[str, Any] | None
    created_at: datetime


class MentalInsightOut(BaseModel):
    period_days: int
    entry_count: int
    avg_mood: float | None
    avg_energy: float | None
    avg_focus: float | None
    avg_confidence: float | None
    trend: str  # improving|stable|declining
    insight: str  # LLM-generated summary


# ── USDA Food ─────────────────────────────────────────────────────────
class USDAFoodOut(BaseModel):
    fdc_id: int
    description: str
    data_type: str | None
    category: str | None
    nutrients: dict[str, Any]
    serving_size_g: float | None


class USDASearchResult(BaseModel):
    query: str
    results: list[USDAFoodOut]
    count: int


class USDAImportResult(BaseModel):
    imported: int
    skipped: int
    errors: int


# ── Data Summary ──────────────────────────────────────────────────────
class DataSummaryOut(BaseModel):
    id: int
    domain: str
    period: str
    period_start: Date
    period_end: Date
    summary: dict[str, Any]
    generated_at: datetime
