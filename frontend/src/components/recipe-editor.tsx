"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type IngredientInput, type RecipeComposition, type RecipeInput, type SavedFood } from "@/lib/api";

const selectClass = "mt-1 w-full rounded border border-border bg-background p-2";
const macroLabels = { kcal: "Calories", protein_g: "Protein", carbs_g: "Carbs", fat_g: "Fat", fiber_g: "Fiber" };
const number = (value: string) => value === "" ? null : Number(value);

export const emptyRecipe = (): RecipeInput => ({ name: "", portions: null, prepared_weight_g: null,
  prep_time_min: null, ingredients: [{ qty_g: null, basis: null }] });

export function editSnapshot(recipe: RecipeComposition): RecipeInput {
  return { name: recipe.name, portions: recipe.portions, prepared_weight_g: recipe.prepared_weight_g,
    prep_time_min: recipe.prep_time_min, ingredients: recipe.ingredients.map((item, index) => ({
      name: item.name, qty_g: item.qty_g, basis: item.basis, snapshot_index: index,
    })) };
}

export function RecipeEditor({ value, onChange, foods, snapshot }: {
  value: RecipeInput; onChange: (value: RecipeInput) => void; foods: SavedFood[];
  snapshot?: RecipeComposition;
}) {
  function updateLine(index: number, changes: Partial<IngredientInput>) {
    onChange({ ...value, ingredients: value.ingredients.map((line, i) => i === index ? { ...line, ...changes } : line) });
  }
  return <div className="space-y-4">
    <label className="block text-sm">Recipe name<Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <label className="text-sm">Number of portions<Input type="number" min="0.01" step="any" value={value.portions ?? ""} onChange={(event) => onChange({ ...value, portions: number(event.target.value) })} /></label>
      <label className="text-sm">Prepared weight (g, optional)<Input type="number" min="0.01" step="any" value={value.prepared_weight_g ?? ""} onChange={(event) => onChange({ ...value, prepared_weight_g: number(event.target.value) })} /></label>
      <label className="text-sm">Preparation time (minutes)<Input type="number" min="0" max="240" value={value.prep_time_min ?? ""} onChange={(event) => onChange({ ...value, prep_time_min: number(event.target.value) })} /></label>
    </div>
    {value.ingredients.map((line, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm">Ingredient {index + 1}</legend>
      <label className="block text-sm">Ingredient source
        <select aria-label={`Ingredient ${index + 1} source`} className={selectClass}
          value={line.snapshot_index != null ? "snapshot" : line.food_id ? String(line.food_id) : line.values ? line.source : ""}
          onChange={(event) => {
            const chosen = event.target.value;
            if (chosen === "supplied" || chosen === "estimated") {
              updateLine(index, { food_id: null, snapshot_index: null, source: chosen,
                values: { name: line.name || "", kcal: null, protein_g: null, carbs_g: null, fat_g: null,
                  fiber_g: null, micros: [], serving_name: null, serving_size_g: null } });
            } else if (chosen === "snapshot") {
              updateLine(index, { snapshot_index: index, food_id: null, values: null });
            } else {
              updateLine(index, { food_id: chosen ? Number(chosen) : null, snapshot_index: null,
                values: null, source: "saved", name: foods.find((food) => food.id === Number(chosen))?.name || line.name });
            }
          }}>
          <option value="">Choose a food</option>
          {line.snapshot_index != null && <option value="snapshot">Keep saved values: {line.name}</option>}
          {foods.map((food) => <option key={food.id} value={food.id}>{food.name} (current values)</option>)}
          <option value="supplied">Supplied values per 100 g</option>
          <option value="estimated">Estimated values per 100 g</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Quantity (g)<Input aria-label={`Ingredient ${index + 1} grams`} type="number" min="0.01" step="any" value={line.qty_g ?? ""} onChange={(event) => updateLine(index, { qty_g: number(event.target.value) })} /></label>
        <label className="text-sm">Weight measured
          <select aria-label={`Ingredient ${index + 1} basis`} className={selectClass} value={line.basis || ""} onChange={(event) => updateLine(index, { basis: event.target.value as IngredientInput["basis"] || null })}>
            <option value="">Confirm basis</option><option value="raw">Raw</option><option value="cooked">Cooked</option><option value="as_sold">As sold</option>
          </select>
        </label>
      </div>
      {line.values && <div className="space-y-2">
        <label className="block text-sm">Ingredient name<Input value={line.values.name} onChange={(event) => updateLine(index, { name: event.target.value, values: { ...line.values!, name: event.target.value } })} /></label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(macroLabels).map(([key, label]) => <label key={key} className="text-sm">{label} per 100 g<Input type="number" min="0" step="any" placeholder="Unknown" value={line.values![key as keyof typeof macroLabels] ?? ""} onChange={(event) => updateLine(index, { values: { ...line.values!, [key]: number(event.target.value) } })} /></label>)}
        </div>
        <p className="text-xs text-muted-foreground">Blank values stay unknown. Nutrient units from imports are retained.</p>
      </div>}
      {line.snapshot_index != null && snapshot && <p className="text-xs text-muted-foreground">
        Values remain those saved with this recipe. Choose a current product above to explicitly refresh them.
      </p>}
      <Button type="button" variant="outline" disabled={value.ingredients.length === 1} onClick={() => onChange({ ...value, ingredients: value.ingredients.filter((_, i) => i !== index) })}>Remove ingredient {index + 1}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" onClick={() => onChange({ ...value, ingredients: [...value.ingredients, { qty_g: null, basis: null }] })}>Add ingredient</Button>
  </div>;
}

export function RecipeValues({ recipe }: { recipe: RecipeComposition }) {
  const show = (value: number | null | undefined) => value == null ? "Unknown" : Number(value.toFixed(2));
  return <div className="space-y-3 text-sm">
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead><tr><th>Nutrient</th><th>Whole recipe</th><th>Per portion</th></tr></thead>
        <tbody>{Object.entries(recipe.totals).map(([key, value]) => <tr key={key}>
          <td className="py-1">{macroLabels[key as keyof typeof macroLabels] || key.replace(/_/g, " ")}</td>
          <td>{show(value)}{value == null && recipe.known_subtotals[key] > 0 && <span className="block text-xs text-muted-foreground">Known subtotal: {show(recipe.known_subtotals[key])}</span>}</td>
          <td>{show(recipe.per_portion[key])}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="space-y-1">{recipe.ingredients.map((line, index) => <li key={index}>
      {line.qty_g ?? "Unknown"} g {line.name} · {line.basis || "Confirm measurement"} · {line.source === "saved" ? "Saved product values" : line.source}
      <details className="text-xs text-muted-foreground"><summary>Ingredient values per 100 g</summary>
        {Object.entries(line.nutrients_per_100g).map(([key, value]) => <p key={key}>{key}: {show(value)}</p>)}
      </details>
    </li>)}</ul>
    {recipe.questions.length > 0 && <div role="alert">{recipe.questions.map((question) => <p key={question}>{question}</p>)}</div>}
    {!recipe.loggable && <p>Core nutrients or ingredient details are incomplete. Resolve them before logging a portion.</p>}
  </div>;
}
