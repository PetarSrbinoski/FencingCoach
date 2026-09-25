"""Re-export models so Alembic autogenerate sees them."""

from app.models.models import (  # noqa: F401
    Activity,
    AppSetting,
    AthleteProfile,
    CoachConversation,
    CoachMessage,
    Competition,
    DailyBrief,
    DataSummary,
    DayTypeOverride,
    GarminMetric,
    MentalEntry,
    NutritionEstimate,
    NutritionLog,
    NutritionPlan,
    SavedFood,
    TrainingPlan,
    USDAFood,
    WorkoutLog,
    WorkoutOverride,
)
