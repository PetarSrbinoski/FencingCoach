"""Re-export models so Alembic autogenerate sees them."""

from app.models.models import (  # noqa: F401
    Activity,
    AthleteProfile,
    CoachConversation,
    CoachMessage,
    Competition,
    DailyBrief,
    DataSummary,
    DayTypeOverride,
    GarminMetric,
    MentalEntry,
    NutritionLog,
    NutritionPlan,
    TrainingPlan,
    USDAFood,
    WorkoutLog,
)
