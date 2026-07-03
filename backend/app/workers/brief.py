"""Auto morning-brief worker.

Run as: `python -m app.workers.brief`

Schedules:
- Daily at MORNING_BRIEF_HOUR, in the athlete's own timezone → generate
  and persist today's brief, so it's already sitting there when the
  athlete opens the dashboard instead of requiring a manual "Generate"
  click first thing in the morning.

Runs alongside the Garmin sync and summarization workers.
"""

from __future__ import annotations

import logging
import signal
import sys
import time

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.agents.brief import generate_brief
from app.core.config import settings
from app.core.database import SessionLocal

log = logging.getLogger("brief_worker")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s"
)


def _run_brief() -> None:
    log.info("Generating morning brief…")
    db = SessionLocal()
    try:
        brief = generate_brief(db)
        log.info("Morning brief generated for %s", brief.day)
    except Exception:  # noqa: BLE001
        log.exception("Morning brief generation failed")
    finally:
        db.close()


def main() -> None:
    sched = BlockingScheduler(timezone=settings.ATHLETE_TIMEZONE)
    sched.add_job(
        _run_brief,
        trigger=CronTrigger(hour=settings.MORNING_BRIEF_HOUR, minute=0),
        id="morning_brief",
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
        "Morning brief scheduler started. Runs daily at %02d:00 %s.",
        settings.MORNING_BRIEF_HOUR,
        settings.ATHLETE_TIMEZONE,
    )
    time.sleep(2)
    sched.start()


if __name__ == "__main__":
    main()
