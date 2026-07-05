"""Canonical Garmin activity-type -> training-category mapping. Garmin has
no "fencing" type, so épée sessions are logged as MMA/martial-arts — this
module is the single source of truth for that reconciliation.
"""

from __future__ import annotations

from enum import StrEnum


class ActivityCategory(StrEnum):
    FENCING = "fencing"
    STRENGTH = "strength"
    CARDIO = "cardio"
    OTHER = "other"


# Raw Garmin `activityType.typeKey` values (or substrings thereof) mapped to
# each category. Matching is case-insensitive substring containment since
# Garmin's typeKey granularity varies (e.g. "strength_training" vs
# "indoor_cardio").
FENCING_TYPE_KEYS: tuple[str, ...] = ("mma", "martial_arts")
STRENGTH_TYPE_KEYS: tuple[str, ...] = (
    "strength_training",
    "strength",
    "weight_training",
)
CARDIO_TYPE_KEYS: tuple[str, ...] = (
    "running",
    "cycling",
    "swimming",
    "rowing",
    "elliptical",
    "walking",
    "cardio",
)


def categorize(activity_type: str | None) -> ActivityCategory:
    """Map a raw Garmin `activityType.typeKey` to a training category.

    Fencing is checked first because Garmin's MMA/martial-arts typeKeys
    would otherwise never be classified as anything meaningful.
    """
    t = (activity_type or "").strip().lower()
    if not t:
        return ActivityCategory.OTHER
    if any(k in t for k in FENCING_TYPE_KEYS):
        return ActivityCategory.FENCING
    if any(k in t for k in STRENGTH_TYPE_KEYS):
        return ActivityCategory.STRENGTH
    if any(k in t for k in CARDIO_TYPE_KEYS):
        return ActivityCategory.CARDIO
    return ActivityCategory.OTHER


def is_fencing(activity_type: str | None) -> bool:
    return categorize(activity_type) is ActivityCategory.FENCING


def is_strength(activity_type: str | None) -> bool:
    return categorize(activity_type) is ActivityCategory.STRENGTH


def is_cardio(activity_type: str | None) -> bool:
    return categorize(activity_type) is ActivityCategory.CARDIO


def display_label(activity_type: str | None) -> str:
    """Human-readable label for UI/LLM-context rendering.

    Surfaces the fencing reclassification explicitly (e.g. "MMA (fencing)")
    rather than silently showing the raw, misleading Garmin type.
    """
    raw = activity_type or "activity"
    if is_fencing(activity_type):
        return f"{raw} (fencing)"
    return raw
