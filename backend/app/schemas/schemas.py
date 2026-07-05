"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


# ── Chat ──────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    conversation_id: int | None = None
    message: str
    include_context: bool = True


class ChatAccepted(BaseModel):
    """Returned immediately by `POST /chat` — the reply generates in the
    background (see `app/core/background.py`) and is not in this
    response. Poll `GET /chat/messages/{message_id}` for the result."""

    conversation_id: int
    message_id: int
    status: str = "pending"


class ChatMessageStatus(BaseModel):
    """Poll response for a (typically assistant) chat message."""

    id: int
    status: str = Field(pattern=r"^(pending|done|error)$")
    content: str
    model: str | None = None
    context_snapshot: str | None = None
    ungrounded_claims: list[str] = Field(default_factory=list)
    error: str | None = None


class CoachMessageOut(BaseModel):
    id: int
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str
    created_at: datetime
    status: str = "done"


class CoachConversationSummary(BaseModel):
    id: int
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    message_count: int
    last_message_preview: str | None = None


class CoachConversationOut(BaseModel):
    id: int
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[CoachMessageOut]


# ── Health ────────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    db: bool
    llm: bool
    version: str = "0.4.0-agents"


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
    score: float | None
    band: str
    source: str
    advisories: dict[str, dict[str, Any]]
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


# ── Fencing session analysis ───────────────────────────────────────────
class FencingSessionOut(BaseModel):
    activity_id: int
    day: Date
    duration_min: float | None
    avg_hr: int | None
    max_hr: int | None
    avg_hr_zone: str | None
    max_hr_zone: str | None
    training_load: float | None
    calories: int | None


class FencingAnalysisOut(BaseModel):
    window_days: int
    session_count: int
    max_hr_estimate: float | None
    max_hr_source: str
    sessions: list[FencingSessionOut]
    avg_duration_min: float | None
    avg_training_load: float | None
    weekly_session_counts: dict[str, int]
    training_load_trend: str


# ── Nutrition ─────────────────────────────────────────────────────────
class NutritionEstimateRequest(BaseModel):
    text: str


class NutritionEstimateAccepted(BaseModel):
    """Returned immediately by `POST /nutrition/estimate` — the LLM call
    runs in the background (see `app/core/background.py`). Poll
    `GET /nutrition/estimate/{id}` for the result."""

    id: int
    status: str = "pending"


class NutritionEstimateItemOut(BaseModel):
    name: str
    qty_g: float


class NutritionEstimateOut(BaseModel):
    """Result of `POST /nutrition/estimate`, as of the last poll. Not
    persisted as a logged meal — confirm/edit, then send to
    `POST /nutrition/log` to save."""

    id: int
    status: str = Field(pattern=r"^(pending|done|error)$")
    error: str | None = None
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    fiber_g: float | None = None
    micros: dict[str, float] = Field(default_factory=dict)
    items: list[NutritionEstimateItemOut] = Field(default_factory=list)
    confidence: str | None = None  # "low" | "medium" | "high"
    notes: str = ""


class NutritionLogCreate(BaseModel):
    """Persist a (possibly user-reviewed/edited) nutrition estimate.

    Does not call the LLM — call `POST /nutrition/estimate` first and let
    the athlete confirm/edit the numbers before logging.
    """

    raw_text: str
    meal: str | None = None
    day: Date | None = None
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None = None
    micros: dict[str, Any] | None = None
    items: list[NutritionEstimateItemOut] | None = None
    confidence: str | None = None
    notes: str | None = None
    estimated_by: str = "agent"


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


class LLMProviderOut(BaseModel):
    provider: str  # "local" or "cloud"


class LLMProviderRequest(BaseModel):
    provider: str  # "local" or "cloud"


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


class TrainingSessionOut(BaseModel):
    day: Date
    weekday: str
    session: dict[str, Any] | None
    phase: dict[str, Any]
    readiness: dict[str, Any]
    reason: str | None = None
    source: str = "auto"  # "auto" (computed) or "manual" (overridden)


class ExerciseOverrideIn(BaseModel):
    """One exercise prescription within a manually-set day's workout."""

    exercise: str
    sets: int = Field(ge=1, le=20)
    reps: int = Field(ge=1, le=100)
    load_kg: float | None = Field(default=None, ge=0)
    target_rpe: float = Field(default=8.0, ge=0, le=10)
    intent: str = "strength"  # strength|power|hypertrophy|skill
    notes: str = ""

    @field_validator("intent")
    @classmethod
    def _validate_intent(cls, v: str) -> str:
        allowed = {"strength", "power", "hypertrophy", "skill"}
        if v not in allowed:
            raise ValueError(f"intent must be one of {sorted(allowed)}")
        return v


class WorkoutOverrideRequest(BaseModel):
    """Replace the auto-generated gym session for a specific day."""

    exercises: list[ExerciseOverrideIn]
    session_name: str | None = None
    notes: str | None = None


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


# ── Diagnostics ───────────────────────────────────────────────────────
class MetricDiagnosticOut(BaseModel):
    kind: str
    last_ok_day: Date | None
    last_ok_value: float | None
    last_fetched_at: datetime | None
    coverage_days: int
    window_days: int
    days_since_ok: int | None
    stale: bool


class DiagnosticsResponse(BaseModel):
    generated_at: datetime
    window_days: int
    metrics: list[MetricDiagnosticOut]
