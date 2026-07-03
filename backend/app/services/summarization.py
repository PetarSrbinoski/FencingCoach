"""Data summarization service.

Generates domain-specific weekly and monthly rollups for long-term retention.
Detailed records older than 6 months get summarized; summaries are stored
in the `data_summaries` table and can be queried by the context builder.

Domains: training, nutrition, garmin, mental, chat
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import (
    Activity,
    CoachMessage,
    DataSummary,
    GarminMetric,
    MentalEntry,
    NutritionLog,
    WorkoutLog,
)

log = logging.getLogger(__name__)

RETENTION_DAYS = 180  # 6 months


# ── helpers ───────────────────────────────────────────────────────────
def _week_start(d: date) -> date:
    """Monday of the week containing `d`."""
    return d - timedelta(days=d.weekday())


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _month_end(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1, day=1) - timedelta(days=1)
    return d.replace(month=d.month + 1, day=1) - timedelta(days=1)


def _upsert_summary(
    db: Session,
    domain: str,
    period: str,
    period_start: date,
    period_end: date,
    summary: dict[str, Any],
) -> DataSummary:
    """Insert or update a summary row."""
    existing = db.scalar(
        select(DataSummary).where(
            and_(
                DataSummary.domain == domain,
                DataSummary.period == period,
                DataSummary.period_start == period_start,
            )
        )
    )
    if existing:
        existing.summary = summary
        existing.period_end = period_end
        existing.generated_at = datetime.now(timezone.utc)
    else:
        existing = DataSummary(
            domain=domain,
            period=period,
            period_start=period_start,
            period_end=period_end,
            summary=summary,
        )
        db.add(existing)
    return existing


# ── domain-specific weekly rollup builders ────────────────────────────
def _summarize_training_week(db: Session, start: date, end: date) -> dict[str, Any]:
    """Summarize workout logs for a week."""
    rows = db.scalars(
        select(WorkoutLog).where(and_(WorkoutLog.day >= start, WorkoutLog.day <= end))
    ).all()
    if not rows:
        return {"sets": 0, "exercises": [], "note": "no training data"}

    exercises: dict[str, dict[str, Any]] = {}
    for r in rows:
        ex = exercises.setdefault(
            r.exercise, {"sets": 0, "max_weight": 0, "max_reps": 0}
        )
        ex["sets"] += 1
        if r.weight_kg and r.weight_kg > ex["max_weight"]:
            ex["max_weight"] = r.weight_kg
        if r.reps and r.reps > ex["max_reps"]:
            ex["max_reps"] = r.reps

    return {
        "total_sets": len(rows),
        "unique_exercises": len(exercises),
        "exercises": {k: v for k, v in exercises.items()},
        "training_days": len({r.day for r in rows}),
    }


def _summarize_nutrition_week(db: Session, start: date, end: date) -> dict[str, Any]:
    """Summarize nutrition logs for a week."""
    rows = db.scalars(
        select(NutritionLog).where(
            and_(NutritionLog.day >= start, NutritionLog.day <= end)
        )
    ).all()
    if not rows:
        return {"entries": 0, "note": "no nutrition data"}

    days_logged = len({r.day for r in rows})
    total_kcal = sum(r.kcal or 0 for r in rows)
    total_protein = sum(r.protein_g or 0 for r in rows)
    total_carbs = sum(r.carbs_g or 0 for r in rows)
    total_fat = sum(r.fat_g or 0 for r in rows)

    return {
        "entries": len(rows),
        "days_logged": days_logged,
        "avg_daily_kcal": round(total_kcal / days_logged, 0) if days_logged else 0,
        "avg_daily_protein_g": round(total_protein / days_logged, 1)
        if days_logged
        else 0,
        "avg_daily_carbs_g": round(total_carbs / days_logged, 1) if days_logged else 0,
        "avg_daily_fat_g": round(total_fat / days_logged, 1) if days_logged else 0,
        "total_kcal": round(total_kcal, 0),
    }


def _summarize_garmin_week(db: Session, start: date, end: date) -> dict[str, Any]:
    """Summarize Garmin metrics and activities for a week."""
    metrics = db.execute(
        select(
            GarminMetric.kind,
            func.avg(GarminMetric.value),
            func.min(GarminMetric.value),
            func.max(GarminMetric.value),
        )
        .where(
            and_(
                GarminMetric.day >= start,
                GarminMetric.day <= end,
                GarminMetric.value.is_not(None),
            )
        )
        .group_by(GarminMetric.kind)
    ).all()

    activities = db.scalars(
        select(Activity).where(
            and_(
                Activity.start_time
                >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
                Activity.start_time
                < datetime.combine(
                    end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
        )
    ).all()

    metric_summary = {}
    for kind, avg_val, min_val, max_val in metrics:
        metric_summary[kind] = {
            "avg": round(float(avg_val), 1) if avg_val else None,
            "min": round(float(min_val), 1) if min_val else None,
            "max": round(float(max_val), 1) if max_val else None,
        }

    activity_summary = {
        "count": len(activities),
        "total_duration_min": sum((a.duration_s or 0) for a in activities) // 60,
        "total_calories": sum(a.calories or 0 for a in activities),
        "types": list({a.activity_type for a in activities if a.activity_type}),
    }

    return {"metrics": metric_summary, "activities": activity_summary}


def _summarize_mental_week(db: Session, start: date, end: date) -> dict[str, Any]:
    """Summarize mental training entries for a week."""
    entries = db.scalars(
        select(MentalEntry).where(
            and_(MentalEntry.day >= start, MentalEntry.day <= end)
        )
    ).all()
    if not entries:
        return {"entries": 0, "note": "no mental entries"}

    moods = [e.mood_score for e in entries if e.mood_score is not None]
    energies = [e.energy_score for e in entries if e.energy_score is not None]
    focuses = [e.focus_score for e in entries if e.focus_score is not None]
    confidences = [
        e.confidence_score for e in entries if e.confidence_score is not None
    ]

    by_type: dict[str, int] = {}
    for e in entries:
        by_type[e.entry_type] = by_type.get(e.entry_type, 0) + 1

    reflections = [
        e.content[:200] for e in entries if e.content and e.entry_type == "reflection"
    ]

    return {
        "entries": len(entries),
        "by_type": by_type,
        "avg_mood": round(sum(moods) / len(moods), 1) if moods else None,
        "avg_energy": round(sum(energies) / len(energies), 1) if energies else None,
        "avg_focus": round(sum(focuses) / len(focuses), 1) if focuses else None,
        "avg_confidence": round(sum(confidences) / len(confidences), 1)
        if confidences
        else None,
        "reflection_snippets": reflections[:3],
    }


def _summarize_chat_week(db: Session, start: date, end: date) -> dict[str, Any]:
    """Summarize coach chat activity for a week."""
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(
        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
    )

    msgs = db.scalars(
        select(CoachMessage).where(
            and_(CoachMessage.created_at >= start_dt, CoachMessage.created_at < end_dt)
        )
    ).all()

    if not msgs:
        return {"messages": 0, "note": "no chat activity"}

    user_msgs = [m for m in msgs if m.role == "user"]
    assistant_msgs = [m for m in msgs if m.role == "assistant"]

    # Extract key topics from user messages (simple keyword approach)
    topics: dict[str, int] = {}
    keywords = [
        "training",
        "nutrition",
        "recovery",
        "competition",
        "injury",
        "sleep",
        "stress",
        "weight",
        "technique",
    ]
    for m in user_msgs:
        content_lower = m.content.lower()
        for kw in keywords:
            if kw in content_lower:
                topics[kw] = topics.get(kw, 0) + 1

    return {
        "total_messages": len(msgs),
        "user_messages": len(user_msgs),
        "assistant_messages": len(assistant_msgs),
        "topics_mentioned": topics,
    }


DOMAIN_SUMMARIZERS = {
    "training": _summarize_training_week,
    "nutrition": _summarize_nutrition_week,
    "garmin": _summarize_garmin_week,
    "mental": _summarize_mental_week,
    "chat": _summarize_chat_week,
}


# ── main rollup entry points ─────────────────────────────────────────
def generate_weekly_summaries(
    db: Session,
    *,
    cutoff: date | None = None,
    domains: list[str] | None = None,
) -> int:
    """Generate weekly summaries for all data older than RETENTION_DAYS.

    Returns the number of summaries created/updated.
    """
    today = athlete_today()
    cutoff = cutoff or (today - timedelta(days=RETENTION_DAYS))
    domains = domains or list(DOMAIN_SUMMARIZERS.keys())

    count = 0
    for domain in domains:
        summarizer = DOMAIN_SUMMARIZERS.get(domain)
        if not summarizer:
            continue

        # Find the earliest data week that hasn't been summarized yet
        # Walk backwards from cutoff to find weeks needing summaries
        week_end = _week_start(cutoff) - timedelta(
            days=1
        )  # End of the last full week before cutoff
        week_start = week_end - timedelta(days=6)

        # Go back up to 2 years
        earliest = today - timedelta(days=730)

        while week_start >= earliest:
            # Check if summary already exists
            existing = db.scalar(
                select(DataSummary.id).where(
                    and_(
                        DataSummary.domain == domain,
                        DataSummary.period == "week",
                        DataSummary.period_start == week_start,
                    )
                )
            )
            if not existing:
                summary = summarizer(db, week_start, week_end)
                # Skip empty weeks — all "no data" summaries include a "note" key
                if "note" not in summary:
                    _upsert_summary(db, domain, "week", week_start, week_end, summary)
                    count += 1

            week_end = week_start - timedelta(days=1)
            week_start = week_end - timedelta(days=6)

    db.commit()
    return count


def generate_monthly_summaries(
    db: Session,
    *,
    cutoff: date | None = None,
    domains: list[str] | None = None,
) -> int:
    """Generate monthly summaries from weekly summaries.

    Monthly summaries aggregate the weekly summaries for a given month.
    """
    today = athlete_today()
    cutoff = cutoff or (today - timedelta(days=RETENTION_DAYS))
    domains = domains or list(DOMAIN_SUMMARIZERS.keys())

    count = 0
    for domain in domains:
        # Find all months with weekly summaries but no monthly summary
        weeks = db.scalars(
            select(DataSummary)
            .where(
                and_(
                    DataSummary.domain == domain,
                    DataSummary.period == "week",
                    DataSummary.period_start < cutoff,
                )
            )
            .order_by(DataSummary.period_start)
        ).all()

        months_seen: dict[date, list[DataSummary]] = {}
        for w in weeks:
            ms = _month_start(w.period_start)
            months_seen.setdefault(ms, []).append(w)

        for ms, week_summaries in months_seen.items():
            me = _month_end(ms)
            # Check if monthly summary exists
            existing = db.scalar(
                select(DataSummary.id).where(
                    and_(
                        DataSummary.domain == domain,
                        DataSummary.period == "month",
                        DataSummary.period_start == ms,
                    )
                )
            )
            if not existing and len(week_summaries) >= 2:
                monthly = _aggregate_weekly_to_monthly(
                    [w.summary for w in week_summaries], domain
                )
                _upsert_summary(db, domain, "month", ms, me, monthly)
                count += 1

    db.commit()
    return count


def _aggregate_weekly_to_monthly(
    weekly_summaries: list[dict[str, Any]], domain: str
) -> dict[str, Any]:
    """Aggregate weekly summaries into a monthly summary."""
    if domain == "training":
        total_sets = sum(w.get("total_sets", 0) for w in weekly_summaries)
        training_days = sum(w.get("training_days", 0) for w in weekly_summaries)
        all_exercises: dict[str, dict[str, Any]] = {}
        for w in weekly_summaries:
            for ex, data in w.get("exercises", {}).items():
                if ex not in all_exercises:
                    all_exercises[ex] = {"sets": 0, "max_weight": 0, "max_reps": 0}
                all_exercises[ex]["sets"] += data.get("sets", 0)
                all_exercises[ex]["max_weight"] = max(
                    all_exercises[ex]["max_weight"], data.get("max_weight", 0)
                )
                all_exercises[ex]["max_reps"] = max(
                    all_exercises[ex]["max_reps"], data.get("max_reps", 0)
                )
        return {
            "total_sets": total_sets,
            "training_days": training_days,
            "weeks": len(weekly_summaries),
            "exercises": all_exercises,
        }

    elif domain == "nutrition":
        avg_kcals = [
            w.get("avg_daily_kcal", 0)
            for w in weekly_summaries
            if w.get("avg_daily_kcal")
        ]
        avg_proteins = [
            w.get("avg_daily_protein_g", 0)
            for w in weekly_summaries
            if w.get("avg_daily_protein_g")
        ]
        return {
            "weeks": len(weekly_summaries),
            "avg_daily_kcal": round(sum(avg_kcals) / len(avg_kcals), 0)
            if avg_kcals
            else 0,
            "avg_daily_protein_g": round(sum(avg_proteins) / len(avg_proteins), 1)
            if avg_proteins
            else 0,
            "total_days_logged": sum(w.get("days_logged", 0) for w in weekly_summaries),
        }

    elif domain == "garmin":
        all_metrics: dict[str, list[float]] = {}
        total_activities = 0
        total_duration = 0
        for w in weekly_summaries:
            for kind, data in w.get("metrics", {}).items():
                if data.get("avg") is not None:
                    all_metrics.setdefault(kind, []).append(data["avg"])
            acts = w.get("activities", {})
            total_activities += acts.get("count", 0)
            total_duration += acts.get("total_duration_min", 0)
        metric_avgs = {
            k: round(sum(v) / len(v), 1) for k, v in all_metrics.items() if v
        }
        return {
            "weeks": len(weekly_summaries),
            "metric_averages": metric_avgs,
            "total_activities": total_activities,
            "total_duration_min": total_duration,
        }

    elif domain == "mental":
        moods = [
            w.get("avg_mood") for w in weekly_summaries if w.get("avg_mood") is not None
        ]
        energies = [
            w.get("avg_energy")
            for w in weekly_summaries
            if w.get("avg_energy") is not None
        ]
        focuses = [
            w.get("avg_focus")
            for w in weekly_summaries
            if w.get("avg_focus") is not None
        ]
        confidences = [
            w.get("avg_confidence")
            for w in weekly_summaries
            if w.get("avg_confidence") is not None
        ]
        snippets = []
        for w in weekly_summaries:
            snippets.extend(w.get("reflection_snippets", []))
        return {
            "weeks": len(weekly_summaries),
            "total_entries": sum(w.get("entries", 0) for w in weekly_summaries),
            "avg_mood": round(sum(moods) / len(moods), 1) if moods else None,
            "avg_energy": round(sum(energies) / len(energies), 1) if energies else None,
            "avg_focus": round(sum(focuses) / len(focuses), 1) if focuses else None,
            "avg_confidence": round(sum(confidences) / len(confidences), 1)
            if confidences
            else None,
            "reflection_snippets": snippets[:5],
        }

    elif domain == "chat":
        total_user = sum(w.get("user_messages", 0) for w in weekly_summaries)
        all_topics: dict[str, int] = {}
        for w in weekly_summaries:
            for topic, cnt in w.get("topics_mentioned", {}).items():
                all_topics[topic] = all_topics.get(topic, 0) + cnt
        return {
            "weeks": len(weekly_summaries),
            "total_user_messages": total_user,
            "total_messages": sum(w.get("total_messages", 0) for w in weekly_summaries),
            "top_topics": dict(sorted(all_topics.items(), key=lambda x: -x[1])[:10]),
        }

    # Fallback: merge all weekly dicts
    return {"weeks": len(weekly_summaries), "data": weekly_summaries}


def purge_old_detailed_data(
    db: Session,
    *,
    cutoff: date | None = None,
) -> dict[str, int]:
    """Delete detailed records older than RETENTION_DAYS that have been summarized.

    INTENTIONALLY UNWIRED: not called by the summarization worker or any API
    route. Per the reliability rework, raw data is kept indefinitely —
    summaries are for fast trend queries, not a license to delete detail.
    Retained here only in case a deliberate, manually-invoked cleanup is
    ever needed; do not schedule or expose this without reconsidering that
    decision first.

    Only deletes data where a corresponding weekly summary exists.
    Returns counts of deleted rows per domain.
    """
    today = athlete_today()
    cutoff = cutoff or (today - timedelta(days=RETENTION_DAYS))
    deleted: dict[str, int] = {}

    # Check that summaries exist before deleting
    has_summaries = db.scalar(
        select(func.count(DataSummary.id)).where(
            and_(DataSummary.period == "week", DataSummary.period_end < cutoff)
        )
    )
    if not has_summaries:
        return deleted

    # Training
    result = db.execute(delete(WorkoutLog).where(WorkoutLog.day < cutoff))
    deleted["training"] = result.rowcount

    # Nutrition
    result = db.execute(delete(NutritionLog).where(NutritionLog.day < cutoff))
    deleted["nutrition"] = result.rowcount

    # Mental
    result = db.execute(delete(MentalEntry).where(MentalEntry.day < cutoff))
    deleted["mental"] = result.rowcount

    db.commit()
    return deleted


def get_summaries(
    db: Session,
    domain: str | None = None,
    period: str | None = None,
    limit: int = 52,
) -> list[DataSummary]:
    """Retrieve stored summaries for context builder or API."""
    stmt = select(DataSummary)
    if domain:
        stmt = stmt.where(DataSummary.domain == domain)
    if period:
        stmt = stmt.where(DataSummary.period == period)
    return list(
        db.scalars(stmt.order_by(DataSummary.period_start.desc()).limit(limit)).all()
    )
