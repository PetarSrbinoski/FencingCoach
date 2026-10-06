"use client";

import { RecipeEditor, RecipeValues, editSnapshot, emptyRecipe } from "@/components/recipe-editor";
import { Editor } from "@/components/mobile-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type AgentAction, type NutritionDraft, type Recipe, type RecipeInput, type SavedFood } from "@/lib/api";
import { createJobObserver } from "@/lib/job-observer";
import { randomUUID } from "@/lib/uuid";
import { announceWorkflowChange, useWorkflowRefresh } from "@/lib/workflow-refresh";
import { useCallback, useEffect, useRef, useState } from "react";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const key = "coachapp:recipe-draft";

export function RecipeLibrary({ day, onLogged }: { day: string; onLogged: (day: string) => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [foods, setFoods] = useState<SavedFood[]>([]);
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [editor, setEditor] = useState<RecipeInput | null>(null);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [dirty, setDirty] = useState(false);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AgentAction | null>(null);
  const [logging, setLogging] = useState<Recipe | null>(null);
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState("portions");
  const [logDay, setLogDay] = useState(day);
  const [meal, setMeal] = useState("");
  const requestId = useRef("");
  const observer = useRef(createJobObserver());

  const refresh = useCallback(async () => {
    try { const [saved, products] = await Promise.all([api.recipes.list(), api.foods.list()]); setRecipes(saved); setFoods(products); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }, []);
  useWorkflowRefresh(refresh);

  function display(next: NutritionDraft) {
    setDraft(next);
    if (next.inputs.recipe) setEditor(next.inputs.recipe);
    setDirty(false);
  }
  useEffect(() => {
    const jobObserver = observer.current;
    refresh();
    const savedId = localStorage.getItem(key);
    if (savedId) api.recipes.getDraft(Number(savedId)).then(display).catch((error) => setError(errorText(error)));
    return () => jobObserver.stop();
  }, [refresh]);
  useEffect(() => {
    const jobObserver = observer.current;
    if (!draft) return;
    localStorage.setItem(key, String(draft.id));
    if (draft.status === "pending") {
      const watch = observer.current.begin();
      watch.poll(() => api.recipes.getDraft(draft.id), display, (error) => setError(errorText(error)));
    }
    return () => jobObserver.stop();
  }, [draft]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await operation(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  function newRecipe(recipe?: Recipe) {
    observer.current.stop(); localStorage.removeItem(key);
    setDraft(null); setEditing(recipe || null); setEditor(recipe ? editSnapshot(recipe) : emptyRecipe());
    setDirty(true); setImporting(false); setReceipt(null); setError(null);
    setEditorOpen(true);
  }
  const composition = draft?.payload?.recipe;
  return <section aria-label="Reusable recipes" className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-xl font-semibold">My recipes</h2>
      <Button onClick={() => newRecipe()} disabled={busy}>Create recipe</Button>
      <Button variant="outline" disabled={busy} onClick={() => { setImporting(true); setEditorOpen(true); setEditor(null); setDraft(null); setEditing(null); }}>Import recipe from text</Button>
    </div>
    <p className="text-sm text-muted-foreground">Save a reusable recipe, then log a portion when you eat it.</p>
    {error && !editorOpen && <p role="alert" className="rounded border border-destructive/30 p-3">{error}</p>}
    {(editor || draft?.status === "pending" || draft?.status === "error") && !editorOpen && !draft?.accepted_actions.save && <Button variant="outline" onClick={() => setEditorOpen(true)}>Continue recipe draft</Button>}
    <Editor open={editorOpen} onOpenChange={setEditorOpen} title={importing ? "Import a recipe" : "Review recipe"} description="Review ingredients and yield before saving. Saving leaves your diary unchanged.">
    <div className="space-y-4">
    {error && <p role="alert">{error}</p>}
    {importing && <div className="space-y-3 rounded-xl border border-border p-4">
      <label className="block text-sm">Paste a recipe or describe what you cooked<Textarea value={text} onChange={(event) => setText(event.target.value)} /></label>
      <Button disabled={busy || !text.trim()} onClick={() => perform(async () => { display(await api.recipes.draft({ text })); setImporting(false); })}>Interpret recipe</Button>
      <Button variant="outline" onClick={() => { setImporting(false); setEditorOpen(false); }}>Cancel import</Button>
    </div>}
    {draft?.status === "pending" && <p role="status">Interpreting recipe…</p>}
    {draft?.status === "error" && <div className="space-y-2"><p role="alert">{draft.error}</p><Button variant="outline" onClick={() => newRecipe()}>Compose manually</Button></div>}
    {editor && draft?.status !== "pending" && draft?.status !== "cancelled" && !draft?.accepted_actions.save && <div className="space-y-4 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{editing || draft?.inputs.recipe_id ? "Edit recipe" : "Compose recipe"}</h3>
      <RecipeEditor value={editor} foods={foods} snapshot={editing || composition} onChange={(value) => { setEditor(value); setDirty(true); }} />
      <Button disabled={busy} variant="outline" onClick={() => perform(async () => {
        const next = draft?.status === "done" ? await api.recipes.review(draft.id, editor, draft.revision)
          : await api.recipes.draft({ recipe: editor, ...(editing ? { recipe_id: editing.id, expected_recipe_revision: editing.revision } : {}) });
        display(next);
      })}>Review recipe</Button>
      {composition && <div className="space-y-3">
        <h3 className="font-semibold">Review ingredient matches, quantities and yield</h3>
        <RecipeValues recipe={composition} />
        <Button disabled={busy || dirty || composition.questions.length > 0} onClick={() => perform(async () => {
          if (!draft) return;
          const result = await api.recipes.accept(draft.id, draft.revision, `recipe-${draft.id}`);
          setReceipt(result); setDraft(await api.recipes.getDraft(draft.id)); setEditor(null); setEditorOpen(false);
          localStorage.removeItem(key); announceWorkflowChange(); await refresh();
        })}>Save recipe</Button>
        {dirty && <p className="text-sm">Review your changed values before saving.</p>}
      </div>}
    </div>}
    {draft && !draft.accepted_actions.save && draft.status !== "cancelled" && <Button variant="outline" disabled={busy} onClick={() => perform(async () => {
      display(await api.recipes.cancel(draft.id)); setEditor(null); setEditorOpen(false); localStorage.removeItem(key);
    })}>Cancel draft</Button>}
    </div>
    </Editor>
    {draft?.status === "cancelled" && <p role="status">Recipe draft cancelled.</p>}
    {receipt && <div role="status" className="space-y-2 rounded-xl border border-border p-3">
      <p>{receipt.status === "undone" ? "Change undone." : receipt.summary}</p>
      {receipt.status === "committed" && <Button variant="outline" disabled={busy} onClick={() => perform(async () => {
        setReceipt(await api.agentActions.undo(receipt.id, randomUUID())); announceWorkflowChange(); await refresh();
      })}>Undo recipe action</Button>}
    </div>}
    {loading ? <p role="status">Loading recipes…</p> : recipes.length === 0 ? <p>No recipes saved yet. Compose one from My foods or import text.</p> : recipes.map((recipe) => <article key={recipe.id} id={`recipe-${recipe.id}`} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold">{recipe.name}</h3>
      <p className="text-sm">{recipe.portions} portions · {recipe.per_portion.kcal ?? "Unknown"} kcal per portion</p>
      <details><summary className="cursor-pointer text-sm">Recipe details</summary><RecipeValues recipe={recipe} /></details>
      <div className="flex flex-wrap gap-2">
        <Button aria-label={`Edit ${recipe.name}`} variant="outline" disabled={busy} onClick={() => newRecipe(recipe)}>Edit</Button>
        <Button aria-label={`Log portion of ${recipe.name}`} disabled={busy || !recipe.loggable} onClick={() => { setLogging(recipe); setAmount("1"); setUnit("portions"); setLogDay(day); setMeal(""); requestId.current = randomUUID(); }}>Log portion</Button>
      </div>
      {logging?.id === recipe.id && <div className="space-y-3 border-t border-border pt-3">
        <h4 className="font-medium">Confirm what you ate</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Consumed amount<Input type="number" min="0.01" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); requestId.current = randomUUID(); }} /></label>
          <label className="text-sm">Amount unit<select className="mt-1 w-full rounded border border-border bg-background p-2" value={unit} onChange={(event) => { setUnit(event.target.value); requestId.current = randomUUID(); }}><option value="portions">Portions</option>{recipe.prepared_weight_g && <option value="grams">Grams</option>}</select></label>
          <label className="text-sm">Consumption day<Input type="date" value={logDay} onChange={(event) => { setLogDay(event.target.value); requestId.current = randomUUID(); }} /></label>
          <label className="text-sm">Consumption meal<select className="mt-1 w-full rounded border border-border bg-background p-2" value={meal} onChange={(event) => { setMeal(event.target.value); requestId.current = randomUUID(); }}><option value="">Choose meal</option>{["breakfast", "lunch", "dinner", "snack", "pre", "post"].map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <p className="text-sm">{unit === "portions" ? Number(((recipe.per_portion.kcal || 0) * Number(amount)).toFixed(2)) : Number(((recipe.totals.kcal || 0) * Number(amount) / recipe.prepared_weight_g!).toFixed(2))} kcal will be recorded.</p>
        <Button disabled={busy || !meal || !logDay || !(Number(amount) > 0)} onClick={() => perform(async () => {
          const result = await api.recipes.log(recipe.id, { expected_revision: logging.revision, request_id: requestId.current,
            ...(unit === "portions" ? { portions: Number(amount) } : { grams: Number(amount) }), day: logDay, meal });
          setReceipt(result); setLogging(null); announceWorkflowChange(); onLogged(logDay);
        })}>Confirm log portion</Button>
        <Button variant="outline" onClick={() => setLogging(null)}>Cancel logging</Button>
      </div>}
    </article>)}
  </section>;
}
