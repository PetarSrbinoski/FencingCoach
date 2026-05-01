"""LLM-driven meal-plan and shopping-list generators.

`generate_day_plan` builds a single-day plan that hits the day's targets
and respects training timing (gym daytime vs fencing 20:00). It returns
a structured JSON blob persisted to `nutrition_plans` keyed by day.

`build_shopping_list` aggregates ingredients across N existing day plans
into a deduplicated, quantity-totaled list. This is pure code, not LLM.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import NutritionPlan
from app.services.llm import get_llm
from app.services.targets import NutritionTargets, compute_targets

log = logging.getLogger(__name__)


MEALPLAN_SYSTEM_PROMPT = (
    "detailed thinking off\n\n"
    + """You are a sports dietitian generating a one-day meal plan
for an elite épée fencer. Output a single JSON object — no prose, no markdown — with
this exact schema:

{
  "meals": [
    {
      "slot": "breakfast" | "lunch" | "dinner" | "snack" | "pre_workout" | "post_workout",
      "time": "HH:MM",
      "name": string,
      "ingredients": [{"name": string, "qty_g": number}],
      "kcal": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "notes": string
    }
  ],
  "totals": {"kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number},
  "rationale": string
}

Rules:
- Hit the daily targets within ±5%. If a target is impossible to hit cleanly, get as
  close as possible and explain in `rationale`.
- Time meals around training. If the day has fencing at 20:00, place pre_workout
  ~17:30, dinner/post_workout ~22:30. If gym daytime, place pre 60-90 min before.
- Use realistic, budget-moderate whole foods. No supplements in the meal list
  (creatine/caffeine are tracked separately).
- Per-ingredient `qty_g` is grams of the food as eaten/cooked unless naturally
  counted (eggs → grams approx 50/each).
- Include 35+ g fiber/day across meals.
- Output ONLY the JSON object."""
)


def _extract_json(s: str) -> dict[str, Any]:
    s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if not m:
            raise ValueError(f"no JSON object in LLM output: {s[:200]}")
        return json.loads(m.group(0))


def generate_day_plan(db: Session, day: date | None = None) -> NutritionPlan:
    day = day or date.today()
    targets: NutritionTargets = compute_targets(db, day)

    user_msg = (
        f"Date: {day.isoformat()} ({day.strftime('%A')})\n"
        f"Day type: {targets.day_type}; phase: {targets.phase}\n"
        f"Targets: {targets.kcal:.0f} kcal, P {targets.protein_g} / "
        f"C {targets.carbs_g} / F {targets.fat_g} g, fiber ≥ {targets.fiber_g} g\n"
        f"Athlete weight: {targets.weight_kg} kg\n"
        f"Notes: {targets.notes}\n"
        f"Training timing on this day: "
        + (
            "fencing 20:00 (≈2h)"
            if targets.day_type in ("fencing", "double") and day.weekday() != 5
            else "Saturday fencing 11:00 (≈2h)"
            if day.weekday() == 5
            else "gym daytime (flexible)"
            if targets.day_type == "gym"
            else "rest day"
            if targets.day_type == "rest"
            else "competition day"
        )
        + ".\nGenerate the JSON plan."
    )

    resp = get_llm().chat(
        [
            {"role": "system", "content": MEALPLAN_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.4,
        max_tokens=2000,
    )

    try:
        plan_data = _extract_json(resp.content)
    except Exception as e:  # noqa: BLE001
        log.warning("Bad meal-plan JSON: %s; content=%r", e, resp.content[:300])
        plan_data = {"meals": [], "totals": {}, "rationale": f"parse-failed: {e}"}

    payload = {
        "plan": plan_data,
        "model": resp.model,
    }
    targets_payload = targets.to_dict()

    stmt = pg_insert(NutritionPlan).values(
        day=day,
        targets=targets_payload,
        plan=payload,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["day"],
        set_={"targets": stmt.excluded.targets, "plan": stmt.excluded.plan},
    )
    db.execute(stmt)
    db.commit()
    return db.scalar(select(NutritionPlan).where(NutritionPlan.day == day))


# ── shopping list ─────────────────────────────────────────────────────
def build_shopping_list(
    db: Session,
    start: date,
    end: date,
) -> dict[str, Any]:
    """Aggregate ingredients across all NutritionPlans in [start, end]."""
    plans = db.scalars(
        select(NutritionPlan)
        .where(and_(NutritionPlan.day >= start, NutritionPlan.day <= end))
        .order_by(NutritionPlan.day)
    ).all()

    totals: dict[str, float] = defaultdict(float)
    days_covered: list[str] = []
    missing_days: list[str] = []
    cur = start
    plan_by_day = {p.day: p for p in plans}
    while cur <= end:
        if cur in plan_by_day:
            days_covered.append(cur.isoformat())
            plan = plan_by_day[cur].plan or {}
            meals = (plan.get("plan") or {}).get("meals") or plan.get("meals") or []
            for meal in meals:
                for ing in meal.get("ingredients") or []:
                    name = (ing.get("name") or "").strip().lower()
                    qty = float(ing.get("qty_g") or 0)
                    if name and qty > 0:
                        totals[name] += qty
        else:
            missing_days.append(cur.isoformat())
        cur += timedelta(days=1)

    items = sorted(
        [{"name": k, "qty_g": round(v, 0)} for k, v in totals.items()],
        key=lambda x: -x["qty_g"],
    )
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days_covered": days_covered,
        "missing_days": missing_days,
        "items": items,
        "item_count": len(items),
    }
