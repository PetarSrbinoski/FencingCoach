"""Context packer.

Builds a compact, token-budget-aware text snapshot of the athlete's
current state to inject as a `system` (or appended `user`) message
before the LLM call.

Priority order (highest first):
    1. Readiness today + components
    2. Last 7 days of metrics (HRV, sleep, RHR, BB, load)
    3. This week's activities (fencing + gym)
    4. This week's nutrition compliance
    5. Upcoming competitions (next 90 days)
    6. Active training plan / phase
    7. 28-day trend summary

Token budget defaults to 25% of LLM_CONTEXT_TOKENS, leaving room for
chat history + response. We use tiktoken for an approximate token count
(it's fine for non-OpenAI models since we only need a rough budget).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, desc, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    Activity,
    AthleteProfile,
    Competition,
    GarminMetric,
    NutritionLog,
    NutritionPlan,
    TrainingPlan,
)
from app.services.periodization import compute_phase
from app.services.readiness import compute_readiness
from app.services.targets import compute_targets
from app.services.training import TUE_TEMPLATE, THU_TEMPLATE, detect_plateau

try:
    import tiktoken

    _enc = tiktoken.get_encoding("cl100k_base")

    def _count_tokens(s: str) -> int:
        return len(_enc.encode(s))
except Exception:  # noqa: BLE001

    def _count_tokens(s: str) -> int:  # rough fallback
        return max(1, len(s) // 4)


# ── section builders ──────────────────────────────────────────────────
def _readiness_section(db: Session, today: date) -> str:
    r = compute_readiness(db, today)
    lines = [
        f"## Readiness — {r.day.isoformat()}",
        f"Score: {r.score:.0f}/100 ({r.band})",
    ]
    for k, c in r.components.items():
        lines.append(f"  - {k}: {c.score:.0f} (w {c.weight:.2f}) — {c.detail}")
    inputs = ", ".join(
        f"{k}={v:.1f}" if isinstance(v, (int, float)) else f"{k}={v}"
        for k, v in r.inputs.items()
        if v is not None
    )
    if inputs:
        lines.append(f"Raw: {inputs}")
    return "\n".join(lines)


def _metrics_section(db: Session, today: date, days: int = 7) -> str:
    start = today - timedelta(days=days - 1)
    rows = db.execute(
        select(GarminMetric.day, GarminMetric.kind, GarminMetric.value)
        .where(
            and_(
                GarminMetric.day >= start,
                GarminMetric.day <= today,
                GarminMetric.value.is_not(None),
            )
        )
        .order_by(GarminMetric.day, GarminMetric.kind)
    ).all()
    if not rows:
        return "## Recent metrics — no data yet"
    by_day: dict[date, dict[str, float]] = {}
    for d, kind, val in rows:
        by_day.setdefault(d, {})[kind] = float(val)

    keys = (
        "hrv",
        "sleep",
        "resting_hr",
        "body_battery",
        "stress_daily",
        "training_readiness",
    )
    header = " | ".join(["day", *keys])
    lines = [f"## Last {days}d metrics", header, "-" * len(header)]
    for d in sorted(by_day):
        row = by_day[d]
        cells = [d.isoformat()] + [(f"{row[k]:.1f}" if k in row else "·") for k in keys]
        lines.append(" | ".join(cells))
    return "\n".join(lines)


def _activities_section(db: Session, today: date, days: int = 7) -> str:
    start = datetime.combine(
        today - timedelta(days=days - 1), datetime.min.time(), tzinfo=timezone.utc
    )
    end = datetime.combine(
        today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
    )
    acts = db.scalars(
        select(Activity)
        .where(and_(Activity.start_time >= start, Activity.start_time < end))
        .order_by(Activity.start_time)
    ).all()
    if not acts:
        return f"## Activities (last {days}d) — none logged"
    lines = [f"## Activities (last {days}d)"]
    for a in acts:
        dur = f"{(a.duration_s or 0) // 60}min"
        hr = f"{a.avg_hr}/{a.max_hr}bpm" if a.avg_hr else "—"
        load = f"load {a.training_load:.0f}" if a.training_load else ""
        lines.append(
            f"  - {a.start_time.strftime('%a %H:%M')} {a.activity_type or 'activity'} "
            f"{dur} HR {hr} {load}".rstrip()
        )
    return "\n".join(lines)


def _nutrition_section(db: Session, today: date, days: int = 3) -> str:
    start = today - timedelta(days=days - 1)
    logs = db.scalars(
        select(NutritionLog)
        .where(and_(NutritionLog.day >= start, NutritionLog.day <= today))
        .order_by(NutritionLog.day, NutritionLog.logged_at)
    ).all()

    plan = db.scalar(select(NutritionPlan).where(NutritionPlan.day == today))

    if not logs and not plan:
        return "## Nutrition — no logs/plan for today"

    lines = ["## Nutrition"]
    if plan:
        t = plan.targets or {}
        lines.append(
            f"Today's targets: {t.get('kcal', '?')} kcal, "
            f"P {t.get('protein_g', '?')} / C {t.get('carbs_g', '?')} / F {t.get('fat_g', '?')}"
        )
    by_day: dict[date, list[NutritionLog]] = {}
    for lg in logs:
        by_day.setdefault(lg.day, []).append(lg)
    for d in sorted(by_day):
        items = by_day[d]
        kcal = sum(i.kcal or 0 for i in items)
        p = sum(i.protein_g or 0 for i in items)
        c = sum(i.carbs_g or 0 for i in items)
        f = sum(i.fat_g or 0 for i in items)
        lines.append(
            f"  {d.isoformat()}: {kcal:.0f} kcal, P {p:.0f} / C {c:.0f} / F {f:.0f} ({len(items)} entries)"
        )
        if d == today:
            for i in items:
                lines.append(f"    - {i.meal or 'meal'}: {i.raw_text[:80]}")
    return "\n".join(lines)


def _competitions_section(db: Session, today: date) -> str:
    end = today + timedelta(days=90)
    upcoming = db.scalars(
        select(Competition)
        .where(and_(Competition.event_date >= today, Competition.event_date <= end))
        .order_by(Competition.event_date)
        .limit(5)
    ).all()
    if not upcoming:
        return "## Competitions — none in next 90 days"
    lines = ["## Upcoming competitions"]
    for c in upcoming:
        days_out = (c.event_date - today).days
        lines.append(
            f"  - {c.event_date.isoformat()} (T-{days_out}d) {c.name} "
            f"[{c.priority}] {c.level or ''}"
        )
    return "\n".join(lines)


def _training_plan_section(db: Session, today: date) -> str:
    plan = db.scalar(
        select(TrainingPlan)
        .where(and_(TrainingPlan.active.is_(True), TrainingPlan.start_date <= today))
        .order_by(desc(TrainingPlan.start_date))
        .limit(1)
    )
    if not plan:
        return "## Training plan — none active"
    return (
        f"## Training plan — {plan.name} ({plan.phase})\n"
        f"  {plan.start_date.isoformat()} → {plan.end_date.isoformat()} "
        f"({plan.weeks} weeks)"
    )


def _phase_section(db: Session, today: date) -> str:
    p = compute_phase(db, today)
    lines = [f"## Phase — {p.name}"]
    if p.next_event_name:
        lines.append(
            f"  next A-event: {p.next_event_name} on {p.next_event_date} "
            f"(T-{p.days_to_event}d)"
        )
    else:
        lines.append("  no upcoming A-event")
    if p.notes:
        lines.append(f"  {p.notes}")
    return "\n".join(lines)


def _targets_section(db: Session, today: date) -> str:
    try:
        t = compute_targets(db, today).to_dict()
    except Exception as e:  # noqa: BLE001
        return f"## Targets — error: {e}"
    return (
        f"## Today's targets ({t['day_type']}, {t['phase']})\n"
        f"  {t['kcal']:.0f} kcal | "
        f"P {t['protein_g']:.0f}g / C {t['carbs_g']:.0f}g / F {t['fat_g']:.0f}g / "
        f"fiber {t['fiber_g']:.0f}g\n"
        f"  notes: {t.get('notes', '')}"
    )


def _plateau_section(db: Session) -> str:
    alerts: list[str] = []
    seen: set[str] = set()
    for tpl in (TUE_TEMPLATE, THU_TEMPLATE):
        for item in tpl:
            ex = item["exercise"]
            if ex in seen:
                continue
            seen.add(ex)
            try:
                p = detect_plateau(db, ex)
            except Exception:  # noqa: BLE001
                continue
            if p.get("plateau"):
                alerts.append(f"  - {ex}: {p.get('detail', 'plateau')}")
    if not alerts:
        return ""
    return "## Plateau alerts (4w vs prior 4w)\n" + "\n".join(alerts)


def _profile_section(db: Session) -> str:
    p = db.scalar(select(AthleteProfile).limit(1))
    if not p:
        return "## Athlete Profile — not configured yet"
    lines = ["## Athlete Profile"]
    lines.append(f"  Sport: {p.sport} | Level: {p.level}")
    if p.name:
        lines.append(f"  Name: {p.name}")
    if p.age:
        lines.append(f"  Age: {p.age}")
    if p.height_cm:
        lines.append(f"  Height: {p.height_cm:.0f} cm")
    if p.weight_kg:
        lines.append(f"  Weight: {p.weight_kg:.1f} kg")
    if p.fencing_style:
        lines.append(f"  Fencing style: {p.fencing_style}")
    if p.body_comp_goal:
        lines.append(f"  Body composition goal: {p.body_comp_goal}")
    if p.goals:
        lines.append(f"  Primary goal: {p.goals}")
    if p.weaknesses:
        lines.append(f"  Weaknesses to address: {p.weaknesses}")
    if p.food_budget:
        lines.append(f"  Food budget: {p.food_budget}")
    if p.dietary_restrictions:
        lines.append(f"  Dietary restrictions: {p.dietary_restrictions}")
    if p.supplements:
        lines.append(f"  Supplements: {p.supplements}")
    if p.notes:
        lines.append(f"  Notes: {p.notes}")
    return "\n".join(lines)


# ── orchestration ─────────────────────────────────────────────────────
def build_context(
    db: Session,
    today: date | None = None,
    *,
    token_budget: int | None = None,
) -> str:
    """Build the context block. Sections are added in priority order
    until the token budget is consumed."""
    today = today or date.today()
    budget = token_budget or max(2048, settings.LLM_CONTEXT_TOKENS // 4)

    sections_in_order = [
        ("profile", lambda: _profile_section(db)),
        ("readiness", lambda: _readiness_section(db, today)),
        ("phase", lambda: _phase_section(db, today)),
        ("targets", lambda: _targets_section(db, today)),
        ("metrics_7d", lambda: _metrics_section(db, today, days=7)),
        ("activities_7d", lambda: _activities_section(db, today, days=7)),
        ("nutrition_3d", lambda: _nutrition_section(db, today, days=3)),
        ("competitions", lambda: _competitions_section(db, today)),
        ("plateaus", lambda: _plateau_section(db)),
        ("training_plan", lambda: _training_plan_section(db, today)),
        ("metrics_28d", lambda: _metrics_section(db, today, days=28)),
    ]

    header = (
        f"# CONTEXT SNAPSHOT — generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
        "(Use this data to ground recommendations. If a section is empty, say so.)\n"
    )
    out: list[str] = [header]
    used = _count_tokens(header)
    for _name, builder in sections_in_order:
        try:
            text = builder()
        except Exception as e:  # noqa: BLE001
            text = f"## (section error: {e})"
        if not text:
            continue
        cost = _count_tokens(text) + 2
        if used + cost > budget:
            break
        out.append(text)
        used += cost
    return "\n\n".join(out)
