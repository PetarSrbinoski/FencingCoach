"""API-01..05 against the running FastAPI server and migrated PostgreSQL."""

from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def client() -> Iterator[httpx.Client]:
    subprocess.run(["bash", str(ROOT / "testing/scripts/reset_db.sh")], check=True, timeout=30)
    with httpx.Client(base_url=f"http://127.0.0.1:{os.environ.get('TEST_BACKEND_PORT', '18000')}", timeout=10) as api:
        yield api


def _db_count(table: str, day: str | None = None) -> int:
    # Table names are static, never derived from a response or user input.
    assert table in {"day_type_overrides", "workout_overrides", "nutrition_log"}
    dsn = (
        "postgresql://coach_test:disposable_test_password@127.0.0.1:"
        f"{os.environ.get('TEST_DB_PORT', '15432')}/coachapp_testing"
    )
    with psycopg.connect(dsn) as db, db.cursor() as cursor:
        if day is None:
            cursor.execute(f"SELECT count(*) FROM {table}")  # noqa: S608
        else:
            cursor.execute(f"SELECT count(*) FROM {table} WHERE day = %s", (day,))  # noqa: S608
        row = cursor.fetchone()
        assert row is not None
        return int(row[0])


def _terminal_estimate(api: httpx.Client, estimate_id: int) -> dict[str, Any]:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        response = api.get(f"/nutrition/estimate/{estimate_id}")
        assert response.status_code == 200
        result = response.json()
        if result["status"] != "pending":
            return result
        time.sleep(0.1)
    pytest.fail("estimate did not reach a terminal state within 15 seconds")


@pytest.mark.integration
def test_day_type_replace_is_date_scoped_and_clear_restores_auto(client: httpx.Client) -> None:
    day = os.environ["TEST_ATHLETE_DAY"]
    tomorrow = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    original = client.get(f"/targets/{day}").json()
    adjacent = client.get(f"/targets/{tomorrow}").json()
    assert original["override_source"] == "auto"

    for kind in ("rest", "competition"):
        response = client.put(f"/targets/day-type/{day}", json={"day_type": kind})
        assert response.status_code == 200
        observed = client.get(f"/targets/{day}").json()
        assert (observed["day_type"], observed["override_source"]) == (kind, "manual")
        assert _db_count("day_type_overrides", day) == 1
    assert client.get(f"/targets/{tomorrow}").json() == adjacent
    assert client.put(f"/targets/day-type/{day}", json={"day_type": "unknown"}).status_code == 422
    assert _db_count("day_type_overrides", day) == 1

    assert client.delete(f"/targets/day-type/{day}").status_code == 200
    cleared = client.get(f"/targets/{day}").json()
    assert (cleared["day_type"], cleared["override_source"]) == (
        original["day_type"], "auto"
    )
    assert _db_count("day_type_overrides", day) == 0


@pytest.mark.integration
def test_estimate_reviewed_meal_totals_filter_and_delete(client: httpx.Client) -> None:
    day = os.environ["TEST_ATHLETE_DAY"]
    yesterday = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    accepted = client.post("/nutrition/estimate", json={"text": "synthetic training meal"})
    assert accepted.status_code == 202
    result = _terminal_estimate(client, accepted.json()["id"])
    assert (result["status"], result["kcal"]) == ("done", 495.0)
    assert client.get("/nutrition/log").json() == []
    assert _db_count("nutrition_log") == 0

    edited: dict[str, Any] = {"raw_text": "synthetic training meal", "meal": "lunch", "day": day,
              "kcal": 510, "protein_g": 33, "carbs_g": 61, "fat_g": 16, "fiber_g": 6}
    saved = client.post("/nutrition/log", json=edited)
    assert saved.status_code == 200
    meal_id = saved.json()["id"]
    assert {key: saved.json()[key] for key in ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")} == {
        key: float(edited[key]) for key in ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")
    }
    assert _db_count("nutrition_log") == 1
    assert [row["id"] for row in client.get("/nutrition/log").json()] == [meal_id]
    assert client.get(f"/nutrition/totals/{day}").json()["entry_count"] == 1
    assert client.get(f"/nutrition/totals/{day}").json()["kcal"] == 510
    assert client.get(f"/nutrition/totals/{yesterday}").json()["entry_count"] == 0

    assert client.delete(f"/nutrition/log/{meal_id}").status_code == 204
    assert client.get("/nutrition/log").json() == []
    assert client.get(f"/nutrition/totals/{day}").json()["kcal"] == 0
    assert _db_count("nutrition_log") == 0


@pytest.mark.integration
def test_failed_estimate_and_unknown_id_do_not_block_next_job(client: httpx.Client) -> None:
    assert client.get("/nutrition/estimate/999999999").status_code == 404
    failed = client.post("/nutrition/estimate", json={"text": "FAIL: synthetic outage"})
    assert failed.status_code == 202
    terminal = _terminal_estimate(client, failed.json()["id"])
    assert terminal["status"] == "error"
    assert "controlled nutrition estimate failure" in terminal["error"]
    assert _db_count("nutrition_log") == 0

    accepted = client.post("/nutrition/estimate", json={"text": "synthetic recovery meal"})
    assert accepted.status_code == 202
    assert _terminal_estimate(client, accepted.json()["id"])["status"] == "done"
    assert _db_count("nutrition_log") == 0


@pytest.mark.integration
def test_workout_override_replaces_persists_validates_and_clears(client: httpx.Client) -> None:
    day = "2026-09-29"  # Tuesday gym session in the configured week
    adjacent = "2026-10-01"  # Thursday gym session
    original = client.get(f"/training/session/{day}").json()
    neighbour = client.get(f"/training/session/{adjacent}").json()
    assert original["source"] == "auto"

    first: dict[str, Any] = {"session_name": "Controlled strength", "exercises": [
        {"exercise": "Squat", "sets": 1, "reps": 1, "load_kg": 0, "target_rpe": 0}
    ]}
    second: dict[str, Any] = {"session_name": "Controlled power", "exercises": [
        {"exercise": "Jump", "sets": 20, "reps": 100, "load_kg": 50, "target_rpe": 10}
    ]}
    for payload in (first, second):
        response = client.put(f"/training/session/{day}/override", json=payload)
        assert response.status_code == 200
        observed = client.get(f"/training/session/{day}").json()
        assert observed["source"] == "manual"
        assert observed["session"]["name"] == payload["session_name"]
        assert observed["session"]["exercises"][0]["exercise"] == payload["exercises"][0]["exercise"]
        assert _db_count("workout_overrides", day) == 1
    assert client.get(f"/training/session/{adjacent}").json() == neighbour

    for exercise in (
        {"exercise": "Squat", "sets": 0, "reps": 1},
        {"exercise": "Squat", "sets": 21, "reps": 1},
        {"exercise": "Squat", "sets": 1, "reps": 0},
        {"exercise": "Squat", "sets": 1, "reps": 101},
        {"exercise": "Squat", "sets": 1, "reps": 1, "load_kg": -1},
        {"exercise": "Squat", "sets": 1, "reps": 1, "target_rpe": -0.1},
        {"exercise": "Squat", "sets": 1, "reps": 1, "target_rpe": 10.1},
    ):
        assert client.put(f"/training/session/{day}/override", json={"exercises": [exercise]}).status_code == 422
    assert _db_count("workout_overrides", day) == 1

    cleared = client.put(f"/training/session/{day}/override", json={"exercises": []})
    assert cleared.status_code == 200
    assert cleared.json()["source"] == "auto"
    assert client.get(f"/training/session/{day}").json() == original
    assert _db_count("workout_overrides", day) == 0
