"""Pure Garmin payload -> metric extraction.

Garmin's unofficial API has no schema guarantee: field names drift across
library versions and device/account variants, and endpoints can silently
return partial or empty payloads. This module is defensive on both axes:

  1. Multi-key-path fallbacks — each value is looked up via several known
     candidate locations before giving up.
  2. Plausibility validation — every value is checked against a sane range
     before being trusted (e.g. HRV of 0 or sleep of 20h is rejected, not
     silently persisted).

Every extraction reports its outcome (`ok` / `missing` / `implausible`)
rather than just returning `None`, so callers can log a structured warning
and build a per-day extraction-coverage record instead of silently losing
data provenance.

Pure functions only — no DB, no network — so this is fully unit-testable
with synthetic Garmin-shaped payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ExtractedMetric:
    value: float | None
    payload: Any
    status: str  # "ok" | "missing" | "implausible"
    detail: str | None = None


# Plausibility bounds (inclusive). A value outside these is rejected rather
# than persisted, since a wrong-but-numeric value is worse than none (it
# silently corrupts averages, readiness, targets, etc.)
PLAUSIBLE_RANGES: dict[str, tuple[float, float]] = {
    "sleep": (0.0, 16.0),  # hours
    "sleep_score": (0.0, 100.0),
    "hrv": (1.0, 300.0),  # ms (rMSSD), 0 is never a real reading
    "hrv_weekly": (1.0, 300.0),
    "body_battery": (0.0, 100.0),
    "stress_daily": (0.0, 100.0),
    "resting_hr": (20.0, 120.0),  # bpm
    "steps": (0.0, 100_000.0),
    "calories": (0.0, 10_000.0),
    "training_readiness": (0.0, 100.0),
    "vo2max": (20.0, 90.0),
}


def _dig(d: Any, *keys: str) -> Any:
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def _first(d: Any, *paths: tuple[str, ...]) -> Any:
    """Return the first non-None value found at any of the candidate paths."""
    for path in paths:
        v = _dig(d, *path)
        if v is not None:
            return v
    return None


def _build(kind: str, raw_value: Any, payload: Any) -> ExtractedMetric:
    if raw_value is None:
        return ExtractedMetric(
            None, payload, "missing", "no value at any known key-path"
        )
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return ExtractedMetric(
            None, payload, "missing", f"non-numeric value: {raw_value!r}"
        )
    bounds = PLAUSIBLE_RANGES.get(kind)
    if bounds is not None and not (bounds[0] <= value <= bounds[1]):
        return ExtractedMetric(
            None,
            payload,
            "implausible",
            f"{value} outside plausible range [{bounds[0]}, {bounds[1]}]",
        )
    return ExtractedMetric(value, payload, "ok", None)


# ── per-metric extractors ──────────────────────────────────────────────
def extract_sleep(raw: dict[str, Any]) -> ExtractedMetric:
    sleep = raw.get("sleep") or {}
    seconds = _first(
        sleep,
        ("dailySleepDTO", "sleepTimeSeconds"),
        ("sleepTimeSeconds",),
    )
    hours = seconds / 3600.0 if isinstance(seconds, (int, float)) else None
    return _build("sleep", hours, sleep)


def extract_sleep_score(raw: dict[str, Any]) -> ExtractedMetric:
    sleep = raw.get("sleep") or {}
    score = _first(
        sleep,
        ("dailySleepDTO", "sleepScores", "overall", "value"),
        ("overallSleepScore",),
    )
    return _build("sleep_score", score, None)


def extract_hrv(raw: dict[str, Any]) -> ExtractedMetric:
    hrv = raw.get("hrv") or {}
    avg = _first(
        hrv,
        ("hrvSummary", "lastNightAvg"),
        ("hrvSummary", "weeklyAvg"),
    )
    return _build("hrv", avg, hrv)


def extract_hrv_weekly(raw: dict[str, Any]) -> ExtractedMetric:
    hrv = raw.get("hrv") or {}
    weekly = _first(hrv, ("hrvSummary", "weeklyAvg"))
    return _build("hrv_weekly", weekly, None)


def extract_body_battery(raw: dict[str, Any]) -> ExtractedMetric:
    stats = raw.get("stats") or {}
    bb = raw.get("body_battery") or []
    value = _first(stats, ("bodyBatteryMostRecentValue",))
    if value is None and isinstance(bb, list):
        for entry in reversed(bb):
            arr = (
                entry.get("bodyBatteryValuesArray") if isinstance(entry, dict) else None
            )
            if not arr:
                continue
            for point in reversed(arr):
                if isinstance(point, list) and len(point) >= 2 and point[1] is not None:
                    value = point[1]
                    break
            if value is not None:
                break
    return _build("body_battery", value, bb)


def extract_stress_daily(raw: dict[str, Any]) -> ExtractedMetric:
    stress = raw.get("stress") or {}
    value = _first(stress, ("avgStressLevel",))
    return _build("stress_daily", value, stress)


def extract_resting_hr(raw: dict[str, Any]) -> ExtractedMetric:
    stats = raw.get("stats") or {}
    value = _first(stats, ("restingHeartRate",))
    return _build("resting_hr", value, raw.get("rhr"))


def extract_steps(raw: dict[str, Any]) -> ExtractedMetric:
    stats = raw.get("stats") or {}
    value = _first(stats, ("totalSteps",))
    return _build("steps", value, raw.get("steps"))


def extract_calories(raw: dict[str, Any]) -> ExtractedMetric:
    stats = raw.get("stats") or {}
    value = _first(
        stats,
        ("totalKilocalories",),
    )
    if value is None:
        user_summary = raw.get("user_summary") or {}
        value = _first(user_summary, ("totalKilocalories",))
    return _build("calories", value, stats)


def extract_training_readiness(raw: dict[str, Any]) -> ExtractedMetric:
    readiness = raw.get("training_readiness") or {}
    if isinstance(readiness, list) and readiness:
        readiness = readiness[-1]
    value = readiness.get("score") if isinstance(readiness, dict) else None
    return _build("training_readiness", value, readiness)


def extract_vo2max(raw: dict[str, Any]) -> ExtractedMetric:
    max_metrics = raw.get("max_metrics")
    entries = max_metrics if isinstance(max_metrics, list) else []
    value = None
    for entry in (entries[:1] + entries[-1:]) if entries else []:
        value = _dig(entry, "generic", "vo2MaxValue")
        if value is not None:
            break
    return _build("vo2max", value, max_metrics)


# Metrics with no scalar value (payload-only, or not yet plausibility-checked)
def extract_training_status(raw: dict[str, Any]) -> ExtractedMetric:
    payload = raw.get("training_status")
    status = "missing" if payload is None else "ok"
    return ExtractedMetric(
        None, payload, status, None if payload else "no data returned"
    )


def extract_intensity_minutes(raw: dict[str, Any]) -> ExtractedMetric:
    payload = raw.get("intensity_minutes")
    status = "missing" if payload is None else "ok"
    return ExtractedMetric(
        None, payload, status, None if payload else "no data returned"
    )


EXTRACTORS: dict[str, Any] = {
    "sleep": extract_sleep,
    "sleep_score": extract_sleep_score,
    "hrv": extract_hrv,
    "hrv_weekly": extract_hrv_weekly,
    "body_battery": extract_body_battery,
    "stress_daily": extract_stress_daily,
    "resting_hr": extract_resting_hr,
    "steps": extract_steps,
    "calories": extract_calories,
    "training_readiness": extract_training_readiness,
    "training_status": extract_training_status,
    "vo2max": extract_vo2max,
    "intensity_minutes": extract_intensity_minutes,
}


def extract_all(raw: dict[str, Any]) -> dict[str, ExtractedMetric]:
    """Run every registered extractor against a raw `fetch_day` payload."""
    return {kind: fn(raw) for kind, fn in EXTRACTORS.items()}
