"""Meaningful GAR-01/03 assertions selected from surviving mutations."""

import pytest
from app.services.garmin_extract import extract_body_battery, extract_sleep


@pytest.mark.regression
def test_nested_sleep_candidate_precedes_flat_fallback() -> None:
    metric = extract_sleep({"sleep": {
        "dailySleepDTO": {"sleepTimeSeconds": 7200},
        "sleepTimeSeconds": 3600,
    }})
    assert (metric.status, metric.value) == ("ok", 2.0)


@pytest.mark.regression
def test_missing_scalar_retains_source_payload_for_diagnosis() -> None:
    payload = {"dailySleepDTO": {"sleepTimeSeconds": None}}
    metric = extract_sleep({"sleep": payload})
    assert (metric.status, metric.value) == ("missing", None)
    assert metric.payload == payload


@pytest.mark.regression
def test_stats_body_battery_precedes_series_fallback() -> None:
    metric = extract_body_battery({
        "stats": {"bodyBatteryMostRecentValue": 80},
        "body_battery": [{"bodyBatteryValuesArray": [[1, 30]]}],
    })
    assert (metric.status, metric.value) == ("ok", 80.0)
