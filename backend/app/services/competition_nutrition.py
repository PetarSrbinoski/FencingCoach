"""Deterministic competition nutrition timeline; see docs/nutrition-policy.md."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import (
    AthleteProfile,
    Competition,
    CompetitionNutritionPlan,
    GarminMetric,
    NutritionTargetAssignment,
    WorkoutOverride,
)
from app.services.targets import compute_targets
from app.services.training import build_session

POLICY_VERSION = "competition-2026-09-v1"
EVENT_CARBS = {"low": 5.0, "moderate": 6.0, "high": 7.0}
PREP_CARBS = {"moderate": {2: 3.5, 1: 4.0}, "high": {2: 4.0, 1: 4.5}}


def preview(db: Session, event: Competition, inputs: dict[str, Any]) -> dict[str, Any]:
    end = event.end_date or event.event_date
    start = event.event_date - timedelta(days=7)
    finish = end + timedelta(days=1)
    competing = db.scalars(select(Competition).where(
        Competition.id != event.id,
        Competition.event_date <= finish,
        or_(Competition.end_date >= start,
            and_(Competition.end_date.is_(None), Competition.event_date >= start)),
    ).order_by(Competition.event_date)).all()
    competing_events = [{"id": c.id, "name": c.name, "event_date": c.event_date.isoformat(),
                         "end_date": (c.end_date or c.event_date).isoformat()} for c in competing]
    if competing_events and not inputs.get("resolve_overlaps"):
        raise ValueError("Other competition contexts overlap this timeline. Confirm this event as the effective context before previewing.")

    demand = inputs["expected_demand"]
    days: list[dict[str, Any]] = []
    training_snapshots: list[dict[str, Any]] = []
    current = start
    while current <= finish:
        ordinary = compute_targets(db, current)
        training = build_session(db, current)
        workout = db.get(WorkoutOverride, current)
        training_snapshots.append({"day": current.isoformat(), "session": training["session"],
                                   "activity_type": training["activity_type"], "source": training["source"],
                                   "workout_revision": workout.revision if workout else None})
        previous = db.get(NutritionTargetAssignment, current)
        until = (event.event_date - current).days
        if event.event_date <= current <= end:
            context = "event"
            carbs = round(ordinary.weight_kg * EVENT_CARBS[demand], 1)
        elif current == finish:
            context = "recovery"
            floor = 4.0 if demand == "high" else 0.0
            carbs = max(ordinary.carbs_g, round(ordinary.weight_kg * floor, 1))
        elif until in (1, 2) and demand in PREP_CARBS:
            context = "preparation"
            carbs = max(ordinary.carbs_g,
                        round(ordinary.weight_kg * PREP_CARBS[demand][until], 1))
        else:
            context = "ordinary"
            carbs = ordinary.carbs_g
        kcal = round(ordinary.protein_g * 4 + carbs * 4 + ordinary.fat_g * 9)
        conflict = None
        if abs(kcal - ordinary.requested_kcal) > 5:
            conflict = ("Event or training macro priority changes energy from the "
                        f"{ordinary.requested_kcal:.0f} kcal goal to {kcal} kcal.")
        days.append({
            "day": current.isoformat(), "context": context,
            "weight_kg": ordinary.weight_kg, "day_type": ordinary.day_type,
            "phase": ordinary.phase, "override_source": ordinary.override_source,
            "micros": ordinary.micros, "baseline_kcal": ordinary.baseline_kcal,
            "requested_kcal": ordinary.requested_kcal,
            "training_type": training["activity_type"], "training_source": training["source"],
            "session_name": training["session"]["name"] if training["session"] else None,
            "countdown_days": until if until >= 0 else -(current - end).days,
            "kcal": kcal, "protein_g": ordinary.protein_g, "carbs_g": carbs,
            "fat_g": ordinary.fat_g, "fiber_g": ordinary.fiber_g,
            "ordinary_kcal": ordinary.kcal, "ordinary_carbs_g": ordinary.carbs_g,
            "baseline_source": ordinary.baseline_source, "data_cutoff": ordinary.data_cutoff,
            "goal": ordinary.goal, "energy_conflict": conflict,
            "provisional": current > athlete_today(),
            "existing_plan_id": previous.plan_id if previous else None,
            "existing_targets": previous.targets if previous else None,
            "explanation": ("Event demand sets one carbohydrate target" if context == "event" else
                            "Preparation raises carbohydrate only when the ordinary target is lower" if context == "preparation" else
                            "Initial recovery carbohydrate floor" if context == "recovery" else
                            "Ordinary daily policy"),
        })
        current += timedelta(days=1)

    event_snapshot = {"id": event.id, "name": event.name, "event_date": event.event_date.isoformat(),
                      "end_date": end.isoformat(), "priority": event.priority,
                      "location": event.location, "notes": event.notes, "revision": event.revision}
    profile = db.scalar(select(AthleteProfile).limit(1))
    metric_fetch = db.scalar(select(GarminMetric.fetched_at).where(
        GarminMetric.kind == "calories", GarminMetric.status == "ok",
    ).order_by(GarminMetric.fetched_at.desc()).limit(1))
    result = {
        "event": event_snapshot, "inputs": inputs, "days": days,
        "policy_version": POLICY_VERSION, "competing_events": competing_events,
        "assumptions": (["Event start time is unknown; venue time is not treated as continuous exercise"]
                        if not inputs.get("start_time") else []),
        "input_snapshot": {
            "profile_weight_kg": profile.weight_kg if profile else None,
            "profile_goal": profile.body_comp_goal if profile else None,
            "profile_updated_at": profile.updated_at.isoformat() if profile and profile.updated_at else None,
            "training": training_snapshots,
            "last_calorie_fetch": metric_fetch.isoformat() if metric_fetch else None,
        },
    }
    result["token"] = hashlib.sha256(json.dumps(result, sort_keys=True, default=str).encode()).hexdigest()
    return result


def stage_accepted_plan(db: Session, draft: dict[str, Any], acceptance_id: str) -> tuple[CompetitionNutritionPlan, list[dict[str, Any]], list[dict[str, Any]]]:
    """Stage assignments and immutable plan history; caller owns the commit."""
    event_id = draft["event"]["id"]
    version = (db.scalar(select(func.max(CompetitionNutritionPlan.version)).where(
        CompetitionNutritionPlan.event_id == event_id)) or 0) + 1
    plan = CompetitionNutritionPlan(
        event_id=event_id, event_snapshot=draft["event"], inputs=draft["inputs"],
        input_snapshot=draft["input_snapshot"], days=draft["days"],
        policy_version=draft["policy_version"], preview_token=draft["token"],
        acceptance_id=acceptance_id, version=version, active=True,
    )
    db.add(plan)
    db.flush()
    before: list[dict[str, Any]] = []
    after: list[dict[str, Any]] = []
    for row in draft["days"]:
        day = date.fromisoformat(row["day"])
        if day < athlete_today():
            continue
        previous = db.get(NutritionTargetAssignment, day)
        before.append({"day": row["day"], "plan_id": previous.plan_id if previous else None,
                       "targets": previous.targets if previous else None})
        targets = {
            "day": row["day"], "day_type": row["day_type"], "phase": row["phase"],
            "weight_kg": row["weight_kg"], "kcal": row["kcal"],
            "protein_g": row["protein_g"], "carbs_g": row["carbs_g"],
            "fat_g": row["fat_g"], "fiber_g": row["fiber_g"], "micros": row["micros"],
            "notes": row["explanation"], "override_source": row["override_source"],
            "goal": row["goal"], "baseline_kcal": row["baseline_kcal"],
            "requested_kcal": row["requested_kcal"],
            "baseline_source": row["baseline_source"], "data_cutoff": row["data_cutoff"],
            "policy_version": draft["policy_version"], "energy_conflict": row["energy_conflict"],
            "target_source": "accepted", "plan_id": plan.id, "plan_version": plan.version,
        }
        db.merge(NutritionTargetAssignment(day=day, plan_id=plan.id, targets=targets))
        after.append({"day": row["day"], "plan_id": plan.id, "targets": targets})
    db.flush()
    return plan, before, after
