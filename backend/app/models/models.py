"""SQLAlchemy ORM models for FencingCoach AI.

All models share a single Base. They are imported in `app.models.__init__`
so Alembic autogenerate sees them.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

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


# ─────────────────────────────────────────────────────────────────────
# Athlete
# ─────────────────────────────────────────────────────────────────────
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
    food_budget: Mapped[str | None] = mapped_column(String(40))
    supplements: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ─────────────────────────────────────────────────────────────────────
# Garmin time-series
# ─────────────────────────────────────────────────────────────────────
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
    # Extraction outcome, always recorded (even on failure) so coverage/
    # diagnostics can distinguish "never synced", "synced but Garmin had
    # nothing", and "synced but value was implausible and rejected".
    #   ok          — value extracted and passed plausibility checks
    #   missing     — no value found at any known key-path
    #   implausible — a value was found but rejected as out-of-range
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


# ─────────────────────────────────────────────────────────────────────
# Nutrition
# ─────────────────────────────────────────────────────────────────────
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


class NutritionPlan(Base):
    __tablename__ = "nutrition_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    targets: Mapped[dict[str, Any]] = mapped_column(JSONB)  # {kcal, protein_g, ...}
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)  # meals breakdown
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ─────────────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────
# Competition
# ─────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────
# Coach
# ─────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────
# Long-term storage
# ─────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────
# Day-type overrides
# ─────────────────────────────────────────────────────────────────────
class DayTypeOverride(Base):
    """Manual override for the auto-detected day type on a given day."""

    __tablename__ = "day_type_overrides"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    override_type: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkoutOverride(Base):
    """Manual replacement of the auto-generated gym session for a given day.

    `build_session()` (services/training.py) normally *computes* the
    prescribed exercises from templates + phase + readiness. When a row
    exists here for a day, it takes precedence over that computation
    verbatim — used by the coach chat agent (or, in future, a UI form) to
    change what's planned for a specific (usually upcoming) day.
    """

    __tablename__ = "workout_overrides"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    session_name: Mapped[str | None] = mapped_column(String(80))
    exercises: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ─────────────────────────────────────────────────────────────────────
# Mental Training
# ─────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────
# USDA Food Reference
# ─────────────────────────────────────────────────────────────────────
class USDAFood(Base):
    """Cached USDA FoodData Central item for nutrition cross-reference."""

    __tablename__ = "usda_foods"
    # Real GIN trigram index (requires `pg_trgm` extension, created in the
    # baseline migration) — matches the `.contains()` substring search used
    # by `services/usda.search_foods`. Previously this was a plain btree
    # index that couldn't accelerate `LIKE '%term%'` queries despite its
    # "_trgm" name.
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


# ─────────────────────────────────────────────────────────────────────
# App settings (generic key/value)
# ─────────────────────────────────────────────────────────────────────
class AppSetting(Base):
    """Generic single-row-per-key app-wide setting (single-user app, no
    per-user scoping needed). Currently used for the manual LLM provider
    toggle (`key="llm_provider"`, `value="local"|"cloud"` — see
    `services/llm_provider.py`), but intentionally generic so future
    simple global flags don't each need their own table + migration.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
