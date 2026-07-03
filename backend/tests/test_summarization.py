"""Tests for data summarization service."""

from __future__ import annotations

from datetime import date, timedelta

from app.models import DataSummary, WorkoutLog
from app.services.summarization import (
    _aggregate_weekly_to_monthly,
    _summarize_mental_week,
    _summarize_nutrition_week,
    _summarize_training_week,
    generate_weekly_summaries,
    get_summaries,
    purge_old_detailed_data,
)


class TestTrainingWeekSummary:
    def test_empty(self, db):
        today = date.today()
        result = _summarize_training_week(db, today - timedelta(days=6), today)
        assert result["sets"] == 0

    def test_with_data(self, db, seed_workout_logs):
        today = date.today()
        result = _summarize_training_week(db, today - timedelta(days=6), today)
        assert result["total_sets"] > 0
        assert "Back Squat" in result["exercises"]
        assert result["exercises"]["Back Squat"]["sets"] > 0


class TestNutritionWeekSummary:
    def test_empty(self, db):
        today = date.today()
        result = _summarize_nutrition_week(db, today - timedelta(days=6), today)
        assert result["entries"] == 0

    def test_with_data(self, db, seed_nutrition_logs):
        today = date.today()
        result = _summarize_nutrition_week(db, today - timedelta(days=6), today)
        assert result["entries"] > 0
        assert result["avg_daily_kcal"] > 0
        assert result["avg_daily_protein_g"] > 0


class TestMentalWeekSummary:
    def test_empty(self, db):
        today = date.today()
        result = _summarize_mental_week(db, today - timedelta(days=6), today)
        assert result["entries"] == 0

    def test_with_data(self, db, seed_mental_entries):
        today = date.today()
        result = _summarize_mental_week(db, today - timedelta(days=6), today)
        assert result["entries"] > 0
        assert result["avg_mood"] is not None
        assert "by_type" in result


class TestMonthlyAggregation:
    def test_training_monthly(self):
        weekly = [
            {
                "total_sets": 30,
                "training_days": 3,
                "unique_exercises": 4,
                "exercises": {
                    "Back Squat": {"sets": 9, "max_weight": 100, "max_reps": 5}
                },
            },
            {
                "total_sets": 27,
                "training_days": 3,
                "unique_exercises": 4,
                "exercises": {
                    "Back Squat": {"sets": 9, "max_weight": 105, "max_reps": 5}
                },
            },
        ]
        result = _aggregate_weekly_to_monthly(weekly, "training")
        assert result["total_sets"] == 57
        assert result["training_days"] == 6
        assert result["exercises"]["Back Squat"]["max_weight"] == 105

    def test_nutrition_monthly(self):
        weekly = [
            {"avg_daily_kcal": 2400, "avg_daily_protein_g": 150, "days_logged": 5},
            {"avg_daily_kcal": 2500, "avg_daily_protein_g": 160, "days_logged": 6},
        ]
        result = _aggregate_weekly_to_monthly(weekly, "nutrition")
        assert result["avg_daily_kcal"] == 2450
        assert result["total_days_logged"] == 11

    def test_mental_monthly(self):
        weekly = [
            {
                "entries": 5,
                "avg_mood": 7.0,
                "avg_energy": 6.0,
                "avg_focus": 7.5,
                "avg_confidence": 6.5,
                "reflection_snippets": ["good week"],
            },
            {
                "entries": 4,
                "avg_mood": 7.5,
                "avg_energy": 6.5,
                "avg_focus": 8.0,
                "avg_confidence": 7.0,
                "reflection_snippets": ["improving"],
            },
        ]
        result = _aggregate_weekly_to_monthly(weekly, "mental")
        assert result["total_entries"] == 9
        assert result["avg_mood"] == 7.2  # (7.0 + 7.5) / 2 rounded


class TestGenerateSummaries:
    def test_no_old_data(self, db):
        """With only recent data (none at all), check it runs without error."""
        count = generate_weekly_summaries(db)
        # With no data at all, may still create empty summaries for past weeks
        # The important thing is it doesn't crash
        assert count >= 0

    def test_old_workout_data(self, db):
        """Insert old workout data and verify summaries are generated."""
        old_day = date.today() - timedelta(days=200)
        # Create a week of old data
        for i in range(7):
            day = old_day + timedelta(days=i)
            db.add(
                WorkoutLog(
                    day=day,
                    exercise="Deadlift",
                    set_number=1,
                    reps=5,
                    weight_kg=120,
                )
            )
        db.commit()

        count = generate_weekly_summaries(db, domains=["training"])
        assert count >= 1

        # Verify summary exists
        summaries = get_summaries(db, domain="training", period="week")
        assert len(summaries) >= 1
        assert summaries[0].domain == "training"
        assert summaries[0].period == "week"


class TestGetSummaries:
    def test_empty(self, db):
        assert get_summaries(db) == []

    def test_filter_by_domain(self, db):
        db.add(
            DataSummary(
                domain="training",
                period="week",
                period_start=date(2025, 1, 6),
                period_end=date(2025, 1, 12),
                summary={"total_sets": 30},
            )
        )
        db.add(
            DataSummary(
                domain="nutrition",
                period="week",
                period_start=date(2025, 1, 6),
                period_end=date(2025, 1, 12),
                summary={"entries": 10},
            )
        )
        db.commit()

        training = get_summaries(db, domain="training")
        assert len(training) == 1
        assert training[0].domain == "training"


class TestPurge:
    def test_no_summaries_no_purge(self, db, seed_workout_logs):
        """Should not delete anything if no summaries exist."""
        deleted = purge_old_detailed_data(db)
        assert deleted == {}

    def test_purge_with_summaries(self, db):
        """Should delete old data when summaries exist."""
        old_day = date.today() - timedelta(days=200)
        db.add(
            WorkoutLog(
                day=old_day,
                exercise="Bench Press",
                set_number=1,
                reps=5,
                weight_kg=80,
            )
        )
        db.add(
            DataSummary(
                domain="training",
                period="week",
                period_start=old_day - timedelta(days=6),
                period_end=old_day,
                summary={"total_sets": 3},
            )
        )
        db.commit()

        deleted = purge_old_detailed_data(db)
        assert deleted.get("training", 0) >= 1
