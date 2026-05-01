"""Tests for mental training service."""

from __future__ import annotations

from datetime import date, timedelta

from app.models import MentalEntry
from app.services.mental import _avg, _trend, compute_insight, mental_context_section


class TestAvg:
    def test_avg_normal(self):
        assert _avg([5, 7, 8]) == 6.7

    def test_avg_with_nones(self):
        assert _avg([5, None, 8]) == 6.5

    def test_avg_all_nones(self):
        assert _avg([None, None]) is None

    def test_avg_empty(self):
        assert _avg([]) is None


class TestTrend:
    def test_improving(self):
        assert _trend([4.0, 4.0, 5.0, 6.0, 7.0, 8.0]) == "improving"

    def test_declining(self):
        assert _trend([8.0, 7.0, 6.0, 5.0, 4.0, 3.0]) == "declining"

    def test_stable(self):
        assert _trend([5.0, 5.1, 5.0, 5.1, 5.0, 5.1]) == "stable"

    def test_too_few(self):
        assert _trend([5.0, 6.0]) == "stable"


class TestComputeInsight:
    def test_no_entries(self, db):
        result = compute_insight(db, period_days=14, use_llm=False)
        assert result["entry_count"] == 0
        assert result["trend"] == "stable"
        assert "No mental training entries" in result["insight"]

    def test_with_entries(self, db, seed_mental_entries):
        result = compute_insight(db, period_days=14, use_llm=False)
        assert result["entry_count"] == 7
        assert result["avg_mood"] is not None
        assert result["avg_energy"] is not None
        assert result["avg_focus"] is not None
        assert result["avg_confidence"] is not None
        assert result["trend"] in ("improving", "stable", "declining")

    def test_period_filtering(self, db, seed_mental_entries):
        result = compute_insight(db, period_days=3, use_llm=False)
        assert result["entry_count"] <= 3


class TestMentalContextSection:
    def test_no_entries(self, db):
        section = mental_context_section(db, date.today(), days=7)
        assert "no recent entries" in section

    def test_with_entries(self, db, seed_mental_entries):
        section = mental_context_section(db, date.today(), days=14)
        assert "Mental training" in section
        assert "check_in" in section or "reflection" in section
