"""Periodized nutrition target engine — computes daily kcal/macro/micro
targets from athlete weight, day type, phase, and body-comp goal, preferring
measured Garmin expenditure over a formula estimate for maintenance kcal.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import (
    Activity,
    AthleteProfile,
    Competition,
    CompetitionNutritionPlan,
    DayTypeOverride,
    GarminMetric,
    NutritionTargetAssignment,
)
from app.services.activity_types import is_fencing, is_strength
from app.services.periodization import Phase, compute_phase
from app.services.schedule import VALID_DAY_TYPES as _VALID_DAY_TYPES
from app.services.schedule import day_type_for_weekday

DEFAULT_WEIGHT_KG = 89.0
DEFAULT_BODY_COMP = "performance"
POLICY_VERSION = "daily-2026-09-v1"

# Rolling window + minimum data requirement for trusting Garmin-measured
# expenditure over the formula fallback. "Today" is excluded since it's
# usually incomplete mid-day.
GARMIN_MAINTENANCE_WINDOW_DAYS = 14
MIN_GARMIN_DAYS_FOR_MAINTENANCE = 5
FORMULA_KCAL_PER_KG = 38.0  # active-fencer estimate, used only as fallback

# Carbs g/kg by day type — base values, then phase-adjusted
CARB_BY_DAYTYPE = {
    "rest": 3.0,
    "gym": 4.0,
    "fencing": 5.0,
    "double": 6.0,
    "competition": 6.0,
}

# Phase carb modifier (multiplicative)
PHASE_CARB_MOD = {
    "general": 1.00,
    "build": 1.00,
    "peak": 1.00,
    "taper": 1.00,
    "comp_week": 1.00,
    "recovery": 1.00,
}

# Body-comp goal kcal dial (multiplicative on total kcal)
GOAL_KCAL_MOD = {
    "performance": 1.00,
    "maintain": 1.00,
    "cutting": 0.95,
    "lean_bulk": 1.05,
    "recomp": 1.00,
}
GOAL_ALIASES = {"lean": "cutting", "cut": "cutting", "gain": "lean_bulk"}

# Athletic micro targets (per day, baseline; not all comprehensive)
MICRO_TARGETS = {
    "iron_mg": 18.0,
    "vitamin_d_iu": 2000.0,
    "b12_mcg": 4.0,
    "magnesium_mg": 400.0,
    "zinc_mg": 12.0,
    "omega3_g": 2.0,
    "fiber_g": 35.0,
}


@dataclass
class NutritionTargets:
    day: date
    day_type: str
    phase: str
    weight_kg: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    micros: dict[str, float]
    notes: str
    override_source: str = "auto"
    goal: str = DEFAULT_BODY_COMP
    baseline_kcal: float = 0.0
    requested_kcal: float = 0.0
    baseline_source: str = "formula"
    data_cutoff: str = ""
    policy_version: str = POLICY_VERSION
    energy_conflict: str | None = None
    target_source: str = "ordinary"
    plan_id: int | None = None
    plan_version: int | None = None
    needs_review: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "day": self.day.isoformat()}


# ── helpers ───────────────────────────────────────────────────────────
def _athlete_weight(db: Session) -> float:
    p = db.scalar(select(AthleteProfile).limit(1))
    if p is None or p.weight_kg is None or not 30 <= p.weight_kg <= 300:
        raise ValueError("Confirm a valid body weight (30–300 kg) in Profile before using personalized targets")
    return float(p.weight_kg)


def _maintenance_kcal(db: Session, day: date, weight: float) -> tuple[float, str]:
    """Rolling-average Garmin-measured expenditure, formula-only fallback.

    Returns (maintenance_kcal, source_detail).
    """
    end = min(day - timedelta(days=1), athlete_today() - timedelta(days=1))
    start = end - timedelta(days=GARMIN_MAINTENANCE_WINDOW_DAYS - 1)
    rows = db.execute(
        select(GarminMetric.value).where(
            and_(
                GarminMetric.kind == "calories",
                GarminMetric.status == "ok",
                GarminMetric.day >= start,
                GarminMetric.day <= end,
                GarminMetric.value.is_not(None),
            )
        )
    ).all()
    values = [float(r[0]) for r in rows]
    if len(values) >= MIN_GARMIN_DAYS_FOR_MAINTENANCE:
        avg = sum(values) / len(values)
        return avg, f"garmin {len(values)}d rolling avg ({avg:.0f} kcal)"
    formula = weight * FORMULA_KCAL_PER_KG
    return (
        formula,
        f"formula {FORMULA_KCAL_PER_KG:.0f} kcal/kg "
        f"(only {len(values)}/{MIN_GARMIN_DAYS_FOR_MAINTENANCE} Garmin days available)",
    )


def _athlete_goal(db: Session) -> str:
    p = db.scalar(select(AthleteProfile).limit(1))
    if p and p.body_comp_goal:
        g = p.body_comp_goal.strip().lower()
        g = GOAL_ALIASES.get(g, g)
        if g not in GOAL_KCAL_MOD:
            raise ValueError(f"Unknown body-composition goal '{p.body_comp_goal}'; choose a supported goal in Profile")
        return g
    return DEFAULT_BODY_COMP


VALID_DAY_TYPES = _VALID_DAY_TYPES  # re-exported for backward compat (app.api.targets)


def detect_day_type(db: Session, day: date) -> tuple[str, str]:
    """Heuristic. Returns (day_type, source) where source is 'auto' or 'manual'."""
    # Check for manual override first
    override = db.scalar(select(DayTypeOverride).where(DayTypeOverride.day == day).limit(1))
    if override is not None and override.override_type in VALID_DAY_TYPES:
        return override.override_type, "manual"

    # Competition on this day?
    comp = db.scalar(select(Competition).where(
        Competition.event_date <= day,
        or_(Competition.end_date >= day,
            and_(Competition.end_date.is_(None), Competition.event_date == day)),
    ).limit(1))
    if comp is not None:
        return "competition", "auto"

    # Default pattern from the single-source weekly schedule (Mon=0..Sun=6)
    default = day_type_for_weekday(day.weekday())

    # Look at logged activities for this day to upgrade if needed.
    start = datetime.combine(day, time.min, tzinfo=UTC)
    end = start + timedelta(days=1)
    rows = db.scalars(
        select(Activity).where(and_(Activity.start_time >= start, Activity.start_time < end))
    ).all()
    if not rows:
        return default, "auto"

    types = {(a.activity_type or "").lower() for a in rows}
    has_strength = any(is_strength(t) for t in types)
    has_fencing = any(is_fencing(t) for t in types)

    if default in ("fencing", "rest") and has_strength:
        return ("double" if default == "fencing" else "gym"), "auto"
    if default == "gym" and has_fencing:
        return "double", "auto"
    return default, "auto"


# ── public api ────────────────────────────────────────────────────────
def compute_targets(db: Session, day: date | None = None) -> NutritionTargets:
    day = day or athlete_today()
    weight = _athlete_weight(db)
    goal = _athlete_goal(db)
    phase: Phase = compute_phase(db, day)
    day_type, override_source = detect_day_type(db, day)

    # Policy ranges: P 1.8–2.0, C 3–6, F 0.8–1.5 g/kg.
    # Daily energy follows macros; an incompatible goal is disclosed below.
    protein_per_kg = 2.0 if goal in ("cutting", "recomp") else 1.8
    protein_g = round(weight * protein_per_kg, 1)

    # Carbs: from day-type base × phase modifier
    base_c = CARB_BY_DAYTYPE.get(day_type, 4.0)
    carb_per_kg = base_c * PHASE_CARB_MOD.get(phase.name, 1.0)
    carbs_g = round(weight * carb_per_kg, 1)

    fat_per_kg = 0.8
    fat_g = round(weight * fat_per_kg, 1)

    maintenance, maintenance_source = _maintenance_kcal(db, day, weight)
    requested_kcal = round(maintenance * GOAL_KCAL_MOD[goal])
    kcal_macros = protein_g * 4 + carbs_g * 4 + fat_g * 9
    gap = max(0, requested_kcal - kcal_macros)
    fat_g = round(min(weight * 1.5, fat_g + gap / 9), 1)
    kcal_macros = protein_g * 4 + carbs_g * 4 + fat_g * 9
    gap = max(0, requested_kcal - kcal_macros)
    carbs_g = round(min(weight * (base_c + 1.0), carbs_g + gap / 4), 1)
    kcal_macros = protein_g * 4 + carbs_g * 4 + fat_g * 9
    conflict = None
    if abs(kcal_macros - requested_kcal) > 5:
        conflict = ("Training carbohydrate, protein, and fat bounds take priority over the "
                    f"{requested_kcal:.0f} kcal goal; the macro total is {kcal_macros:.0f} kcal.")

    notes = (
        f"day={day_type}, phase={phase.name}, "
        f"P {protein_per_kg:.1f} g/kg, C {carb_per_kg:.1f} g/kg (base {base_c} × {PHASE_CARB_MOD.get(phase.name, 1.0)}), "
        f"goal={goal}, maintenance={maintenance_source}; policy={POLICY_VERSION}"
    )

    return NutritionTargets(
        day=day,
        day_type=day_type,
        phase=phase.name,
        weight_kg=weight,
        kcal=round(kcal_macros, 0),
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
        fiber_g=MICRO_TARGETS["fiber_g"],
        micros={k: v for k, v in MICRO_TARGETS.items() if k != "fiber_g"},
        notes=notes,
        override_source=override_source,
        goal=goal,
        baseline_kcal=round(maintenance),
        requested_kcal=requested_kcal,
        baseline_source="garmin" if maintenance_source.startswith("garmin") else "formula",
        data_cutoff=min(day - timedelta(days=1), athlete_today() - timedelta(days=1)).isoformat(),
        energy_conflict=conflict,
    )


def resolve_effective_targets(db: Session, day: date | None = None) -> NutritionTargets:
    """Return the one accepted dated snapshot, or the current ordinary policy."""
    day = day or athlete_today()
    assignment = db.get(NutritionTargetAssignment, day)
    if assignment is None:
        return compute_targets(db, day)
    payload = dict(assignment.targets)
    payload["day"] = day
    plan = db.get(CompetitionNutritionPlan, assignment.plan_id)
    if plan is not None:
        event = db.get(Competition, plan.event_id)
        profile = db.scalar(select(AthleteProfile).limit(1))
        snapshot = plan.input_snapshot
        event_snapshot = plan.event_snapshot
        saved_training = next((row for row in snapshot.get("training", []) if row.get("day") == day.isoformat()), None)
        current_training = None
        if saved_training is not None:
            from app.models import WorkoutOverride
            from app.services.training import build_session
            current = build_session(db, day)
            override = db.get(WorkoutOverride, day)
            current_training = {"day": day.isoformat(), "session": current["session"],
                                "activity_type": current["activity_type"], "source": current["source"],
                                "workout_revision": override.revision if override else None}
        payload["needs_review"] = (
            event is None
            or event.event_date.isoformat() != event_snapshot["event_date"]
            or (event.end_date or event.event_date).isoformat() != event_snapshot["end_date"]
            or event.priority != event_snapshot["priority"]
            or profile is None
            or profile.weight_kg != snapshot.get("profile_weight_kg")
            or profile.body_comp_goal != snapshot.get("profile_goal")
            or (saved_training is not None and current_training != saved_training)
        )
    return NutritionTargets(**payload)
