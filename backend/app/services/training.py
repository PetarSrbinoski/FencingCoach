"""Adaptive gym session generator + progressive-overload tracking.

Tuesdays = strength/unilateral block; Thursdays = power/explosive block.
The session is *generated* deterministically from rules, not the LLM —
it's a small, constrained domain and we want predictable progression.

Inputs that move the prescription:
  - phase (general|build|peak|taper|comp_week|recovery)
  - readiness band (red|amber|green) — auto-deload on red
  - last logged best for the same exercise (load/reps) → next prescription
  - days to next A-event — short-circuits to deload near comp

Output: a list of `ExerciseRx` objects (target sets/reps/load/RPE +
notes). The frontend presents these and accepts logging back into
`workout_log`. 1RM is estimated via Epley (reps ≤ 10).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import athlete_today
from app.models import WorkoutLog
from app.services.periodization import compute_phase
from app.services.readiness import compute_readiness
from app.services.schedule import weekly_schedule


# ── templates ─────────────────────────────────────────────────────────
@dataclass
class ExerciseRx:
    exercise: str
    sets: int
    reps: int
    load_kg: float | None  # None = bodyweight or %1RM-derived later
    target_rpe: float
    intent: str  # "strength" | "power" | "hypertrophy" | "skill"
    notes: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Tuesday — strength / unilateral
TUE_TEMPLATE: list[dict[str, Any]] = [
    {
        "exercise": "Trap Bar Deadlift",
        "sets": 4,
        "reps": 5,
        "intent": "strength",
        "rpe": 8.0,
        "pct1rm": 0.82,
    },
    {
        "exercise": "Bulgarian Split Squat",
        "sets": 3,
        "reps": 8,
        "intent": "strength",
        "rpe": 8.0,
        "pct1rm": 0.70,
    },
    {
        "exercise": "Isometric Lunge Hold",
        "sets": 3,
        "reps": 30,
        "intent": "skill",
        "rpe": 7.0,
        "pct1rm": None,
        "notes": "30s hold per leg",
    },
    {
        "exercise": "Weighted Pull-Up",
        "sets": 4,
        "reps": 5,
        "intent": "strength",
        "rpe": 8.0,
        "pct1rm": 0.82,
    },
    {
        "exercise": "DB Pronation/Supination",
        "sets": 3,
        "reps": 12,
        "intent": "skill",
        "rpe": 7.0,
        "pct1rm": None,
        "notes": "Slow eccentric — flick wrist control",
    },
    {
        "exercise": "Skull Crusher",
        "sets": 3,
        "reps": 10,
        "intent": "hypertrophy",
        "rpe": 8.0,
        "pct1rm": 0.65,
    },
]

# Thursday — power / explosive
THU_TEMPLATE: list[dict[str, Any]] = [
    {
        "exercise": "Hang Power Clean",
        "sets": 5,
        "reps": 3,
        "intent": "power",
        "rpe": 7.5,
        "pct1rm": 0.70,
    },
    {
        "exercise": "Depth Jump",
        "sets": 5,
        "reps": 4,
        "intent": "power",
        "rpe": 8.0,
        "pct1rm": None,
        "notes": "30-40 cm box; full reset between reps",
    },
    {
        "exercise": "Incline Bench Press",
        "sets": 4,
        "reps": 6,
        "intent": "strength",
        "rpe": 8.0,
        "pct1rm": 0.78,
    },
    {
        "exercise": "Lateral Bound",
        "sets": 4,
        "reps": 6,
        "intent": "power",
        "rpe": 8.0,
        "pct1rm": None,
        "notes": "3 per side; stick the landing",
    },
    {
        "exercise": "Farmer's Carry",
        "sets": 3,
        "reps": 30,
        "intent": "skill",
        "rpe": 8.0,
        "pct1rm": None,
        "notes": "30 m / set, heavy",
    },
    {
        "exercise": "Biceps Curl",
        "sets": 3,
        "reps": 10,
        "intent": "hypertrophy",
        "rpe": 8.0,
        "pct1rm": 0.65,
    },
]


# ── phase / readiness modifiers ───────────────────────────────────────
PHASE_VOLUME_MOD = {
    "general": 1.00,
    "build": 1.00,
    "peak": 0.85,
    "taper": 0.65,
    "comp_week": 0.40,
    "recovery": 0.50,
}
PHASE_INTENSITY_MOD = {  # multiplies pct1rm
    "general": 1.00,
    "build": 1.03,
    "peak": 1.05,
    "taper": 1.00,
    "comp_week": 0.85,
    "recovery": 0.80,
}

READINESS_VOLUME_MOD = {"red": 0.5, "amber": 0.85, "green": 1.0, "unknown": 1.0}
READINESS_INTENSITY_MOD = {"red": 0.85, "amber": 0.95, "green": 1.0, "unknown": 1.0}


# ── 1RM tools ─────────────────────────────────────────────────────────
def epley_1rm(weight_kg: float, reps: int) -> float | None:
    if not weight_kg or reps <= 0 or reps > 12:
        return None
    return weight_kg * (1 + reps / 30.0)


def best_recent_1rm(db: Session, exercise: str, lookback_days: int = 60) -> float | None:
    since = athlete_today() - timedelta(days=lookback_days)
    rows = db.scalars(
        select(WorkoutLog).where(
            and_(
                WorkoutLog.exercise == exercise,
                WorkoutLog.day >= since,
                WorkoutLog.weight_kg.is_not(None),
                WorkoutLog.reps.is_not(None),
            )
        )
    ).all()
    best: float | None = None
    for r in rows:
        if r.weight_kg is None or r.reps is None:
            continue
        est = epley_1rm(float(r.weight_kg), int(r.reps))
        if est is not None and (best is None or est > best):
            best = est
    return best


def detect_plateau(db: Session, exercise: str, weeks: int = 4) -> dict[str, Any]:
    """Compare best estimated 1RM in the most recent `weeks` window vs
    the prior `weeks` window. <2% improvement → plateau."""
    today = athlete_today()
    cur_start = today - timedelta(weeks=weeks)
    prev_start = today - timedelta(weeks=2 * weeks)

    def _best(start: date, end: date) -> float | None:
        rows = db.scalars(
            select(WorkoutLog).where(
                and_(
                    WorkoutLog.exercise == exercise,
                    WorkoutLog.day >= start,
                    WorkoutLog.day < end,
                    WorkoutLog.weight_kg.is_not(None),
                    WorkoutLog.reps.is_not(None),
                )
            )
        ).all()
        best = None
        for r in rows:
            if r.weight_kg is None or r.reps is None:
                continue
            est = epley_1rm(float(r.weight_kg), int(r.reps))
            if est and (best is None or est > best):
                best = est
        return best

    cur = _best(cur_start, today)
    prev = _best(prev_start, cur_start)
    if cur is None or prev is None:
        return {
            "plateau": False,
            "reason": "insufficient history",
            "cur": cur,
            "prev": prev,
        }
    delta = (cur - prev) / prev
    return {
        "plateau": delta < 0.02,
        "delta_pct": round(delta * 100, 1),
        "cur": round(cur, 1),
        "prev": round(prev, 1),
        "reason": "<2% over 4 weeks" if delta < 0.02 else "progressing",
    }


# ── session builder ───────────────────────────────────────────────────
# Gym-day weekdays come from the shared weekly schedule (single source of
# truth — app.services.schedule); the two exercise templates alternate
# across those gym days in weekday order (cycling if there are ever more
# than two configured gym days per week).
_GYM_TEMPLATES: list[tuple[str, list[dict[str, Any]]]] = [
    ("strength_unilateral", TUE_TEMPLATE),
    ("power_explosive", THU_TEMPLATE),
]


def _template_for(day: date) -> tuple[str, list[dict[str, Any]]] | None:
    gym_weekdays = sorted(wd for wd, t in weekly_schedule().items() if t == "gym")
    if day.weekday() not in gym_weekdays:
        return None
    idx = gym_weekdays.index(day.weekday()) % len(_GYM_TEMPLATES)
    return _GYM_TEMPLATES[idx]


def build_session(db: Session, day: date | None = None) -> dict[str, Any]:
    """Return today's gym session, or `{"session": None, ...}` on non-gym days."""
    day = day or athlete_today()
    tpl = _template_for(day)
    phase = compute_phase(db, day)
    readiness = compute_readiness(db, day)

    if tpl is None:
        return {
            "day": day.isoformat(),
            "weekday": day.strftime("%A"),
            "session": None,
            "phase": phase.to_dict(),
            "readiness": {"score": readiness.score, "band": readiness.band},
            "reason": "Not a gym day per the configured weekly schedule.",
        }

    session_name, items = tpl
    vol_mod = PHASE_VOLUME_MOD[phase.name] * READINESS_VOLUME_MOD[readiness.band]
    int_mod = PHASE_INTENSITY_MOD[phase.name] * READINESS_INTENSITY_MOD[readiness.band]

    rx_list: list[ExerciseRx] = []
    for item in items:
        sets = max(1, round(item["sets"] * vol_mod))
        reps = item["reps"]
        intent = item["intent"]
        rpe = round(item["rpe"] - (1.0 if readiness.band == "red" else 0.0), 1)

        load_kg: float | None = None
        notes_bits: list[str] = []
        if item.get("notes"):
            notes_bits.append(item["notes"])

        if item.get("pct1rm") is not None:
            best = best_recent_1rm(db, item["exercise"])
            if best is not None:
                load_kg = round(best * item["pct1rm"] * int_mod / 2.5) * 2.5
                notes_bits.append(f"≈ {item['pct1rm'] * int_mod:.0%} of est 1RM {best:.0f} kg")
            else:
                notes_bits.append("No 1RM history — start moderate, leave 2-3 reps in reserve.")

        rx_list.append(
            ExerciseRx(
                exercise=item["exercise"],
                sets=sets,
                reps=reps,
                load_kg=load_kg,
                target_rpe=rpe,
                intent=intent,
                notes="; ".join(notes_bits),
            )
        )

    readiness_score_text = f"{readiness.score:.0f}" if readiness.score is not None else "n/a"
    rationale = (
        f"Phase={phase.name} (vol×{PHASE_VOLUME_MOD[phase.name]:.2f}, "
        f"int×{PHASE_INTENSITY_MOD[phase.name]:.2f}); "
        f"readiness={readiness.band} {readiness_score_text} "
        f"(vol×{READINESS_VOLUME_MOD[readiness.band]:.2f}, int×{READINESS_INTENSITY_MOD[readiness.band]:.2f})."
    )

    return {
        "day": day.isoformat(),
        "weekday": day.strftime("%A"),
        "session": {
            "name": session_name,
            "exercises": [r.to_dict() for r in rx_list],
            "rationale": rationale,
        },
        "phase": phase.to_dict(),
        "readiness": {"score": readiness.score, "band": readiness.band},
    }
