"use client";

import { useEffect, useState } from "react";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import { api, type Competition, type CompetitionNutritionInputs, type CompetitionNutritionPlan, type CompetitionNutritionPreview } from "@/lib/api";
import { Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompetitionMeals } from "@/components/competition-meals";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function CompetitionNutritionPlanner({ onChanged, onSelectDay }: { onChanged: () => void; onSelectDay: (day: string) => void }) {
  const [events, setEvents] = useState<Competition[]>([]);
  const [plans, setPlans] = useState<CompetitionNutritionPlan[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [inputs, setInputs] = useState<CompetitionNutritionInputs>({ expected_demand: "moderate", event_format: "single_day", start_time: null, resolve_overlaps: false });
  const [draft, setDraft] = useState<CompetitionNutritionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [acceptanceId, setAcceptanceId] = useState(() => crypto.randomUUID());
  const [linkedPlanId, setLinkedPlanId] = useState<number | null>(null);
  const [deactivation, setDeactivation] = useState<{ plan_id: number; version: number; days: { day: string; old_targets: Record<string, unknown> }[]; token: string } | null>(null);

  function refresh() {
    Promise.all([api.competitions.list(false), api.competitionNutrition.plans()])
      .then(([nextEvents, nextPlans]) => {
        setEvents(nextEvents); setPlans(nextPlans);
        const query = new URLSearchParams(window.location.search);
        const fromUrl = Number(query.get("competition"));
        const planId = Number(query.get("plan"));
        setLinkedPlanId(planId || null);
        setEventId(current => current ?? (nextEvents.some(event => event.id === fromUrl) ? fromUrl : nextEvents[0]?.id ?? null));
      }).catch(error => setError(errorText(error)));
  }
  useEffect(refresh, []);
  useWorkflowRefresh(refresh);
  useEffect(() => {
    if (linkedPlanId !== null && plans.some(plan => plan.id === linkedPlanId)) {
      document.getElementById(`nutrition-plan-${linkedPlanId}`)?.scrollIntoView({ block: "start" });
    }
  }, [linkedPlanId, plans]);

  function chooseEvent(id: number) {
    const event = events.find(item => item.id === id);
    setEventId(id); setDraft(null); setError(null);
    setInputs(current => ({ ...current, event_format: event?.end_date && event.end_date !== event.event_date ? "multi_day" : "single_day", resolve_overlaps: false }));
  }

  function changeInputs(next: CompetitionNutritionInputs) { setInputs(next); setDraft(null); setError(null); }

  async function generatePreview() {
    if (eventId === null || busy) return;
    setBusy(true); setError(null); setReceipt(null);
    try { setDraft(await api.competitionNutrition.preview(eventId, inputs)); setAcceptanceId(crypto.randomUUID()); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!draft || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await api.competitionNutrition.accept(draft.event.id, draft.inputs, draft.token, acceptanceId);
      setReceipt(`Accepted ${saved.event.name} nutrition plan v${saved.version}. Target dates now use plan ${saved.id}.`);
      setDraft(null); refresh(); onChanged();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function reviewDeactivation(plan: CompetitionNutritionPlan) {
    setError(null);
    try { setDeactivation(await api.competitionNutrition.deactivationPreview(plan.id)); }
    catch (error) { setError(errorText(error)); }
  }

  async function deactivate() {
    if (!deactivation || busy) return;
    setBusy(true); setError(null);
    try {
      await api.competitionNutrition.deactivate(deactivation.plan_id, deactivation.token);
      setReceipt(`Deactivated plan ${deactivation.plan_id} for future dates. Past diary entries and accepted targets remain.`);
      setDeactivation(null); refresh(); onChanged();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  const selected = events.find(event => event.id === eventId);
  return <Card title="Competition nutrition">
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Preview seven days before an event, every event day, and initial recovery. Viewing a preview does not activate targets.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error} {error.toLowerCase().includes("weight") && <a href="/profile" className="underline">Complete profile</a>}</p>}
      {receipt && <p role="status" className="text-sm">{receipt}</p>}
      {plans.some(plan => plan.active && plan.event_id === eventId) && <div className="border border-border p-3 text-xs" role="status">
        <p className="font-medium">Accepted target history for this event</p>
        <p>{plans.filter(plan => plan.active && plan.event_id === eventId).map(plan => `Plan #${plan.id} v${plan.version} · ${plan.days[0]?.day} through ${plan.days[plan.days.length - 1]?.day}`).join("; ")}. Open history below for dated assignments and meals.</p>
      </div>}
      {events.length === 0 ? <p className="text-sm text-muted-foreground">No competitions yet. <a href="/competitions" className="underline">Add an event</a> to preview nutrition.</p> : <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs">Competition
            <select className="block h-10 w-full border border-input bg-background px-2 text-sm" value={eventId ?? ""} onChange={event => chooseEvent(Number(event.target.value))}>
              {events.map(event => <option key={event.id} value={event.id}>{event.name} · {event.event_date} · Priority {event.priority}</option>)}
            </select>
          </label>
          <label className="text-xs">Expected active demand
            <select className="block h-10 w-full border border-input bg-background px-2 text-sm" value={inputs.expected_demand} onChange={event => changeInputs({ ...inputs, expected_demand: event.target.value as CompetitionNutritionInputs["expected_demand"] })}>
              <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
            </select>
          </label>
          <label className="text-xs">Event format
            <select className="block h-10 w-full border border-input bg-background px-2 text-sm" value={inputs.event_format} onChange={event => changeInputs({ ...inputs, event_format: event.target.value as CompetitionNutritionInputs["event_format"] })}>
              <option value="single_day">Single day</option><option value="multi_day">Multiple days</option>
            </select>
          </label>
          <label className="text-xs">Planned start time (optional)
            <Input type="time" value={inputs.start_time ?? ""} onChange={event => changeInputs({ ...inputs, start_time: event.target.value || null })} />
          </label>
        </div>
        {selected && <p className="text-xs text-muted-foreground">{selected.event_date}{selected.end_date ? ` – ${selected.end_date}` : ""} · {selected.location || "Location unspecified"}. Enter expected active demand; venue hours are not treated as exercise hours.</p>}
        <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={inputs.resolve_overlaps} onChange={event => changeInputs({ ...inputs, resolve_overlaps: event.target.checked })} />Use this event as the effective context if other competitions overlap the timeline</label>
        <Button size="sm" onClick={generatePreview} disabled={busy || eventId === null}>{busy ? "Working…" : "Preview targets"}</Button>
      </>}
      {draft && <section className="space-y-3 border-t border-border pt-4" aria-label="Competition nutrition preview">
        <h3 className="font-semibold">Preview · {draft.event.name} · {draft.policy_version}</h3>
        {draft.assumptions.map(assumption => <p key={assumption} className="text-xs text-muted-foreground">Assumption: {assumption}</p>)}
        {draft.competing_events.length > 0 && <p className="text-xs text-amber-500">Competing events: {draft.competing_events.map(event => event.name).join(", ")}. This preview selects {draft.event.name}.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {draft.days.map(day => <article key={day.day} className="border border-border p-3 space-y-1 text-xs">
            <h4 className="font-semibold text-sm">{day.day} · {day.context}</h4>
            <p>Training: {day.training_type}{day.training_source === "manual" ? " (manual)" : ""}{day.session_name ? ` · ${day.session_name}` : ""}</p>
            <p>{day.kcal} kcal · P {day.protein_g} g · C {day.carbs_g} g · F {day.fat_g} g</p>
            <p className="text-muted-foreground">Ordinary: {day.ordinary_kcal} kcal, {day.ordinary_carbs_g} g carbs · {day.explanation}</p>
            <p className="text-muted-foreground">{day.baseline_source} baseline through {day.data_cutoff}{day.provisional ? " · provisional forecast" : ""}</p>
            {day.energy_conflict && <p>{day.energy_conflict}</p>}
            {day.existing_plan_id && <p className="text-amber-500">Replaces active target from plan {day.existing_plan_id} on this date.</p>}
            {day.existing_targets && <p className="text-amber-500">Current accepted: {String(day.existing_targets.kcal)} kcal · P {String(day.existing_targets.protein_g)} g · C {String(day.existing_targets.carbs_g)} g · F {String(day.existing_targets.fat_g)} g.</p>}
          </article>)}
        </div>
        <div className="flex gap-2"><Button size="sm" onClick={accept} disabled={busy}>{busy ? "Saving…" : "Accept targets"}</Button><Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button></div>
      </section>}
      {linkedPlanId !== null && plans.length > 0 && !plans.some(plan => plan.id === linkedPlanId) && <p role="status" className="text-xs">Referenced plan #{linkedPlanId} is unavailable. Choose an available version below.</p>}
      {plans.length > 0 && <details open={linkedPlanId !== null || undefined} className="border-t border-border pt-4"><summary className="cursor-pointer font-medium">Accepted plan history ({plans.length})</summary>
        <ul className="space-y-3 mt-3">{plans.map(plan => <li id={`nutrition-plan-${plan.id}`} key={plan.id} className={`border p-3 text-sm space-y-1 ${linkedPlanId === plan.id ? "border-accent" : "border-border"}`}>
          {linkedPlanId === plan.id && <p role="status" className="text-xs">Referenced plan #{plan.id} · version {plan.version}</p>}
          <p className="font-medium">{plan.event.name} · version {plan.version} · {plan.active ? "active" : "inactive"}</p>
          <p className="text-xs text-muted-foreground">Accepted {plan.created_at} · {plan.policy_version} · {plan.days.length} dated targets</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onSelectDay(plan.days[0].day)}>Open first diary date</Button>{plan.active && <Button size="sm" variant="outline" onClick={() => void reviewDeactivation(plan)}>Review deactivation</Button>}</div>
          <CompetitionMeals plan={plan} />
        </li>)}</ul>
      </details>}
      {deactivation && <section className="border border-border p-3 space-y-2"><h3 className="font-medium">Deactivate plan {deactivation.plan_id}?</h3>
        <p className="text-xs text-muted-foreground">Future target dates affected: {deactivation.days.length ? deactivation.days.map(row => row.day).join(", ") : "none"}. Consumed meals and historical targets remain unchanged.</p>
        <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={deactivate}>Confirm deactivation</Button><Button size="sm" variant="outline" onClick={() => setDeactivation(null)}>Cancel</Button></div>
      </section>}
    </div>
  </Card>;
}
