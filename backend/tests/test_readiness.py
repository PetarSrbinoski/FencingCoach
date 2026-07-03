"""Tests for readiness: Garmin training_readiness as source of truth,
neutral-when-missing behavior, and band mapping."""

from __future__ import annotations

from datetime import date

from app.models import GarminMetric
from app.services.context import _readiness_section
from app.services.readiness import band_for_score, compute_readiness
from app.services.training import build_session

DAY = date(2026, 6, 15)


def test_neutral_when_no_garmin_reading(db):
    r = compute_readiness(db, DAY)
    assert r.score is None
    assert r.band == "unknown"
    assert r.source == "neutral"
    # advisories still computed even without a Garmin reading
    assert set(r.advisories.keys()) == {"load", "rest"}


def test_uses_garmin_training_readiness_directly(db):
    db.add(GarminMetric(kind="training_readiness", day=DAY, value=72, status="ok"))
    db.commit()
    r = compute_readiness(db, DAY)
    assert r.score == 72
    assert r.band == "green"
    assert r.source == "garmin"


def test_band_boundaries():
    assert band_for_score(0) == "red"
    assert band_for_score(39.9) == "red"
    assert band_for_score(40) == "amber"
    assert band_for_score(65) == "amber"
    assert band_for_score(65.1) == "green"
    assert band_for_score(100) == "green"


def test_implausible_or_missing_garmin_row_not_counted(db):
    # A row exists but with status != "ok" (e.g. implausible) — should not
    # be treated as a valid reading since .value is None in that case.
    db.add(
        GarminMetric(kind="training_readiness", day=DAY, value=None, status="missing")
    )
    db.commit()
    r = compute_readiness(db, DAY)
    assert r.score is None
    assert r.band == "unknown"


def test_readiness_section_renders_without_crashing_when_neutral(db):
    text = _readiness_section(db, DAY)
    assert "no Garmin reading" in text
    assert "unknown" in text


def test_readiness_section_renders_garmin_score(db):
    db.add(GarminMetric(kind="training_readiness", day=DAY, value=55, status="ok"))
    db.commit()
    text = _readiness_section(db, DAY)
    assert "55/100" in text
    assert "amber" in text


def test_build_session_does_not_crash_with_neutral_readiness(db):
    # Tuesday -> gym day in the default template; readiness has no Garmin
    # reading, so band="unknown" and no volume/intensity penalty applies.
    tuesday = date(2026, 6, 16)
    result = build_session(db, tuesday)
    assert result["readiness"]["score"] is None
    assert result["readiness"]["band"] == "unknown"
    if result["session"] is not None:
        assert "unknown" in result["session"]["rationale"]
