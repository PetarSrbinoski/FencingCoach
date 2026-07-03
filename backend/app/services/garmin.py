"""Garmin Connect integration via the unofficial `garminconnect` library.

Phase 1: log in with email/password, persist auth tokens to disk so we
don't re-login every sync, fetch a daily set of metrics, and upsert into
`garmin_metrics` + `activities`.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
)
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.core.config import settings
from app.models import Activity, GarminMetric
from app.services.garmin_extract import ExtractedMetric, extract_all

log = logging.getLogger(__name__)


class GarminService:
    """Wraps `garminconnect.Garmin` with token persistence + DB upserts."""

    def __init__(self, email: str | None = None, password: str | None = None) -> None:
        self.email = email or settings.GARMIN_EMAIL
        self.password = password or settings.GARMIN_PASSWORD
        self.token_dir = Path(settings.GARMIN_TOKEN_DIR)
        self.token_dir.mkdir(parents=True, exist_ok=True)
        self._client: Garmin | None = None

    # ── auth ──────────────────────────────────────────────────────────
    def _client_or_login(self) -> Garmin:
        if self._client is not None:
            return self._client
        client = Garmin(email=self.email, password=self.password)
        try:
            # New garminconnect releases use a single token store directory.
            # If tokens exist, this restores + auto-refreshes them.
            # If not, it performs a fresh login and writes garmin_tokens.json.
            client.login(str(self.token_dir))
        except FileNotFoundError as e:
            if not (self.email and self.password):
                raise RuntimeError(
                    "Garmin credentials not configured. Set GARMIN_EMAIL and GARMIN_PASSWORD."
                ) from e
            raise GarminConnectAuthenticationError(
                "No Garmin token store found and credential login did not start."
            ) from e
        self._client = client
        return client

    def login(self, email: str | None = None, password: str | None = None) -> None:
        """Force a fresh login and persist tokens."""
        self.email = email or self.email
        self.password = password or self.password
        if not (self.email and self.password):
            raise RuntimeError("Garmin email/password required for login.")
        client = Garmin(email=self.email, password=self.password)
        # Passing the token directory lets the library persist the new
        # garmin_tokens.json session automatically.
        client.login(str(self.token_dir))
        self._client = client

    # ── fetchers ──────────────────────────────────────────────────────
    def fetch_day(self, day: date) -> dict[str, Any]:
        """Pull a comprehensive snapshot for `day`. Returns dict of raw payloads.

        Each fetch is wrapped in try/except so a single endpoint failure
        doesn't kill the whole sync.
        """
        c = self._client_or_login()
        out: dict[str, Any] = {}
        ds = day.isoformat()

        def _safe(name: str, fn):
            try:
                out[name] = fn()
            except Exception as e:  # noqa: BLE001
                log.warning("Garmin fetch %s failed: %s", name, e)
                out[name] = None

        _safe("stats", lambda: c.get_stats(ds))
        _safe("user_summary", lambda: c.get_user_summary(ds))
        _safe("sleep", lambda: c.get_sleep_data(ds))
        _safe("hrv", lambda: c.get_hrv_data(ds))
        _safe("body_battery", lambda: c.get_body_battery(ds, ds))
        _safe("stress", lambda: c.get_stress_data(ds))
        _safe("rhr", lambda: c.get_rhr_day(ds))
        _safe("steps", lambda: c.get_steps_data(ds))
        _safe("training_status", lambda: c.get_training_status(ds))
        _safe("training_readiness", lambda: c.get_training_readiness(ds))
        _safe("max_metrics", lambda: c.get_max_metrics(ds))  # VO2max
        _safe("intensity_minutes", lambda: c.get_intensity_minutes_data(ds))
        return out

    def fetch_recent_activities(self, limit: int = 20) -> list[dict[str, Any]]:
        c = self._client_or_login()
        try:
            return c.get_activities(0, limit) or []
        except Exception as e:  # noqa: BLE001
            log.warning("Garmin activities fetch failed: %s", e)
            return []

    # ── persistence ───────────────────────────────────────────────────
    @staticmethod
    def _upsert_metric(db: Session, kind: str, day: date, metric: ExtractedMetric) -> None:
        stmt = pg_insert(GarminMetric).values(
            kind=kind,
            day=day,
            value=metric.value,
            payload=metric.payload,
            status=metric.status,
            detail=metric.detail,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_garmin_metric_kind_day",
            set_={
                "value": stmt.excluded.value,
                "payload": stmt.excluded.payload,
                "status": stmt.excluded.status,
                "detail": stmt.excluded.detail,
            },
        )
        db.execute(stmt)

    @classmethod
    def persist_day(cls, db: Session, day: date, raw: dict[str, Any]) -> None:
        """Extract + validate every metric kind, and persist the outcome.

        Every kind gets a row regardless of outcome (ok/missing/implausible)
        so extraction coverage is always queryable — see `services.diagnostics`.
        """
        extracted = extract_all(raw)
        for kind, metric in extracted.items():
            if metric.status != "ok":
                log.warning(
                    "garmin_extract %s status=%s day=%s detail=%s",
                    kind,
                    metric.status,
                    day.isoformat(),
                    metric.detail,
                )
            cls._upsert_metric(db, kind, day, metric)
        db.commit()

    @classmethod
    def persist_activities(cls, db: Session, items: list[dict[str, Any]]) -> int:
        added = 0
        for it in items:
            gid = str(it.get("activityId"))
            if not gid:
                continue
            existing = db.scalar(select(Activity).where(Activity.garmin_activity_id == gid))
            if existing:
                continue
            start_str = it.get("startTimeGMT") or it.get("startTimeLocal")
            try:
                if not start_str:
                    raise ValueError("missing start time")
                start_dt = datetime.fromisoformat(str(start_str).replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                start_dt = datetime.now(UTC)
            calories_raw = it.get("calories")
            avg_hr_raw = it.get("averageHR")
            max_hr_raw = it.get("maxHR")
            db.add(
                Activity(
                    garmin_activity_id=gid,
                    source="garmin",
                    activity_type=(it.get("activityType") or {}).get("typeKey"),
                    name=it.get("activityName"),
                    start_time=start_dt,
                    duration_s=int(it.get("duration") or 0) or None,
                    distance_m=it.get("distance"),
                    calories=int(calories_raw) if calories_raw else None,
                    avg_hr=int(avg_hr_raw) if avg_hr_raw else None,
                    max_hr=int(max_hr_raw) if max_hr_raw else None,
                    training_load=it.get("activityTrainingLoad"),
                    raw=it,
                )
            )
            added += 1
        db.commit()
        return added

    # ── orchestration ─────────────────────────────────────────────────
    def sync_recent(
        self, db: Session, days: int = settings.GARMIN_RECENT_SYNC_DAYS
    ) -> dict[str, Any]:
        today = athlete_today()
        days_synced = 0
        for i in range(days):
            d = today - timedelta(days=i)
            raw = self.fetch_day(d)
            self.persist_day(db, d, raw)
            days_synced += 1
        activities_added = self.persist_activities(db, self.fetch_recent_activities(20))
        return {"days_synced": days_synced, "activities_added": activities_added}

    def sync_full(self, db: Session, days: int = settings.GARMIN_FULL_SYNC_DAYS) -> dict[str, Any]:
        today = athlete_today()
        days_synced = 0
        for i in range(days):
            d = today - timedelta(days=i)
            raw = self.fetch_day(d)
            self.persist_day(db, d, raw)
            days_synced += 1
        activities_added = self.persist_activities(db, self.fetch_recent_activities(100))
        return {"days_synced": days_synced, "activities_added": activities_added}


_garmin: GarminService | None = None


def get_garmin() -> GarminService:
    global _garmin
    if _garmin is None:
        _garmin = GarminService()
    return _garmin
