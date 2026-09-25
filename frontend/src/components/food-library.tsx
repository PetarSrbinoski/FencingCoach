"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type FoodNutrient, type SavedFood, type SavedFoodInput } from "@/lib/api";
import { Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MACROS = [
  ["kcal", "Calories (kcal)"], ["protein_g", "Protein (g)"],
  ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"], ["fiber_g", "Fiber (g)"],
] as const;
type Macro = typeof MACROS[number][0];
type MicroDraft = { name: string; amount: string; unit: FoodNutrient["unit"] };
type Draft = Record<Macro, string> & {
  name: string; serving_name: string; serving_size_g: string; micros: MicroDraft[];
};
const emptyDraft = (): Draft => ({
  name: "", kcal: "", protein_g: "", carbs_g: "", fat_g: "", fiber_g: "",
  serving_name: "", serving_size_g: "", micros: [],
});
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const numberOrNull = (value: string): number | null => {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Use nonnegative numbers for nutrients.");
  return number;
};

export function FoodLibrary({ onLogged, meal }: { onLogged: () => void; meal: string }) {
  const [foods, setFoods] = useState<SavedFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("grams");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    try { setFoods(await api.foods.list()); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function edit(food?: SavedFood) {
    setError(null);
    setMessage("");
    setEditingId(food?.id ?? null);
    setDraft(food ? {
      name: food.name, kcal: food.kcal?.toString() ?? "",
      protein_g: food.protein_g?.toString() ?? "", carbs_g: food.carbs_g?.toString() ?? "",
      fat_g: food.fat_g?.toString() ?? "", fiber_g: food.fiber_g?.toString() ?? "",
      serving_name: food.serving_name ?? "", serving_size_g: food.serving_size_g?.toString() ?? "",
      micros: food.micros.map(m => ({ ...m, amount: m.amount.toString() })),
    } : emptyDraft());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data: SavedFoodInput = {
        name: draft.name.trim(),
        kcal: numberOrNull(draft.kcal), protein_g: numberOrNull(draft.protein_g),
        carbs_g: numberOrNull(draft.carbs_g), fat_g: numberOrNull(draft.fat_g),
        fiber_g: numberOrNull(draft.fiber_g),
        serving_name: draft.serving_name.trim() || null,
        serving_size_g: numberOrNull(draft.serving_size_g),
        micros: draft.micros.map(m => {
          const amount = numberOrNull(m.amount);
          if (!m.name.trim() || amount === null) throw new Error("Enter a name and amount for each nutrient.");
          return { name: m.name.trim(), amount, unit: m.unit };
        }),
      };
      if (data.serving_size_g !== null && data.serving_size_g <= 0) throw new Error("Serving weight must be greater than zero.");
      if (data.serving_name && data.serving_size_g === null) throw new Error("Enter the serving weight in grams.");
      const saved = editingId === null ? await api.foods.create(data) : await api.foods.update(editingId, data);
      setDraft(null);
      setSelectedId(saved.id);
      setQuantity("");
      setQuantityUnit("grams");
      setMessage(`Saved ${saved.name} to your library.`);
      await refresh();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function remove(food: SavedFood) {
    setBusy(true);
    setError(null);
    try {
      await api.foods.delete(food.id);
      if (selectedId === food.id) setSelectedId(null);
      if (editingId === food.id) setDraft(null);
      setMessage(`Removed ${food.name} from the library. Past meals are preserved.`);
      await refresh();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function log(event: FormEvent) {
    event.preventDefault();
    if (selectedId === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amount = numberOrNull(quantity);
      if (amount === null || amount <= 0) throw new Error("Enter how many grams or servings you ate.");
      const entry = await api.foods.log([{
        food_id: selectedId,
        ...(quantityUnit === "grams" ? { grams: amount } : { servings: amount }),
      }], meal || undefined);
      setMessage(`Logged ${entry.raw_text}: ${entry.kcal} kcal, ${entry.protein_g} g protein, ${entry.carbs_g} g carbs, ${entry.fat_g} g fat.`);
      setQuantity("");
      onLogged();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  const selected = foods.find(food => food.id === selectedId);
  const visible = foods.filter(food => food.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const duplicate = draft && foods.find(food => food.id !== editingId &&
    food.name.trim().toLocaleLowerCase().replace(/\s+/g, " ") === draft.name.trim().toLocaleLowerCase().replace(/\s+/g, " "));
  const missingCore = selected && MACROS.slice(0, 4).filter(([key]) => selected[key] === null);

  return (
    <Card title="My foods" action={<Button size="sm" onClick={() => edit()} disabled={busy}>Add food</Button>}>
      <p className="text-sm text-muted-foreground mb-4">Save label values once, then log grams or a saved serving. You can also ask the coach to save a food.</p>
      {error && <p role="alert" className="text-sm text-destructive mb-3">{error}</p>}
      {message && <p role="status" className="text-sm mb-3">{message}</p>}
      {draft && (
        <form onSubmit={save} className="space-y-4 border border-border p-4 mb-5">
          <h3 className="font-medium">{editingId === null ? "New food" : "Edit food"} · nutrients per 100 g</h3>
          <p className="text-xs text-muted-foreground">Enter supplied values. Blank means unknown; zero means a known zero.</p>
          <label className="block text-sm">Food name
            <Input required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          {duplicate && <div className="text-sm space-y-2">
            <p>This name already exists. Choose a distinct name for a variant, or edit the existing food.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => edit(duplicate)}>Edit existing food</Button>
          </div>}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {MACROS.map(([key, label]) => <label key={key} className="text-xs">{label}
              <Input type="number" min="0" step="any" placeholder="Unknown" value={draft[key]}
                onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
            </label>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Serving name (optional)
              <Input placeholder="1 bar" maxLength={80} value={draft.serving_name} onChange={e => setDraft({ ...draft, serving_name: e.target.value })} />
            </label>
            <label className="text-xs">Serving weight (g)
              <Input type="number" min="0.001" step="any" placeholder="60" value={draft.serving_size_g} onChange={e => setDraft({ ...draft, serving_size_g: e.target.value })} />
            </label>
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm mb-2">Micronutrients per 100 g</legend>
            {draft.micros.map((micro, index) => <div key={index} className="flex gap-2 items-end flex-wrap sm:flex-nowrap">
              <label className="text-xs flex-1 min-w-24">Nutrient {index + 1}
                <Input required maxLength={80} placeholder="Iron" value={micro.name} onChange={e => setDraft({ ...draft, micros: draft.micros.map((m, i) => i === index ? { ...m, name: e.target.value } : m) })} />
              </label>
              <label className="text-xs w-24">Amount {index + 1}
                <Input required type="number" min="0" step="any" value={micro.amount} onChange={e => setDraft({ ...draft, micros: draft.micros.map((m, i) => i === index ? { ...m, amount: e.target.value } : m) })} />
              </label>
              <label className="text-xs">Unit {index + 1}
                <select aria-label={`Unit ${index + 1}`} className="block h-10 border border-input bg-background px-2 text-sm" value={micro.unit}
                  onChange={e => setDraft({ ...draft, micros: draft.micros.map((m, i) => i === index ? { ...m, unit: e.target.value as FoodNutrient["unit"] } : m) })}>
                  {["g", "mg", "mcg", "IU"].map(unit => <option key={unit}>{unit}</option>)}
                </select>
              </label>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove nutrient ${index + 1}`} onClick={() => setDraft({ ...draft, micros: draft.micros.filter((_, i) => i !== index) })}>Remove</Button>
            </div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, micros: [...draft.micros, { name: "", amount: "", unit: "mg" }] })}>Add nutrient</Button>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !!duplicate}>{busy ? "Saving…" : "Save food"}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <Input aria-label="Search my foods" placeholder="Search my foods…" value={query} onChange={e => setQuery(e.target.value)} />
      {loading ? <p className="text-sm mt-3">Loading foods…</p> : visible.length === 0 ?
        <p className="text-sm text-muted-foreground mt-3">{foods.length ? "No matching foods." : "Your library is empty. Add a food with its label values to get started."}</p> :
        <ul className="divide-y divide-border max-h-72 overflow-y-auto mt-2">
          {visible.map(food => <li key={food.id} className="flex items-center gap-2 py-2">
            <button type="button" className="flex-1 text-left py-1 hover:text-accent" aria-pressed={selectedId === food.id} onClick={() => { setSelectedId(food.id); setQuantity(""); setQuantityUnit("grams"); setError(null); }}>
              <span className="font-medium text-sm">{food.name}</span>
              <span className="block text-xs text-muted-foreground">{food.kcal === null ? "Calories unknown" : `${food.kcal} kcal / 100 g`}{food.serving_size_g ? ` · ${food.serving_name || "serving"}: ${food.serving_size_g} g` : ""}</span>
            </button>
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Edit ${food.name}`} onClick={() => edit(food)}>Edit</Button>
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${food.name}`} onClick={() => remove(food)}>Remove</Button>
          </li>)}
        </ul>}
      {selected && <form onSubmit={log} className="mt-4 border border-border p-4 space-y-3">
        <h3 className="font-medium">Log {selected.name}</h3>
        <p className="text-xs text-muted-foreground">Per 100 g: {MACROS.map(([key, label]) => `${label}: ${selected[key] ?? "unknown"}`).join(" · ")}</p>
        {selected.micros.length > 0 && <p className="text-xs text-muted-foreground">{selected.micros.map(m => `${m.name}: ${m.amount} ${m.unit}`).join(" · ")}</p>}
        {missingCore && missingCore.length > 0 && <p className="text-sm text-amber-500">Edit this food to add {missingCore.map(([, label]) => label).join(", ")} before logging.</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs">Amount eaten
            <Input required type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-32" />
          </label>
          <label className="text-xs">Measure
            <select aria-label="Measure" className="block h-10 border border-input bg-background px-2 text-sm" value={quantityUnit} onChange={e => setQuantityUnit(e.target.value)}>
              <option value="grams">Grams</option>
              {selected.serving_size_g && <option value="servings">{selected.serving_name || "Serving"} ({selected.serving_size_g} g each)</option>}
            </select>
          </label>
          <Button type="submit" disabled={busy || !!missingCore?.length}>Log food</Button>
        </div>
        <p className="text-xs text-muted-foreground">Logs to today{meal ? ` · ${meal}` : ""}. Nutrients are calculated from your saved values.</p>
      </form>}
    </Card>
  );
}
