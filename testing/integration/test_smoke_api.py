"""A real API and migrated PostgreSQL smoke test for the isolated stack."""

from __future__ import annotations

import os
import time

import httpx
import psycopg
import pytest


@pytest.mark.integration
def test_estimate_job_uses_migrated_test_database_without_logging_a_meal() -> None:
    api_url = f"http://127.0.0.1:{os.environ.get('TEST_BACKEND_PORT', '18000')}"
    db_port = os.environ.get("TEST_DB_PORT", "15432")
    day = os.environ["TEST_ATHLETE_DAY"]
    dsn = (
        "postgresql://coach_test:disposable_test_password"
        f"@127.0.0.1:{db_port}/coachapp_testing"
    )

    with httpx.Client(base_url=api_url, timeout=10) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["db"] is True

        targets = client.get("/targets/today")
        assert targets.status_code == 200
        assert targets.json()["day"] == day

        accepted = client.post("/nutrition/estimate", json={"text": "synthetic training meal"})
        assert accepted.status_code == 202
        estimate_id = accepted.json()["id"]

        deadline = time.monotonic() + 15
        while True:
            result = client.get(f"/nutrition/estimate/{estimate_id}")
            assert result.status_code == 200
            if result.json()["status"] != "pending":
                break
            assert time.monotonic() < deadline, "estimate did not finish within 15 seconds"
            time.sleep(0.1)
        assert result.json()["status"] == "done"
        assert result.json()["kcal"] == 495

        logs = client.get("/nutrition/log")
        assert logs.status_code == 200
        assert logs.json() == []

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            assert cursor.fetchone() == ("coachapp_testing",)
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() is not None
            cursor.execute("SELECT status, kcal FROM nutrition_estimates WHERE id = %s", (estimate_id,))
            assert cursor.fetchone() == ("done", 495.0)
            cursor.execute("SELECT count(*) FROM nutrition_log")
            assert cursor.fetchone() == (0,)
