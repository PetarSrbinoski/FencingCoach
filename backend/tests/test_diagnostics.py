"""Tests for Garmin extraction coverage diagnostics."""

from __future__ import annotations

from datetime import date, timedelta

from app.models import GarminMetric
from app.services.diagnostics import compute_diagnostics


def _add_metric(db, kind: str, day: date, status: str, value: float | None = None):
    db.add(GarminMetric(kind=kind, day=day, value=value, status=status, payload=None))


def test_metric_never_synced_is_stale_with_no_last_ok(db):
    today = date(2026, 6, 15)
    results = compute_diagnostics(db, window_days=30, today=today)
    hrv = next(m for m in results if m.kind == "hrv")
    assert hrv.last_ok_day is None
    assert hrv.last_ok_value is None
    assert hrv.days_since_ok is None
    assert hrv.stale is True
    assert hrv.coverage_days == 0


def test_metric_synced_today_is_not_stale(db):
    today = date(2026, 6, 15)
    _add_metric(db, "hrv", today, "ok", value=65.0)
    db.commit()

    results = compute_diagnostics(db, window_days=30, today=today)
    hrv = next(m for m in results if m.kind == "hrv")
    assert hrv.last_ok_day == today
    assert hrv.last_ok_value == 65.0
    assert hrv.days_since_ok == 0
    assert hrv.stale is False
    assert hrv.coverage_days == 1


def test_metric_stale_after_gap(db):
    today = date(2026, 6, 15)
    last_ok_day = today - timedelta(days=6)
    _add_metric(db, "hrv", last_ok_day, "ok", value=60.0)
    # more recent days present but failed extraction
    for i in range(1, 6):
        _add_metric(db, "hrv", today - timedelta(days=i), "missing", value=None)
    db.commit()

    results = compute_diagnostics(db, window_days=30, today=today)
    hrv = next(m for m in results if m.kind == "hrv")
    assert hrv.last_ok_day == last_ok_day
    assert hrv.days_since_ok == 6
    assert hrv.stale is True  # > STALE_AFTER_DAYS (3)


def test_coverage_only_counts_ok_status_within_window(db):
    today = date(2026, 6, 15)
    for i in range(10):
        day = today - timedelta(days=i)
        status = "ok" if i % 2 == 0 else "missing"
        _add_metric(db, "hrv", day, status, value=60.0 if status == "ok" else None)
    db.commit()

    results = compute_diagnostics(db, window_days=10, today=today)
    hrv = next(m for m in results if m.kind == "hrv")
    assert hrv.coverage_days == 5  # days 0,2,4,6,8 -> ok


def test_implausible_status_not_counted_as_coverage(db):
    today = date(2026, 6, 15)
    _add_metric(db, "hrv", today, "implausible", value=None)
    db.commit()

    results = compute_diagnostics(db, window_days=30, today=today)
    hrv = next(m for m in results if m.kind == "hrv")
    assert hrv.coverage_days == 0
    assert hrv.last_ok_day is None
    assert hrv.stale is True


def test_returns_one_entry_per_known_metric_kind(db):
    from app.services.garmin_extract import EXTRACTORS

    results = compute_diagnostics(db, window_days=30, today=date(2026, 6, 15))
    assert {m.kind for m in results} == set(EXTRACTORS.keys())
