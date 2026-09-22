"""GAR-01/02/03 generated supported payloads and malformed robustness cases."""

import math
from typing import Any

import pytest
from app.services.garmin_extract import (
    PLAUSIBLE_RANGES,
    extract_all,
    extract_hrv,
    extract_steps,
)
from hypothesis import given, settings
from hypothesis import strategies as st

scalars = st.one_of(st.none(), st.integers(min_value=-10, max_value=100_010), st.sampled_from(("bad", "40", "0")))


@pytest.mark.property
@settings(max_examples=100, derandomize=True)
@given(scalars, scalars, scalars)
def test_trusted_scalar_results_are_finite_and_in_range(
    hrv: Any, steps: Any, calories: Any
) -> None:
    raw = {
        "hrv": {"hrvSummary": {"lastNightAvg": hrv}},
        "stats": {"totalSteps": steps, "totalKilocalories": calories},
    }
    for kind, metric in extract_all(raw).items():
        if kind in PLAUSIBLE_RANGES and metric.status == "ok":
            low, high = PLAUSIBLE_RANGES[kind]
            assert metric.value is not None
            assert math.isfinite(metric.value)
            assert low <= metric.value <= high
        if kind in PLAUSIBLE_RANGES and metric.status != "ok":
            assert metric.value is None


@pytest.mark.property
@settings(max_examples=100, derandomize=True)
@given(st.integers(min_value=1, max_value=300), st.integers(min_value=1, max_value=300))
def test_hrv_precedence_distinguishes_absent_and_present_invalid(
    preferred: int, weekly: int
) -> None:
    absent = extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": None, "weeklyAvg": weekly}}})
    present = extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": preferred, "weeklyAvg": weekly}}})
    invalid = extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": "bad", "weeklyAvg": weekly}}})
    assert (absent.status, absent.value) == ("ok", float(weekly))
    assert (present.status, present.value) == ("ok", float(preferred))
    assert (invalid.status, invalid.value) == ("missing", None)


@pytest.mark.property
@settings(max_examples=100, derandomize=True)
@given(st.integers(min_value=0, max_value=100_000), st.integers(min_value=0, max_value=100_000))
def test_unrelated_keys_do_not_change_semantic_extraction(steps: int, unrelated: int) -> None:
    base = {"stats": {"totalSteps": steps}}
    augmented = {"stats": {"totalSteps": steps, "unrelated": unrelated}, "unknown": {"x": 1}}
    before = extract_all(base)
    after = extract_all(augmented)
    assert {key: (v.status, v.value) for key, v in before.items()} == {
        key: (v.status, v.value) for key, v in after.items()
    }


@pytest.mark.property
@settings(max_examples=100, derandomize=True)
@given(st.integers(min_value=0, max_value=100_000))
def test_allowed_zero_and_immediate_step_boundaries(value: int) -> None:
    assert extract_steps({"stats": {"totalSteps": value}}).value == float(value)
    assert extract_steps({"stats": {"totalSteps": -1}}).status == "implausible"
    assert extract_steps({"stats": {"totalSteps": 100_001}}).status == "implausible"
    assert extract_hrv({"hrv": {"hrvSummary": {"lastNightAvg": 0}}}).status == "implausible"


@pytest.mark.property
@settings(max_examples=100, derandomize=True)
@given(st.sampled_from((float("nan"), float("inf"), float("-inf"))))
def test_non_json_floats_are_never_trusted(value: float) -> None:
    metric = extract_steps({"stats": {"totalSteps": value}})
    assert metric.status == "implausible"
    assert metric.value is None
