"""SQLAlchemy ORM models for FencingCoach AI."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AthleteProfile(Base):
    """Static / slowly changing profile. Single row in single-user app."""

    __tablename__ = "athlete_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String(120))
    sport: Mapped[str] = mapped_column(String(40), default="fencing-epee")
    level: Mapped[str] = mapped_column(String(40), default="elite")
    age: Mapped[int | None] = mapped_column(Integer)
    height_cm: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    fencing_style: Mapped[str | None] = mapped_column(String(80))
    goals: Mapped[str | None] = mapped_column(Text)
    weaknesses: Mapped[str | None] = mapped_column(Text)
    body_comp_goal: Mapped[str | None] = mapped_column(String(80))
    dietary_restrictions: Mapped[str | None] = mapped_column(Text)
    food_preferences: Mapped[str | None] = mapped_column(Text)
    food_budget: Mapped[str | None] = mapped_column(String(40))
    supplements: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GarminMetric(Base):
    """One row per metric snapshot. `kind` discriminates data type.

    Examples of `kind`:
        sleep, hrv, body_battery, stress_daily, resting_hr,
        steps, calories, vo2max, training_status, intensity_minutes
    """

    __tablename__ = "garmin_metrics"
    __table_args__ = (
        Index("ix_garmin_metrics_kind_day", "kind", "day"),
        UniqueConstraint("kind", "day", name="uq_garmin_metric_kind_day"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Extraction outcome, always recorded so diagnostics can distinguish
    # "never synced" from "synced but missing/implausible". One of:
    # ok | missing | implausible.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ok")
    detail: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Activity(Base):
    """Workout / fencing session / activity. Synced from Garmin or manual."""

    __tablename__ = "activities"
    __table_args__ = (Index("ix_activities_start_time", "start_time"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    garmin_activity_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    source: Mapped[str] = mapped_column(String(20), default="garmin")  # garmin|manual
    activity_type: Mapped[str | None] = mapped_column(String(60))
    name: Mapped[str | None] = mapped_column(String(200))
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_s: Mapped[int | None] = mapped_column(Integer)
    distance_m: Mapped[float | None] = mapped_column(Float)
    calories: Mapped[int | None] = mapped_column(Integer)
    avg_hr: Mapped[int | None] = mapped_column(Integer)
    max_hr: Mapped[int | None] = mapped_column(Integer)
    training_load: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class SavedFood(Base):
    __tablename__ = "saved_foods"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    name_key: Mapped[str] = mapped_column(String(400), unique=True)
    kcal: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carbs_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    fiber_g: Mapped[float | None] = mapped_column(Float)
    micros: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    serving_name: Mapped[str | None] = mapped_column(String(80))
    serving_size_g: Mapped[float | None] = mapped_column(Float)
    prep_time_min: Mapped[int | None] = mapped_column(Integer)
    revision: Mapped[str] = mapped_column(String(32), nullable=False, default=lambda: uuid4().hex, onupdate=lambda: uuid4().hex)


class NutritionLog(Base):
    __tablename__ = "nutrition_log"
    __table_args__ = (Index("ix_nutrition_log_day", "day"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    meal: Mapped[str | None] = mapped_column(String(40))  # breakfast|lunch|dinner|snack|pre|post
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    kcal: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carbs_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    fiber_g: Mapped[float | None] = mapped_column(Float)
    micros: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    estimated_by: Mapped[str | None] = mapped_column(String(40))  # llm|manual|usda
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    repeat_request_id: Mapped[str | None] = mapped_column(String(100), unique=True)


class NutritionEstimate(Base):
    """A `POST /nutrition/estimate` request and its (async) LLM result —
    created `status="pending"` so the request can return a 202 immediately
    and a background job fills in the result (see `app/services/generation.py`).
    """

    __tablename__ = "nutrition_estimates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default="pending"
    )  # pending|done|error
    error: Mapped[str | None] = mapped_column(Text)

    kcal: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carbs_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    fiber_g: Mapped[float | None] = mapped_column(Float)
    micros: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    confidence: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)


class VoiceDraft(Base):
    """Reviewable voice interpretation; the uploaded audio is never persisted."""

    __tablename__ = "voice_drafts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    interpretation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    revision: Mapped[str] = mapped_column(String(32), nullable=False, default=lambda: uuid4().hex)
    accepted_action_id: Mapped[int | None] = mapped_column(Integer)


class NutritionPlan(Base):
    __tablename__ = "nutrition_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    targets: Mapped[dict[str, Any]] = mapped_column(JSONB)  # {kcal, protein_g, ...}
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)  # meals breakdown
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CompetitionNutritionPlan(Base):
    """Immutable accepted version of a dated competition nutrition preview."""

    __tablename__ = "competition_nutrition_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, nullable=False)
    event_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    days: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(60), nullable=False)
    preview_token: Mapped[str] = mapped_column(String(64), nullable=False)
    acceptance_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NutritionTargetAssignment(Base):
    """One effective accepted target per date; historical rows remain after deactivation."""

    __tablename__ = "nutrition_target_assignments"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    plan_id: Mapped[int] = mapped_column(Integer, nullable=False)
    targets: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CompetitionMealPlan(Base):
    """Immutable reviewed meal version for one accepted target date."""

    __tablename__ = "competition_meal_plans"
    __table_args__ = (
        Index("ix_competition_meal_plans_day", "day", "active"),
        UniqueConstraint("acceptance_id", "day", name="uq_competition_meal_acceptance_day"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    target_plan_id: Mapped[int] = mapped_column(Integer, nullable=False)
    target_version: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    meals: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    totals: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    warnings: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    preview_token: Mapped[str] = mapped_column(String(64), nullable=False)
    acceptance_id: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CoachPlanProposal(Base):
    """Coach-created preview awaiting an explicit athlete decision."""

    __tablename__ = "coach_plan_proposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    preview: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    conversation_id: Mapped[int | None] = mapped_column(Integer)
    message_id: Mapped[int | None] = mapped_column(BigInteger)
    applied_plan_id: Mapped[int | None] = mapped_column(Integer)
    action_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrainingPlan(Base):
    """Mesocycle / current programming."""

    __tablename__ = "training_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phase: Mapped[str] = mapped_column(String(40))  # base|build|peak|taper|comp|recovery
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    weeks: Mapped[int] = mapped_column(Integer)
    structure: Mapped[dict[str, Any]] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkoutLog(Base):
    """Per-set gym log."""

    __tablename__ = "workout_log"
    __table_args__ = (Index("ix_workout_log_day_exercise", "day", "exercise"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    exercise: Mapped[str] = mapped_column(String(80), nullable=False)
    set_number: Mapped[int] = mapped_column(Integer)
    reps: Mapped[int | None] = mapped_column(Integer)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    rpe: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Competition(Base):
    __tablename__ = "competitions"
    __table_args__ = (Index("ix_competitions_event_date", "event_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200))
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    level: Mapped[str | None] = mapped_column(String(60))  # local|national|FIE world cup|...
    priority: Mapped[str] = mapped_column(String(10), default="A")  # A|B|C
    notes: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    revision: Mapped[str] = mapped_column(String(32), nullable=False, default=lambda: uuid4().hex, onupdate=lambda: uuid4().hex)


class AgentAction(Base):
    """A user-facing receipt committed in the same transaction as a coach write."""

    __tablename__ = "agent_actions"
    __table_args__ = (Index("ix_agent_actions_created", "created_at", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="committed")
    resource_id: Mapped[str] = mapped_column(String(100), nullable=False)
    request_key: Mapped[str | None] = mapped_column(String(150), unique=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    resource_revision: Mapped[str | None] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    conversation_id: Mapped[int | None] = mapped_column(Integer)
    message_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CoachConversation(Base):
    __tablename__ = "coach_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list[CoachMessage]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="CoachMessage.created_at",
    )


class CoachMessage(Base):
    __tablename__ = "coach_messages"
    __table_args__ = (Index("ix_coach_messages_conv", "conversation_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("coach_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # system|user|assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # For assistant messages: "pending" until the background generation job
    # (app/services/generation.py) fills `content` and flips to "done"/"error".
    # User messages are always "done".
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="done")
    error: Mapped[str | None] = mapped_column(Text)
    # model used, context snapshot, ungrounded-claims list — set once the
    # background job finishes (see api/chat.py:_reply_values). Mirrors
    # what the old synchronous response used to return inline.
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    conversation: Mapped[CoachConversation] = relationship(back_populates="messages")


class DailyBrief(Base):
    __tablename__ = "daily_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    readiness_score: Mapped[float | None] = mapped_column(Float)
    summary: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DataSummary(Base):
    """Weekly / monthly aggregates for long-term retention."""

    __tablename__ = "data_summaries"
    __table_args__ = (
        UniqueConstraint("domain", "period", "period_start", name="uq_summary_domain_period"),
        Index("ix_summary_domain_period", "domain", "period", "period_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(
        String(30), nullable=False, default="general"
    )  # training|nutrition|garmin|mental|chat|general
    period: Mapped[str] = mapped_column(String(20))  # week|month
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DayTypeOverride(Base):
    """Manual override for the auto-detected day type on a given day."""

    __tablename__ = "day_type_overrides"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    override_type: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkoutDayRevision(Base):
    """Retain a workout date's revision even when its manual override is absent."""

    __tablename__ = "workout_day_revisions"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    revision: Mapped[str] = mapped_column(String(32), nullable=False)


class WorkoutOverride(Base):
    """Manual replacement of the auto-generated gym session for a given day —
    takes precedence over `build_session()`'s computed plan when present.
    """

    __tablename__ = "workout_overrides"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    session_name: Mapped[str | None] = mapped_column(String(80))
    exercises: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[str] = mapped_column(String(32), nullable=False, default=lambda: uuid4().hex, onupdate=lambda: uuid4().hex)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MentalEntry(Base):
    """Mental check-in, pre-competition mindset, or reflection journal entry."""

    __tablename__ = "mental_entries"
    __table_args__ = (Index("ix_mental_entries_day", "day"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    entry_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # check_in | pre_comp | reflection
    mood_score: Mapped[int | None] = mapped_column(Integer)  # 1-10
    energy_score: Mapped[int | None] = mapped_column(Integer)  # 1-10
    focus_score: Mapped[int | None] = mapped_column(Integer)  # 1-10
    confidence_score: Mapped[int | None] = mapped_column(Integer)  # 1-10
    content: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class USDAFood(Base):
    """Cached USDA FoodData Central item for nutrition cross-reference."""

    __tablename__ = "usda_foods"
    # GIN trigram index (requires `pg_trgm`) to accelerate the `.contains()`
    # substring search in `services/usda.search_foods`.
    __table_args__ = (
        Index(
            "ix_usda_foods_description_trgm",
            "description_lower",
            postgresql_using="gin",
            postgresql_ops={"description_lower": "gin_trgm_ops"},
        ),
    )

    fdc_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    description_lower: Mapped[str] = mapped_column(String(500), nullable=False)
    data_type: Mapped[str | None] = mapped_column(String(40))  # Foundation|SR Legacy|Survey
    category: Mapped[str | None] = mapped_column(String(200))
    nutrients: Mapped[dict[str, Any]] = mapped_column(JSONB)  # per-100g macros + micros
    serving_size_g: Mapped[float | None] = mapped_column(Float)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AppSetting(Base):
    """Generic single-row-per-key app-wide setting (single-user, no scoping
    needed) — currently used for the LLM provider toggle, kept generic for
    future flags.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CoachMemory(Base):
    """Inspectable context; tombstones preserve revision guards after deletion."""

    __tablename__ = "coach_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    provenance: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_on: Mapped[date | None] = mapped_column(Date)
    revision: Mapped[str] = mapped_column(String(32), nullable=False)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
