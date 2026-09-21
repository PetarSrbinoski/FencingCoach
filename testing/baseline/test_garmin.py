"""GAR-01/02/03: independently selected public extractor examples."""

import pytest
from app.services.garmin_extract import (
    extract_all,
    extract_body_battery,
    extract_calories,
    extract_hrv,
    extract_intensity_minutes,
    extract_sleep,
    extract_steps,
    extract_training_status,
)


@pytest.mark.baseline
def test_absent_and_null_candidates_are_missing() -> None:
    assert all(metric.status == "missing" for metric in extract_all({}).values())
    assert extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": None}}}).value is None


@pytest.mark.baseline
@pytest.mark.parametrize(
    ("payload", "status", "value"),
    [
        ({"hrv": {"hrvSummary": {"lastNightAvg": "not a number"}}}, "missing", None),
        ({"hrv": {"hrvSummary": {"lastNightAvg": 1}}}, "ok", 1.0),
        ({"hrv": {"hrvSummary": {"lastNightAvg": 300}}}, "ok", 300.0),
        ({"hrv": {"hrvSummary": {"lastNightAvg": 0}}}, "implausible", None),
        ({"hrv": {"hrvSummary": {"lastNightAvg": 301}}}, "implausible", None),
    ],
)
def test_hrv_partition_and_inclusive_boundaries(payload: dict, status: str, value: float | None) -> None:
    metric = extract_hrv(payload)
    assert (metric.status, metric.value) == (status, value)


@pytest.mark.baseline
@pytest.mark.parametrize(
    ("steps", "status", "value"),
    [(0, "ok", 0.0), (100_000, "ok", 100_000.0), (-1, "implausible", None), (100_001, "implausible", None)],
)
def test_steps_accept_zero_and_inclusive_bounds(steps: int, status: str, value: float | None) -> None:
    metric = extract_steps({"stats": {"totalSteps": steps}})
    assert (metric.status, metric.value) == (status, value)


@pytest.mark.baseline
def test_supported_fallback_paths_and_preferred_candidate() -> None:
    assert extract_sleep({"sleep": {"sleepTimeSeconds": 3600}}).value == 1.0
    assert extract_calories({"user_summary": {"totalKilocalories": 2400}}).value == 2400.0
    assert extract_body_battery({"body_battery": [{"bodyBatteryValuesArray": [[1, 25], [2, 40]]}]}).value == 40.0
    assert extract_hrv({"hrv": {"hrvSummary": {"weeklyAvg": 42}}}).value == 42.0
    preferred = {"hrv": {"hrvSummary": {"lastNightAvg": 35, "weeklyAvg": 42}}}
    assert extract_hrv(preferred).value == 35.0


@pytest.mark.baseline
def test_present_invalid_preferred_value_does_not_fall_through() -> None:
    metric = extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": "bad", "weeklyAvg": 42}}})
    assert (metric.status, metric.value) == ("missing", None)


@pytest.mark.baseline
def test_payload_only_metrics_have_no_scalar_even_when_present() -> None:
    assert (extract_training_status({"training_status": {"state": "productive"}}).status,
            extract_training_status({"training_status": {"state": "productive"}}).value) == ("ok", None)
    assert (extract_intensity_minutes({"intensity_minutes": []}).status,
            extract_intensity_minutes({"intensity_minutes": []}).value) == ("ok", None)
