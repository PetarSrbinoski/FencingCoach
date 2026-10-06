"use client";

import { RecipeEditor, RecipeValues, editSnapshot } from "@/components/recipe-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type AgentAction, type NutritionDraft, type RecipeInput, type SavedFood } from "@/lib/api";
import { createJobObserver } from "@/lib/job-observer";
import { randomUUID } from "@/lib/uuid";
import { announceWorkflowChange } from "@/lib/workflow-refresh";
import { useEffect, useRef, useState } from "react";

const storageKey = "coachapp:meal-suggestions";
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const selectClass = "mt-1 w-full rounded border border-border bg-background p-2";

export function MealSuggestions({ day, onLogged }: { day: string; onLogged: (day: string) => void }) {
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [available, setAvailable] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [selectedDay, setSelectedDay] = useState(day);
  const [complete, setComplete] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AgentAction | null>(null);
  const [editor, setEditor] = useState<{ index: number; value: RecipeInput } | null>(null);
  const [foods, setFoods] = useState<SavedFood[]>([]);
  const [logging, setLogging] = useState<number | null>(null);
  const [portions, setPortions] = useState("1");
  const [meal, setMeal] = useState("");
  const observer = useRef(createJobObserver());
  const requestIds = useRef<Record<string, string>>({});

  useEffect(() => { setSelectedDay(day); }, [day]);

  useEffect(() => {
    const jobObserver = observer.current;
    api.foods.list().then(setFoods).catch((error) => setError(errorText(error)));
    const fromChat = new URLSearchParams(window.location.search).get("suggestion");
    const saved = fromChat || localStorage.getItem(storageKey);
    if (saved) api.suggestions.get(Number(saved)).then(setDraft).catch((error) => setError(errorText(error)));
    return () => jobObserver.stop();
  }, []);
  useEffect(() => {
    const jobObserver = observer.current;
    if (!draft) return;
    localStorage.setItem(storageKey, String(draft.id));
    if (draft.status === "pending") {
      const watch = observer.current.begin();
      watch.poll(() => api.suggestions.get(draft.id), setDraft, (error) => setError(errorText(error)));
    }
    return () => jobObserver.stop();
  }, [draft]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await operation(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  async function accept(index: number, action: "save_recipe" | "log_consumption") {
    if (!draft) return;
    const slot = `${index}:${action}`;
    requestIds.current[slot] ||= randomUUID();
    const result = await api.suggestions.accept(draft.id, {
      expected_revision: draft.revision, request_id: requestIds.current[slot], option_index: index, action,
      ...(action === "log_consumption" ? { portions: Number(portions), meal } : {}),
    });
    setReceipt(result); setLogging(null); setDraft(await api.suggestions.get(draft.id));
    announceWorkflowChange();
    if (action === "log_consumption") onLogged(draft.inputs.day!);
  }

  return <section aria-label="Practical meal suggestions" className="space-y-4">
    <div><h2 className="text-xl font-semibold">What can I eat now?</h2><p className="mt-1 text-sm text-muted-foreground">Find meals that fit what you have and the rest of your day.</p></div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-3">{error}</p>}
    <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(event) => {
      event.preventDefault(); perform(async () => {
        observer.current.stop(); requestIds.current = {}; setReceipt(null); setEditor(null);
        setDraft(await api.suggestions.create({ day: selectedDay,
          available_foods: available.split(",").map((name) => name.trim()).filter(Boolean),
          prep_limit_min: Number(minutes), diary_complete: complete === "unknown" ? null : complete === "yes" }));
      });
    }}>
      <label className="block text-sm">Available foods<Input required value={available} placeholder="Rice, eggs, yogurt" onChange={(event) => setAvailable(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">Separate names with commas. Use the names in My foods when available.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Suggestion day<Input required type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} /></label>
        <label className="text-sm">Time to prepare (minutes)<Input required type="number" min="0" max="240" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
      </div>
      <label className="block text-sm">Have you logged everything you ate?<select className={selectClass} value={complete} onChange={(event) => setComplete(event.target.value)}><option value="unknown">Not sure</option><option value="yes">Yes, my diary is complete</option><option value="no">No, some food is missing</option></select></label>
      <Button type="submit" disabled={busy || draft?.status === "pending"}>Find meal options</Button>
    </form>
    {draft?.status === "pending" && <div className="flex items-center gap-3"><p role="status">Finding feasible meals…</p><Button variant="outline" disabled={busy} onClick={() => perform(async () => setDraft(await api.suggestions.cancel(draft.id)))}>Cancel suggestions</Button></div>}
    {draft?.status === "error" && <p role="alert">{draft.error} Review your constraints and try again.</p>}
    {draft?.status === "cancelled" && <p role="status">Suggestions cancelled.</p>}
    {draft?.status === "done" && draft.payload && <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>{draft.payload.explanation}</p>
        {draft.payload.question && <p role="alert">{draft.payload.question} Update the inputs above and request fresh options.</p>}
        <details><summary className="cursor-pointer text-muted-foreground">Day context and constraints</summary>
          <p>Based on {draft.inputs.day}. Remaining recorded allowance: {draft.payload.context?.remaining.kcal ?? "Unknown"} kcal, {draft.payload.context?.remaining.protein_g ?? "Unknown"} g protein, {draft.payload.context?.remaining.carbs_g ?? "Unknown"} g carbs, {draft.payload.context?.remaining.fat_g ?? "Unknown"} g fat.</p>
          {draft.payload.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
          <p>Ingredient-name screening cannot verify packaged allergens or cross-contact.</p>
        </details>
        <Button variant="outline" disabled={busy} onClick={() => perform(async () => setDraft(await api.suggestions.refresh(draft.id, draft.revision)))}>Refresh day fit</Button>
      </div>
      {!draft.payload.options?.length && <p>No feasible options. Add foods, clarify restrictions in Profile, or increase preparation time.</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {draft.payload.options?.map((option, index) => <article key={index} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
          <div><h3 className="font-semibold">{option.recipe.name}</h3><p className="text-sm text-muted-foreground">{option.recipe.prep_time_min} minutes · {option.recipe.per_portion.kcal ?? "Unknown"} kcal per portion</p></div>
          <ul className="text-sm">{option.recipe.ingredients.map((line, i) => <li key={i}>{line.qty_g == null || !option.recipe.portions ? "Unknown" : Number((line.qty_g / option.recipe.portions).toFixed(2))} g {line.name}</li>)}</ul>
          <p className="text-sm">{option.fit.explanation}</p>
          {option.fit.exceeds_remaining.length > 0 && <p className="text-sm">Exceeds the recorded remaining allowance for: {option.fit.exceeds_remaining.join(", ").replace(/_g/g, "")}. Review appetite and diary completeness.</p>}
          {option.fit.estimated_ingredients.length > 0 && <p className="text-sm">Estimated values: {option.fit.estimated_ingredients.join(", ")}</p>}
          <details><summary className="cursor-pointer text-sm">Nutrition and ingredient sources</summary><RecipeValues recipe={option.recipe} /></details>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || Object.keys(draft.accepted_actions).some((slot) => slot.startsWith(`${index}:`))} onClick={() => setEditor({ index, value: editSnapshot(option.recipe) })}>Adjust option</Button>
            <Button variant="outline" disabled={busy || !!draft.accepted_actions[`${index}:save_recipe`] || editor?.index === index} onClick={() => perform(async () => accept(index, "save_recipe"))}>Save as reusable meal</Button>
            <Button disabled={busy || !option.recipe.loggable || !!draft.accepted_actions[`${index}:log_consumption`] || editor?.index === index} onClick={() => { setLogging(index); setPortions("1"); setMeal(""); }}>I ate this</Button>
          </div>
          {editor?.index === index && <div className="space-y-3 border-t border-border pt-3">
            <h4 className="font-medium">Adjust and review this option</h4>
            <RecipeEditor value={editor.value} foods={foods} snapshot={option.recipe} onChange={(value) => setEditor({ index, value })} />
            <Button disabled={busy} onClick={() => perform(async () => { setDraft(await api.suggestions.review(draft.id, index, editor.value, draft.revision)); setEditor(null); })}>Review adjustments</Button>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel adjustments</Button>
          </div>}
          {logging === index && <div className="space-y-3 border-t border-border pt-3">
            <h4 className="font-medium">Confirm actual consumption on {draft.inputs.day}</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Portions eaten<Input type="number" min="0.01" step="any" value={portions} onChange={(event) => setPortions(event.target.value)} /></label>
              <label className="text-sm">Suggestion meal<select className={selectClass} value={meal} onChange={(event) => setMeal(event.target.value)}><option value="">Choose meal</option>{["breakfast", "lunch", "dinner", "snack", "pre", "post"].map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <Button disabled={busy || !meal || !(Number(portions) > 0)} onClick={() => perform(async () => accept(index, "log_consumption"))}>Confirm consumption</Button>
            <Button variant="outline" onClick={() => setLogging(null)}>Cancel logging</Button>
          </div>}
        </article>)}
      </div>
    </div>}
    {receipt && <div role="status" className="space-y-2 rounded-xl border border-border p-3"><p>{receipt.status === "undone" ? "Change undone." : receipt.summary}</p>
      {receipt.status === "committed" && <Button variant="outline" disabled={busy} onClick={() => perform(async () => { setReceipt(await api.agentActions.undo(receipt.id, randomUUID())); announceWorkflowChange(); })}>Undo suggestion action</Button>}
    </div>}
  </section>;
}
