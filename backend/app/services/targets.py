"""Periodized nutrition target engine.

Computes daily kcal + macro + micro targets from:
  - athlete weight (default 80 kg if profile not set)
  - day type (rest / gym / fencing / double / competition)
  - phase (general / build / peak / taper / comp_week / recovery)
  - body-comp goal (lean / maintain / gain) — slight kcal dial

Carbs are the periodized lever. Protein stays in 2.0-2.4 g/kg. Fat fills
the energy gap with a 1 g/kg floor.

Day-type detection uses the athlete's default weekly pattern:
    Mon/Wed/Fri/Sat → fencing
    Tue/Thu         → gym
    Sun             → rest
…overridden by competitions on that day, and overridden by activities
already logged for the day if they imply something different (e.g. an
unscheduled gym session).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import Activity, AthleteProfile, Competition, DayTypeOverride
from app.services.activity_types import is_fencing, is_strength
from app.services.periodization import Phase, compute_phase

DEFAULT_WEIGHT_KG = 89.0
DEFAULT_BODY_COMP = "lean"

# Carbs g/kg by day type — base values, then phase-adjusted
CARB_BY_DAYTYPE = {
    "rest": 3.5,
    "gym": 5.0,
    "fencing": 6.0,
    "double": 7.0,  # gym + fencing
    "competition": 9.0,
}

# Phase carb modifier (multiplicative)
PHASE_CARB_MOD = {
    "general": 1.00,
    "build": 1.05,
    "peak": 1.10,
    "taper": 1.10,  # carb-up trend
    "comp_week": 1.20,
    "recovery": 0.90,
}

# Body-comp goal kcal dial (multiplicative on total kcal)
GOAL_KCAL_MOD = {
    "lean": 0.95,  # slight deficit
    "maintain": 1.00,
    "gain": 1.10,
}

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

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "day": self.day.isoformat()}


# ── helpers ───────────────────────────────────────────────────────────
def _athlete_weight(db: Session) -> float:
    p = db.scalar(select(AthleteProfile).limit(1))
    return float(p.weight_kg) if p and p.weight_kg else DEFAULT_WEIGHT_KG


def _athlete_goal(db: Session) -> str:
    p = db.scalar(select(AthleteProfile).limit(1))
    if p and p.body_comp_goal:
        g = p.body_comp_goal.lower()
        if "gain" in g:
            return "gain"
        if "lean" in g or "cut" in g or "fat" in g:
            return "lean"
    return DEFAULT_BODY_COMP


VALID_DAY_TYPES = {"rest", "gym", "fencing", "double", "competition"}


def detect_day_type(db: Session, day: date) -> tuple[str, str]:
    """Heuristic. Returns (day_type, source) where source is 'auto' or 'manual'."""
    # Check for manual override first
    override = db.scalar(
        select(DayTypeOverride).where(DayTypeOverride.day == day).limit(1)
    )
    if override is not None and override.override_type in VALID_DAY_TYPES:
        return override.override_type, "manual"

    # Competition on this day?
    comp = db.scalar(select(Competition).where(Competition.event_date == day).limit(1))
    if comp is not None:
        return "competition", "auto"

    # Default pattern: Mon=0..Sun=6
    weekday = day.weekday()
    default = {
        0: "fencing",  # Mon
        1: "gym",  # Tue
        2: "fencing",  # Wed
        3: "gym",  # Thu
        4: "fencing",  # Fri
        5: "fencing",  # Sat
        6: "rest",  # Sun
    }[weekday]

    # Look at logged activities for this day to upgrade if needed.
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    rows = db.scalars(
        select(Activity).where(
            and_(Activity.start_time >= start, Activity.start_time < end)
        )
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

    # Protein: 2.2 g/kg base; +0.1 in build/peak; floor 2.0, ceiling 2.5
    protein_per_kg = 2.2
    if phase.name in ("build", "peak"):
        protein_per_kg = 2.3
    elif phase.name == "recovery":
        protein_per_kg = 2.4
    protein_g = round(weight * protein_per_kg, 1)

    # Carbs: from day-type base × phase modifier
    base_c = CARB_BY_DAYTYPE.get(day_type, 4.0)
    carb_per_kg = base_c * PHASE_CARB_MOD.get(phase.name, 1.0)
    carbs_g = round(weight * carb_per_kg, 1)

    # Fat: 1 g/kg floor; we'll compute kcal from macros and recheck
    fat_per_kg = 1.0
    fat_g = round(weight * fat_per_kg, 1)

    # Energy
    kcal_macros = protein_g * 4 + carbs_g * 4 + fat_g * 9
    # Target maintenance ≈ 38 kcal/kg for an active fencer; adjust by goal.
    maintenance = weight * 38.0
    target_kcal = maintenance * GOAL_KCAL_MOD.get(goal, 1.0)

    # If macro-derived kcal < target, raise fat to fill; if > target, leave it (lean preference)
    if kcal_macros < target_kcal:
        gap = target_kcal - kcal_macros
        fat_g = round(fat_g + gap / 9.0, 1)
        kcal_macros = protein_g * 4 + carbs_g * 4 + fat_g * 9

    notes = (
        f"day={day_type}, phase={phase.name}, "
        f"P {protein_per_kg:.1f} g/kg, C {carb_per_kg:.1f} g/kg (base {base_c} × {PHASE_CARB_MOD.get(phase.name, 1.0)}), "
        f"goal={goal}"
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
    )
