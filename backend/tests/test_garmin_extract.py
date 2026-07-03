"""Tests for pure Garmin payload extraction (no DB, no network).

Uses synthetic, Garmin-shaped payloads since no real ground-truth data is
available. Covers: happy path, missing fields, alternate key-path
fallbacks, and implausible-value rejection.
"""

from __future__ import annotations

from app.services.garmin_extract import (
    extract_all,
    extract_body_battery,
    extract_calories,
    extract_hrv,
    extract_hrv_weekly,
    extract_intensity_minutes,
    extract_resting_hr,
    extract_sleep,
    extract_sleep_score,
    extract_steps,
    extract_stress_daily,
    extract_training_readiness,
    extract_training_status,
    extract_vo2max,
)


def _full_raw() -> dict:
    """A complete, well-formed synthetic day payload."""
    return {
        "sleep": {
            "dailySleepDTO": {
                "sleepTimeSeconds": 7.5 * 3600,
                "sleepScores": {"overall": {"value": 82}},
            }
        },
        "hrv": {"hrvSummary": {"lastNightAvg": 65, "weeklyAvg": 60}},
        "body_battery": [
            {"bodyBatteryValuesArray": [[1000, 40], [2000, 55], [3000, None]]}
        ],
        "stress": {"avgStressLevel": 28},
        "stats": {
            "bodyBatteryMostRecentValue": 72,
            "restingHeartRate": 48,
            "totalSteps": 8500,
            "totalKilocalories": 2600,
        },
        "rhr": {},
        "steps": {},
        "training_readiness": [{"score": 78}],
        "training_status": {"some": "payload"},
        "max_metrics": [{"generic": {"vo2MaxValue": 55.0}}],
        "intensity_minutes": {"weekly": 150},
        "user_summary": {"totalKilocalories": 2600},
    }


# ── happy path ──────────────────────────────────────────────────────────
def test_extract_all_happy_path():
    raw = _full_raw()
    results = extract_all(raw)
    assert results["sleep"].status == "ok"
    assert results["sleep"].value == 7.5
    assert results["sleep_score"].value == 82
    assert results["hrv"].value == 65  # lastNightAvg preferred
    assert results["hrv_weekly"].value == 60
    assert results["body_battery"].value == 72  # stats value preferred over array
    assert results["stress_daily"].value == 28
    assert results["resting_hr"].value == 48
    assert results["steps"].value == 8500
    assert results["calories"].value == 2600
    assert results["training_readiness"].value == 78
    assert results["vo2max"].value == 55.0
    assert results["training_status"].status == "ok"
    assert results["intensity_minutes"].status == "ok"


# ── missing fields ───────────────────────────────────────────────────────
def test_missing_fields_reported_as_missing_not_crash():
    raw = {}
    results = extract_all(raw)
    for kind, metric in results.items():
        assert metric.status == "missing", f"{kind} should be missing"
        assert metric.value is None
        assert metric.detail


def test_extract_sleep_missing():
    m = extract_sleep({"sleep": {}})
    assert m.status == "missing"
    assert m.value is None


# ── alternate key-path fallbacks ─────────────────────────────────────────
def test_hrv_falls_back_to_weekly_avg_when_last_night_missing():
    raw = {"hrv": {"hrvSummary": {"weeklyAvg": 58}}}
    m = extract_hrv(raw)
    assert m.status == "ok"
    assert m.value == 58


def test_sleep_falls_back_to_top_level_seconds():
    raw = {"sleep": {"sleepTimeSeconds": 6 * 3600}}
    m = extract_sleep(raw)
    assert m.status == "ok"
    assert m.value == 6.0


def test_sleep_score_falls_back_to_flat_key():
    raw = {"sleep": {"overallSleepScore": 90}}
    m = extract_sleep_score(raw)
    assert m.status == "ok"
    assert m.value == 90


def test_calories_falls_back_to_user_summary():
    raw = {"user_summary": {"totalKilocalories": 2200}}
    m = extract_calories(raw)
    assert m.status == "ok"
    assert m.value == 2200


def test_body_battery_falls_back_to_array_when_stats_missing():
    raw = {
        "stats": {},
        "body_battery": [{"bodyBatteryValuesArray": [[1000, 40], [2000, 61]]}],
    }
    m = extract_body_battery(raw)
    assert m.status == "ok"
    assert m.value == 61


def test_vo2max_reads_generic_vo2_max_value():
    raw = {"max_metrics": [{"generic": {"vo2MaxValue": 48.5}}]}
    m = extract_vo2max(raw)
    assert m.status == "ok"
    assert m.value == 48.5


def test_training_readiness_uses_last_list_entry():
    raw = {"training_readiness": [{"score": 40}, {"score": 85}]}
    m = extract_training_readiness(raw)
    assert m.status == "ok"
    assert m.value == 85


# ── plausibility rejection ───────────────────────────────────────────────
def test_hrv_zero_is_rejected_as_implausible():
    raw = {"hrv": {"hrvSummary": {"lastNightAvg": 0}}}
    m = extract_hrv(raw)
    assert m.status == "implausible"
    assert m.value is None
    assert "outside plausible range" in m.detail


def test_sleep_over_16_hours_is_rejected():
    raw = {"sleep": {"dailySleepDTO": {"sleepTimeSeconds": 20 * 3600}}}
    m = extract_sleep(raw)
    assert m.status == "implausible"


def test_resting_hr_absurd_value_is_rejected():
    raw = {"stats": {"restingHeartRate": 5}}
    m = extract_resting_hr(raw)
    assert m.status == "implausible"


def test_body_battery_out_of_0_100_is_rejected():
    raw = {"stats": {"bodyBatteryMostRecentValue": 150}}
    m = extract_body_battery(raw)
    assert m.status == "implausible"


def test_stress_daily_negative_is_rejected():
    raw = {"stress": {"avgStressLevel": -5}}
    m = extract_stress_daily(raw)
    assert m.status == "implausible"


# ── payload-only metrics ─────────────────────────────────────────────────
def test_training_status_missing_when_no_payload():
    m = extract_training_status({})
    assert m.status == "missing"


def test_intensity_minutes_ok_when_payload_present():
    m = extract_intensity_minutes({"intensity_minutes": {"weekly": 100}})
    assert m.status == "ok"


# ── non-numeric garbage doesn't crash ────────────────────────────────────
def test_non_numeric_value_treated_as_missing():
    raw = {"hrv": {"hrvSummary": {"lastNightAvg": "N/A"}}}
    m = extract_hrv(raw)
    assert m.status == "missing"
    assert m.value is None
