"""Background Garmin sync worker.

Run as: `python -m app.workers.garmin_sync`

Schedules:
- Every GARMIN_RECENT_SYNC_MINUTES → recent sync (last 2 days)
- Daily at GARMIN_FULL_SYNC_HOUR    → full sync (last GARMIN_FULL_SYNC_DAYS days)

Gracefully no-ops if Garmin credentials aren't set yet or if auth fails.
Implements exponential backoff on auth failures to avoid Garmin rate-limits.
"""

from __future__ import annotations

import logging
import signal
import sys
import time
from datetime import datetime, timezone

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings
from app.core.database import SessionLocal
from app.services.garmin import GarminService

log = logging.getLogger("garmin_sync")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s"
)

# Backoff state: skip syncs for a period after auth failures.
_backoff_until: datetime | None = None
_consecutive_failures: int = 0


def _is_backed_off() -> bool:
    global _backoff_until
    if _backoff_until is None:
        return False
    if datetime.now(timezone.utc) < _backoff_until:
        remaining = (_backoff_until - datetime.now(timezone.utc)).seconds // 60
        log.info(
            "Garmin auth backoff active — skipping sync (retry in ~%d min).",
            remaining,
        )
        return True
    _backoff_until = None
    return False


def _record_auth_failure() -> None:
    global _backoff_until, _consecutive_failures
    _consecutive_failures += 1
    # Exponential backoff: 5, 15, 30, 60, 60 min...
    minutes = min(60, 5 * (2 ** (_consecutive_failures - 1)))
    _backoff_until = datetime.now(timezone.utc) + __import__("datetime").timedelta(
        minutes=minutes
    )
    log.warning(
        "Garmin auth failed (#%d). Backing off for %d minutes.",
        _consecutive_failures,
        minutes,
    )


def _record_success() -> None:
    global _consecutive_failures
    _consecutive_failures = 0


def _run_recent() -> None:
    if not (settings.GARMIN_EMAIL and settings.GARMIN_PASSWORD):
        log.info("Garmin credentials missing — skipping recent sync.")
        return
    if _is_backed_off():
        return
    log.info("Recent Garmin sync starting…")
    db = SessionLocal()
    try:
        result = GarminService().sync_recent(db, days=2)
        _record_success()
        log.info("Recent sync done: %s", result)
    except Exception as e:  # noqa: BLE001
        err_str = str(e).lower()
        if "429" in err_str or "too many" in err_str or "authentication" in err_str:
            _record_auth_failure()
        else:
            log.exception("Recent sync failed: %s", e)
    finally:
        db.close()


def _run_full() -> None:
    if not (settings.GARMIN_EMAIL and settings.GARMIN_PASSWORD):
        log.info("Garmin credentials missing — skipping full sync.")
        return
    if _is_backed_off():
        return
    log.info("Full Garmin sync starting…")
    db = SessionLocal()
    try:
        result = GarminService().sync_full(db, days=settings.GARMIN_FULL_SYNC_DAYS)
        _record_success()
        log.info("Full sync done: %s", result)
    except Exception as e:  # noqa: BLE001
        err_str = str(e).lower()
        if "429" in err_str or "too many" in err_str or "authentication" in err_str:
            _record_auth_failure()
        else:
            log.exception("Full sync failed: %s", e)
    finally:
        db.close()


def main() -> None:
    sched = BlockingScheduler(timezone="UTC")
    sched.add_job(
        _run_recent,
        trigger=IntervalTrigger(minutes=settings.GARMIN_RECENT_SYNC_MINUTES),
        id="garmin_recent",
        next_run_time=None,  # don't run immediately on boot
        max_instances=1,
        coalesce=True,
    )
    sched.add_job(
        _run_full,
        trigger=CronTrigger(hour=settings.GARMIN_FULL_SYNC_HOUR, minute=0),
        id="garmin_full",
        max_instances=1,
        coalesce=True,
    )

    def _shutdown(signum, _frame):  # noqa: ANN001
        log.info("Shutdown signal %s — stopping scheduler.", signum)
        sched.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    log.info(
        "Scheduler started. Recent every %s min, full at %02d:00 UTC.",
        settings.GARMIN_RECENT_SYNC_MINUTES,
        settings.GARMIN_FULL_SYNC_HOUR,
    )
    # Small delay so DB is reachable.
    time.sleep(2)
    sched.start()


if __name__ == "__main__":
    main()
