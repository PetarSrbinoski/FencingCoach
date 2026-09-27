"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CompetitionMealDraft, type CompetitionMealInputs, type CompetitionMealPlan, type CompetitionNutritionPlan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function dateRange(start: string, end: string): string[] {
  const days: string[] = [];
  const current = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (current <= last && days.length < 8) { days.push(current.toISOString().slice(0, 10)); current.setUTCDate(current.getUTCDate() + 1); }
  return days;
}

export function CompetitionMeals({ plan }: { plan: CompetitionNutritionPlan }) {
  const available = plan.days.map(day => day.day);
  const first = available.find(day => day >= new Date().toISOString().slice(0, 10)) || available[0];
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(first);
  const [startTime, setStartTime] = useState(plan.inputs.start_time || "");
  const [breakTimes, setBreakTimes] = useState("");
  const [prepLimit, setPrepLimit] = useState("");
  const [drafts, setDrafts] = useState<CompetitionMealDraft[]>([]);
  const [history, setHistory] = useState<CompetitionMealPlan[]>([]);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setHistory(await api.competitionMeals.history(plan.id)); }
    catch (error) { setError(errorText(error)); }
  }, [plan.id]);
  useEffect(() => { void refresh(); }, [refresh, plan.active]);

  function inputsFor(day: string, replaceSlot: string | null = null): CompetitionMealInputs {
    return { start: day, end: day, start_time: startTime || null,
      break_times: breakTimes.split(",").map(value => value.trim()).filter(Boolean),
      replace_slot: replaceSlot,
      prep_limit_minutes: prepLimit === "" ? null : Number(prepLimit) };
  }

  async function generate(replaceDay?: string, replaceSlot?: string) {
    if (busy) return;
    const days = replaceDay ? [replaceDay] : dateRange(start, end);
    if (!days.length || days.some(day => !available.includes(day))) { setError("Choose 1–7 dates within this accepted plan."); return; }
    setBusy(true); setError(null); setReceipt(null);
    if (!replaceDay) setDrafts([]);
    for (const [index, day] of days.entries()) {
      setProgress(`Generating ${day} (${index + 1}/${days.length})…`);
      try {
        const draft = await api.competitionMeals.preview(plan.id, inputsFor(day, replaceSlot || null));
        setDrafts(current => [...current.filter(item => item.days[0].day !== day), draft].sort((a, b) => a.days[0].day.localeCompare(b.days[0].day)));
      } catch (error) { setError(current => `${current ? `${current} · ` : ""}${day}: ${errorText(error)}`); }
    }
    setProgress(""); setBusy(false);
  }

  async function accept(draft: CompetitionMealDraft) {
    setBusy(true); setError(null);
    try {
      const saved = await api.competitionMeals.accept(plan.id, draft, crypto.randomUUID());
      setDrafts(current => current.filter(item => item !== draft));
      setReceipt(`Accepted meals for ${saved[0].day}, version ${saved[0].version}. No food was logged as consumed.`);
      await refresh();
    } catch (error) { setError(`${errorText(error)} Regenerate this date and review it again.`); }
    finally { setBusy(false); }
  }

  return <section className="border-t border-border pt-3 space-y-3" aria-label={`Meals for ${plan.event.name} plan version ${plan.version}`}>
    <h4 className="font-medium">Preparation meals · target plan v{plan.version}</h4>
    <p className="text-xs text-muted-foreground">Uses foods with known per-100 g macros in My foods or cached USDA data. Portions and totals are calculated from those records. Review ingredient labels, tolerance, timing and target differences before accepting. Accepting never logs consumption.</p>
    {!plan.active && <p className="text-xs text-amber-500">This target plan is inactive. Its accepted meals remain in history for review.</p>}
    {plan.active && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="text-xs">First date<Input type="date" min={available[0]} max={available[available.length - 1]} value={start} onChange={event => { setStart(event.target.value); setDrafts([]); }} /></label>
      <label className="text-xs">Last date<Input type="date" min={available[0]} max={available[available.length - 1]} value={end} onChange={event => { setEnd(event.target.value); setDrafts([]); }} /></label>
      <label className="text-xs">Event start time<Input type="time" value={startTime} onChange={event => { setStartTime(event.target.value); setDrafts([]); }} /></label>
      <label className="text-xs">Break times (HH:MM, comma separated)<Input value={breakTimes} placeholder="12:00, 15:00" onChange={event => { setBreakTimes(event.target.value); setDrafts([]); }} /></label>
      <label className="text-xs">Maximum preparation time per food (minutes, optional)<Input type="number" min="0" max="240" step="1" value={prepLimit} onChange={event => { setPrepLimit(event.target.value); setDrafts([]); }} /></label>
      <Button size="sm" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate meals"}</Button>
    </div>}
    {progress && <p role="status" className="text-xs">{progress}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error} <a href="/nutrition#my-foods" className="underline">Open My foods</a></p>}
    {receipt && <p role="status" className="text-xs">{receipt}</p>}
    {drafts.map(draft => draft.days.map(day => <article key={day.day} className="border border-border p-3 space-y-2 text-xs">
      <h5 className="font-semibold text-sm">Draft · {day.day} · {day.context} · target v{day.target_version}</h5>
      <p>Target: {day.target.kcal} kcal · P {day.target.protein_g} g · C {day.target.carbs_g} g · F {day.target.fat_g} g</p>
      <p>All meals including snacks and drinks: {day.totals.kcal ?? "unknown"} kcal · P {day.totals.protein_g ?? "unknown"} g · C {day.totals.carbs_g ?? "unknown"} g · F {day.totals.fat_g ?? "unknown"} g</p>
      <p>Difference: {day.deviations.kcal ?? "unknown"} kcal · P {day.deviations.protein_g ?? "unknown"} g · C {day.deviations.carbs_g ?? "unknown"} g · F {day.deviations.fat_g ?? "unknown"} g</p>
      {day.replaces_meal_plan_id && <p>Would replace accepted meal plan #{day.replaces_meal_plan_id} for this date.</p>}
      <div className="grid gap-2 sm:grid-cols-2">{day.meals.map(meal => <div key={meal.slot} className="bg-muted/30 p-2 space-y-1"><strong>{meal.slot.replaceAll("_", " ")}{meal.time ? ` · ${meal.time}` : " · time to confirm"}: {meal.name}</strong>
        <p>{meal.ingredients.map(item => `${item.qty_g} g ${item.name} (${item.source} #${item.source_id})`).join(" + ")}</p>
        <p>{meal.totals.kcal ?? "unknown"} kcal · P {meal.totals.protein_g ?? "unknown"} g · C {meal.totals.carbs_g ?? "unknown"} g · F {meal.totals.fat_g ?? "unknown"} g</p>
        <p className="text-muted-foreground">{meal.notes}</p>
      </div>)}</div>
      {day.warnings.map(warning => <p key={warning} className="text-amber-500">Review: {warning}</p>)}
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void accept(draft)}>Accept these meals</Button><Button size="sm" variant="outline" onClick={() => setDrafts(current => current.filter(item => item !== draft))}>Cancel draft</Button></div>
    </article>))}
    {history.length > 0 && <div className="space-y-2"><h5 className="font-medium text-xs">Accepted meal history</h5>{history.map(item => <article key={item.id} className="border border-border p-2 text-xs">
      <p>{item.day} · meal version {item.version} · target plan {item.target_plan_id} v{item.target_version} · {item.active ? "active" : "superseded"}{item.needs_review ? " · needs review against current targets" : ""}</p>
      <p>{item.meals.length} meals · {item.totals.kcal ?? "unknown"} kcal · P {item.totals.protein_g ?? "unknown"} g · C {item.totals.carbs_g ?? "unknown"} g · F {item.totals.fat_g ?? "unknown"} g</p>
      {item.active && plan.active && <div className="flex flex-wrap gap-1 mt-2">{item.meals.map(meal => <Button key={meal.slot} size="sm" variant="outline" disabled={busy} onClick={() => void generate(item.day, meal.slot)}>Replace {meal.slot.replaceAll("_", " ")}</Button>)}</div>}
    </article>)}</div>}
  </section>;
}
