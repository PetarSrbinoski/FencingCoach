"""Garmin Connect integration via the unofficial `garminconnect` library.

Phase 1: log in with email/password, persist auth tokens to disk so we
don't re-login every sync, fetch a daily set of metrics, and upsert into
`garmin_metrics` + `activities`.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Activity, GarminMetric

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
    def _upsert_metric(
        db: Session, kind: str, day: date, value: float | None, payload: Any
    ) -> None:
        stmt = pg_insert(GarminMetric).values(
            kind=kind, day=day, value=value, payload=payload
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_garmin_metric_kind_day",
            set_={"value": stmt.excluded.value, "payload": stmt.excluded.payload},
        )
        db.execute(stmt)

    @classmethod
    def persist_day(cls, db: Session, day: date, raw: dict[str, Any]) -> None:
        """Extract scalar values + store full payload for each metric kind."""

        def get(d: Any, *keys: str, default=None):
            cur = d
            for k in keys:
                if not isinstance(cur, dict) or k not in cur:
                    return default
                cur = cur[k]
            return cur

        sleep = raw.get("sleep") or {}
        hrv = raw.get("hrv") or {}
        bb = raw.get("body_battery") or []
        stress = raw.get("stress") or {}
        stats = raw.get("stats") or {}
        readiness = raw.get("training_readiness") or {}
        if isinstance(readiness, list) and readiness:
            readiness = readiness[-1]  # most recent reading

        # ── Sleep: duration + sleep score ─────────────────────────────
        sleep_seconds = get(sleep, "dailySleepDTO", "sleepTimeSeconds")
        cls._upsert_metric(
            db,
            "sleep",
            day,
            value=(sleep_seconds / 3600.0)
            if isinstance(sleep_seconds, (int, float))
            else None,
            payload=sleep,
        )
        sleep_score = get(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
        cls._upsert_metric(
            db,
            "sleep_score",
            day,
            value=float(sleep_score) if isinstance(sleep_score, (int, float)) else None,
            payload=None,
        )

        # ── HRV: lastNightAvg primary, weeklyAvg fallback + separate weekly metric
        hrv_avg = get(hrv, "hrvSummary", "lastNightAvg") or get(
            hrv, "hrvSummary", "weeklyAvg"
        )
        cls._upsert_metric(db, "hrv", day, value=hrv_avg, payload=hrv)
        hrv_weekly = get(hrv, "hrvSummary", "weeklyAvg")
        cls._upsert_metric(
            db,
            "hrv_weekly",
            day,
            value=float(hrv_weekly) if isinstance(hrv_weekly, (int, float)) else None,
            payload=None,
        )

        # ── Body Battery: most recent value from stats, fallback to last array entry
        bb_value = None
        if isinstance(stats, dict):
            bb_value = stats.get("bodyBatteryMostRecentValue")
        if bb_value is None and isinstance(bb, list) and bb:
            try:
                # fallback: last entry of bodyBatteryValuesArray
                for entry in reversed(bb):
                    arr = (
                        entry.get("bodyBatteryValuesArray")
                        if isinstance(entry, dict)
                        else None
                    )
                    if arr:
                        # find last valid entry
                        for v in reversed(arr):
                            if isinstance(v, list) and len(v) >= 2 and v[1] is not None:
                                bb_value = v[1]
                                break
                    if bb_value is not None:
                        break
            except Exception:  # noqa: BLE001
                bb_value = None
        cls._upsert_metric(
            db,
            "body_battery",
            day,
            value=float(bb_value) if isinstance(bb_value, (int, float)) else None,
            payload=bb,
        )

        cls._upsert_metric(
            db,
            "stress_daily",
            day,
            value=stress.get("avgStressLevel") if isinstance(stress, dict) else None,
            payload=stress,
        )
        cls._upsert_metric(
            db,
            "resting_hr",
            day,
            value=stats.get("restingHeartRate") if isinstance(stats, dict) else None,
            payload=raw.get("rhr"),
        )
        cls._upsert_metric(
            db,
            "steps",
            day,
            value=float(stats.get("totalSteps") or 0)
            if isinstance(stats, dict)
            else None,
            payload=raw.get("steps"),
        )
        cls._upsert_metric(
            db,
            "calories",
            day,
            value=float(stats.get("totalKilocalories") or 0)
            if isinstance(stats, dict)
            else None,
            payload=stats,
        )
        cls._upsert_metric(
            db,
            "training_readiness",
            day,
            value=readiness.get("score") if isinstance(readiness, dict) else None,
            payload=readiness,
        )
        cls._upsert_metric(
            db, "training_status", day, value=None, payload=raw.get("training_status")
        )
        cls._upsert_metric(
            db,
            "vo2max",
            day,
            value=get(raw.get("max_metrics") or [{}], 0, "generic", "vo2MaxValue")
            if isinstance(raw.get("max_metrics"), list)
            else None,
            payload=raw.get("max_metrics"),
        )
        cls._upsert_metric(
            db,
            "intensity_minutes",
            day,
            value=None,
            payload=raw.get("intensity_minutes"),
        )
        db.commit()

    @classmethod
    def persist_activities(cls, db: Session, items: list[dict[str, Any]]) -> int:
        added = 0
        for it in items:
            gid = str(it.get("activityId"))
            if not gid:
                continue
            existing = db.scalar(
                select(Activity).where(Activity.garmin_activity_id == gid)
            )
            if existing:
                continue
            start_str = it.get("startTimeGMT") or it.get("startTimeLocal")
            try:
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                start_dt = datetime.now(timezone.utc)
            db.add(
                Activity(
                    garmin_activity_id=gid,
                    source="garmin",
                    activity_type=(it.get("activityType") or {}).get("typeKey"),
                    name=it.get("activityName"),
                    start_time=start_dt,
                    duration_s=int(it.get("duration") or 0) or None,
                    distance_m=it.get("distance"),
                    calories=int(it.get("calories")) if it.get("calories") else None,
                    avg_hr=int(it.get("averageHR")) if it.get("averageHR") else None,
                    max_hr=int(it.get("maxHR")) if it.get("maxHR") else None,
                    training_load=it.get("activityTrainingLoad"),
                    raw=it,
                )
            )
            added += 1
        db.commit()
        return added

    # ── orchestration ─────────────────────────────────────────────────
    def sync_recent(self, db: Session, days: int = 2) -> dict[str, Any]:
        tz = ZoneInfo(settings.ATHLETE_TIMEZONE)
        today = datetime.now(tz).date()
        days_synced = 0
        for i in range(days):
            d = today - timedelta(days=i)
            raw = self.fetch_day(d)
            self.persist_day(db, d, raw)
            days_synced += 1
        activities_added = self.persist_activities(db, self.fetch_recent_activities(20))
        return {"days_synced": days_synced, "activities_added": activities_added}

    def sync_full(self, db: Session, days: int = 30) -> dict[str, Any]:
        tz = ZoneInfo(settings.ATHLETE_TIMEZONE)
        today = datetime.now(tz).date()
        days_synced = 0
        for i in range(days):
            d = today - timedelta(days=i)
            raw = self.fetch_day(d)
            self.persist_day(db, d, raw)
            days_synced += 1
        activities_added = self.persist_activities(
            db, self.fetch_recent_activities(100)
        )
        return {"days_synced": days_synced, "activities_added": activities_added}


_garmin: GarminService | None = None


def get_garmin() -> GarminService:
    global _garmin
    if _garmin is None:
        _garmin = GarminService()
    return _garmin
