"""Background data summarization worker.

Run as: `python -m app.workers.summarization`. Daily at 04:00 UTC, generates
weekly + monthly summaries. The destructive purge job (deleting detailed
rows once summarized) is intentionally not scheduled — see
`services.summarization.purge_old_detailed_data`.
"""

from __future__ import annotations

import logging
import signal
import sys
import time

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.database import SessionLocal
from app.services import summarization

log = logging.getLogger("summarization_worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")


def _run_summaries() -> None:
    log.info("Starting summary generation…")
    db = SessionLocal()
    try:
        weekly = summarization.generate_weekly_summaries(db)
        monthly = summarization.generate_monthly_summaries(db)
        log.info("Summaries generated: %d weekly, %d monthly", weekly, monthly)
    except Exception:  # noqa: BLE001
        log.exception("Summary generation failed")
    finally:
        db.close()


def main() -> None:
    sched = BlockingScheduler(timezone="UTC")
    sched.add_job(
        _run_summaries,
        trigger=CronTrigger(hour=4, minute=0),
        id="daily_summaries",
        max_instances=1,
        coalesce=True,
    )

    def _shutdown(signum, _frame):  # noqa: ANN001
        log.info("Shutdown signal %s — stopping scheduler.", signum)
        sched.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    log.info("Summarization scheduler started. Summaries daily at 04:00 (purge disabled).")
    time.sleep(2)
    sched.start()


if __name__ == "__main__":
    main()
