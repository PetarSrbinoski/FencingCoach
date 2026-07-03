"""Tests for the canonical Garmin activity-type mapping."""

from __future__ import annotations

from app.services.activity_types import (
    ActivityCategory,
    categorize,
    display_label,
    is_cardio,
    is_fencing,
    is_strength,
)


def test_mma_maps_to_fencing():
    assert categorize("mma") is ActivityCategory.FENCING
    assert is_fencing("mma") is True


def test_martial_arts_maps_to_fencing():
    assert categorize("martial_arts") is ActivityCategory.FENCING
    assert is_fencing("MARTIAL_ARTS") is True


def test_strength_training_maps_to_strength():
    assert categorize("strength_training") is ActivityCategory.STRENGTH
    assert is_strength("strength_training") is True
    assert is_fencing("strength_training") is False


def test_running_maps_to_cardio():
    assert categorize("running") is ActivityCategory.CARDIO
    assert is_cardio("running") is True


def test_none_and_unknown_map_to_other():
    assert categorize(None) is ActivityCategory.OTHER
    assert categorize("") is ActivityCategory.OTHER
    assert categorize("kayaking") is ActivityCategory.OTHER


def test_display_label_annotates_fencing():
    assert display_label("mma") == "mma (fencing)"
    assert display_label("martial_arts") == "martial_arts (fencing)"


def test_display_label_leaves_other_types_untouched():
    assert display_label("strength_training") == "strength_training"
    assert display_label(None) == "activity"
