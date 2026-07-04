"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  MealPlan,
  NutritionDayTotals,
  NutritionEstimate,
  NutritionLog,
  ShoppingList,
  Targets,
} from "@/lib/api";
import { Card, StatRow } from "@/components/ui";
import { MacroProgress } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/ui/markdown";
import {
  Utensils,
  ShoppingCart,
  ChefHat,
  CalendarClock,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";

const MEALS = ["breakfast", "lunch", "dinner", "snack", "pre", "post"];
const DAY_TYPES = ["auto", "rest", "gym", "fencing", "double", "competition"];

export default function NutritionPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<NutritionDayTotals | null>(null);
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [shopping, setShopping] = useState<ShoppingList | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [shopBusy, setShopBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dayTypeOverride, setDayTypeOverride] = useState<string>("auto");
  const [loading, setLoading] = useState(true);

  // Confirm-before-save: /nutrition/estimate never persists. The athlete
  // reviews/edits the macros here, then /nutrition/log saves them.
  const [estimate, setEstimate] = useState<NutritionEstimate | null>(null);
  const [draft, setDraft] = useState({
    kcal: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
    fiber_g: "",
  });
  const [confirming, setConfirming] = useState(false);
  const estimateAbortRef = useRef<AbortController | null>(null);

  function refresh() {
    Promise.all([
      api.nutrition.totals(today).then(setTotals).catch(() => {}),
      api.nutrition.list(7).then(setLogs).catch(() => {}),
      api.targets.today().then((t) => {
        setTargets(t);
        setDayTypeOverride(t.override_source === "manual" ? t.day_type : "auto");
      }).catch(() => {}),
      api.mealplan.get(today).then(setPlan).catch(() => {}),
    ]).finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function handleDayTypeChange(value: string) {
    setDayTypeOverride(value);
    setErr(null);
    try {
      if (value === "auto") {
        await api.targets.clearDayType(today);
      } else {
        await api.targets.setDayType(today, value);
      }
      const t = await api.targets.today();
      setTargets(t);
      api.nutrition.totals(today).then(setTotals).catch(() => {});
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function requestEstimate() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);

    const controller = new AbortController();
    estimateAbortRef.current = controller;

    try {
      const est = await api.nutrition.estimate(text.trim(), controller.signal);
      setEstimate(est);
      setDraft({
        kcal: String(est.kcal),
        protein_g: String(est.protein_g),
        carbs_g: String(est.carbs_g),
        fat_g: String(est.fat_g),
        fiber_g: est.fiber_g != null ? String(est.fiber_g) : "",
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(e?.message ?? String(e));
      }
    } finally {
      estimateAbortRef.current = null;
      setBusy(false);
    }
  }

  function cancelEstimate() {
    estimateAbortRef.current?.abort();
  }

  function discardEstimate() {
    setEstimate(null);
  }

  async function confirmLog() {
    if (!estimate || confirming) return;
    setConfirming(true);
    setErr(null);
    try {
      await api.nutrition.log({
        raw_text: text.trim(),
        meal: meal || undefined,
        kcal: Number(draft.kcal),
        protein_g: Number(draft.protein_g),
        carbs_g: Number(draft.carbs_g),
        fat_g: Number(draft.fat_g),
        fiber_g: draft.fiber_g ? Number(draft.fiber_g) : undefined,
        micros: estimate.micros,
        items: estimate.items,
        confidence: estimate.confidence,
        notes: estimate.notes,
      });
      setText("");
      setEstimate(null);
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.nutrition.delete(id);
      refresh();
    } catch (e: any) {
      setErr(e?.message);
    }
  }

  async function generatePlan() {
    setPlanBusy(true);
    setErr(null);
    try {
      const p = await api.mealplan.generateToday();
      setPlan(p);
    } catch (e: any) {
      setErr(e?.message);
    } finally {
      setPlanBusy(false);
    }
  }

  async function loadShopping() {
    setShopBusy(true);
    setErr(null);
    try {
      const s = await api.shopping.week();
      setShopping(s);
    } catch (e: any) {
      setErr(e?.message);
    } finally {
      setShopBusy(false);
    }
  }

  function renderMealPlan(plan: Record<string, unknown>) {
    const mealKeys = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack", "pre_workout", "post_workout"];
    const found = mealKeys.filter((k) => k in plan);

    if (found.length === 0) {
      return (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted p-4 border border-border max-h-96 overflow-auto">
          {JSON.stringify(plan, null, 2)}
        </pre>
      );
    }

    return (
      <div className="space-y-3">
        {found.map((mealKey) => {
          const mealData = plan[mealKey] as any;
          const label = mealKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <div key={mealKey} className="border border-border p-4">
              <h4 className="text-sm font-semibold text-foreground mb-2">{label}</h4>
              {Array.isArray(mealData?.items ?? mealData) ? (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {(mealData?.items ?? mealData).map((item: any, i: number) => (
                    <li key={i} className="flex justify-between">
                      <span>{typeof item === "string" ? item : item?.name ?? item?.food ?? JSON.stringify(item)}</span>
                      {item?.amount && (
                        <span className="text-muted-foreground font-mono text-xs">
                          {item.amount}{item.unit ? ` ${item.unit}` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : typeof mealData === "object" && mealData !== null ? (
                <div className="text-sm text-muted-foreground">
                  {mealData.description && <p>{mealData.description}</p>}
                  {mealData.kcal && (
                    <p className="text-xs text-muted-foreground mt-1.5 font-mono">
                      ~{mealData.kcal} kcal
                      {mealData.protein_g ? ` · P${mealData.protein_g}` : ""}
                      {mealData.carbs_g ? ` · C${mealData.carbs_g}` : ""}
                      {mealData.fat_g ? ` · F${mealData.fat_g}` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{String(mealData)}</p>
              )}
            </div>
          );
        })}
        {plan.totals != null && (
          <p className="text-xs text-muted-foreground font-mono mt-2">
            Plan totals: {JSON.stringify(plan.totals)}
          </p>
        )}
      </div>
    );
  }

  const todayLogs = logs.filter((l) => l.day === today);
  const earlierLogs = logs.filter((l) => l.day !== today);

  return (
    <div className="space-y-16 md:space-y-20">
      {/* Header */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          Fuel &amp; recovery
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Nutrition
        </h1>
        <p className="mt-4 text-sm text-muted-foreground font-mono">
          Track meals, macros, and meal plans
        </p>
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* Log a meal */}
      <Card title="Log a meal" icon={<Utensils className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          Describe what you ate. The coach LLM will estimate macros, key micros,
          and a confidence level. Quantities help — &ldquo;200g chicken with 1
          cup of rice&rdquo; beats &ldquo;chicken with rice&rdquo;. Nothing is
          saved until you confirm the numbers below.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Select value={meal} onValueChange={setMeal}>
            <SelectTrigger className="sm:w-[140px]">
              <Utensils className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Meal" />
            </SelectTrigger>
            <SelectContent>
              {MEALS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); requestEstimate(); }
            }}
            placeholder="200g chicken breast, 150g cooked rice, broccoli, olive oil"
            className="flex-1"
            disabled={!!estimate}
            aria-label="Meal description"
          />
          <Button onClick={requestEstimate} disabled={busy || !!estimate || !text.trim()}>
            {busy ? "Estimating…" : "Estimate"}
          </Button>
          {busy && (
            <Button onClick={cancelEstimate} variant="ghost" aria-label="Cancel estimate">
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
        </div>

        {/* Review/edit before saving */}
        {estimate && (
          <div className="mt-5 border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Review estimate
              </span>
              <Badge
                variant={estimate.confidence === "low" ? "destructive" : "outline"}
              >
                {estimate.confidence} confidence
              </Badge>
            </div>

            {estimate.confidence === "low" && (
              <div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-400">
                  Low-confidence estimate — double-check these numbers before logging.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(
                [
                  ["kcal", "Kcal"],
                  ["protein_g", "Protein g"],
                  ["carbs_g", "Carbs g"],
                  ["fat_g", "Fat g"],
                  ["fiber_g", "Fiber g"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block">
                    {label}
                  </label>
                  <Input
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    inputMode="decimal"
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>

            {estimate.notes && (
              <Markdown className="text-xs text-muted-foreground">{estimate.notes}</Markdown>
            )}

            <div className="flex gap-2 pt-1">
              <Button onClick={confirmLog} disabled={confirming} size="sm">
                {confirming ? "Saving…" : "Confirm & log"}
              </Button>
              <Button onClick={discardEstimate} disabled={confirming} size="sm" variant="ghost">
                <X className="h-3.5 w-3.5" />
                Discard
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Targets vs intake */}
      {loading && !targets ? (
        <Card title="Targets vs intake">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </Card>
      ) : targets && totals ? (
        <Card
          title={`Targets vs intake — ${targets.day_type} day, ${targets.phase} phase`}
          action={
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <Badge
                variant={targets.override_source === "manual" ? "default" : "secondary"}
              >
                {targets.override_source === "manual" ? "manual" : "auto"}
              </Badge>
              <Select value={dayTypeOverride} onValueChange={handleDayTypeChange}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <CalendarClock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_TYPES.map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {dt === "auto" ? "Auto" : dt.charAt(0).toUpperCase() + dt.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        >
          <div className="space-y-3">
            <MacroProgress label="Calories" actual={totals.kcal} target={targets.kcal} unit="kcal" />
            <MacroProgress label="Protein" actual={totals.protein_g} target={targets.protein_g} unit="g" />
            <MacroProgress label="Carbs" actual={totals.carbs_g} target={targets.carbs_g} unit="g" />
            <MacroProgress label="Fat" actual={totals.fat_g} target={targets.fat_g} unit="g" />
            <MacroProgress label="Fiber" actual={totals.fiber_g} target={targets.fiber_g} unit="g" />
          </div>
          {targets.notes && (
            <p className="text-xs text-muted-foreground mt-4 font-mono">{targets.notes}</p>
          )}
        </Card>
      ) : null}

      {/* Summary + Micros + Today's entries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <Card title={`Today (${today})`}>
          {loading && !totals ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : totals ? (
            <>
              <StatRow label="Calories" value={`${totals.kcal.toFixed(0)} kcal`} />
              <StatRow label="Protein" value={`${totals.protein_g.toFixed(0)} g`} />
              <StatRow label="Carbs" value={`${totals.carbs_g.toFixed(0)} g`} />
              <StatRow label="Fat" value={`${totals.fat_g.toFixed(0)} g`} />
              <StatRow label="Fiber" value={`${totals.fiber_g.toFixed(0)} g`} />
              <StatRow label="Entries" value={totals.entry_count} />
            </>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="h-10 w-10 border border-dashed border-border flex items-center justify-center mb-2">
                <Utensils className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <p className="text-muted-foreground text-sm font-medium">No data yet</p>
            </div>
          )}
        </Card>

        <Card title="Today's micros">
          {loading && !totals ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : totals && Object.keys(totals.micros).length > 0 ? (
            Object.entries(totals.micros)
              .filter(([k]) => !["items", "confidence", "notes"].includes(k))
              .map(([k, v]) => (
                <StatRow
                  key={k}
                  label={k}
                  value={typeof v === "number" ? v.toFixed(1) : String(v)}
                />
              ))
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-muted-foreground text-sm font-medium">No data yet</p>
            </div>
          )}
        </Card>

        <Card title="Today's entries">
          {loading && todayLogs.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : todayLogs.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-muted-foreground text-sm font-medium">Nothing logged yet</p>
              <p className="text-muted-foreground/60 text-xs mt-1 font-mono">Log a meal above to see it here</p>
            </div>
          ) : (
            <ul className="space-y-3 divide-y divide-border">
              {todayLogs.map((l) => (
                <li key={l.id} className="text-sm pt-3 first:pt-0">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">
                      {l.meal || "\u2014"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-accent hover:bg-accent/10"
                      onClick={() => remove(l.id)}
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="text-foreground mt-1.5 font-medium">{l.raw_text}</div>
                  <div className="text-muted-foreground text-xs mt-1 font-mono">
                    {l.kcal?.toFixed(0)} kcal · P{" "}
                    {l.protein_g?.toFixed(0)} / C {l.carbs_g?.toFixed(0)} / F{" "}
                    {l.fat_g?.toFixed(0)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Meal plan */}
      <Card
        title="Today's meal plan"
        icon={<ChefHat className="h-4 w-4" />}
        action={
          <Button onClick={generatePlan} disabled={planBusy} size="sm" variant={plan ? "outline" : "default"}>
            <ChefHat className="h-3.5 w-3.5" />
            {planBusy ? "Generating…" : plan ? "Regenerate" : "Generate"}
          </Button>
        }
      >
        {!plan ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
              <ChefHat className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">
              No plan for today yet
            </p>
            <p className="text-muted-foreground/60 text-xs mt-1 font-mono">Click generate to have the coach build one</p>
          </div>
        ) : (
          renderMealPlan(plan.plan)
        )}
      </Card>

      {/* Shopping list */}
      <Card
        title="Weekly shopping list"
        icon={<ShoppingCart className="h-4 w-4" />}
        action={
          <Button onClick={loadShopping} disabled={shopBusy} size="sm" variant="outline">
            <ShoppingCart className="h-3.5 w-3.5" />
            {shopBusy ? "Loading…" : shopping ? "Refresh" : "Load"}
          </Button>
        }
      >
        {!shopping ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
              <ShoppingCart className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">
              Weekly shopping aggregator
            </p>
            <p className="text-muted-foreground/60 text-xs mt-1 font-mono">Aggregates ingredients from generated meal plans for the next 7 days</p>
          </div>
        ) : shopping.item_count === 0 ? (
          <p className="text-muted-foreground text-sm font-mono">
            No meal plans generated yet for {shopping.start} → {shopping.end}.
            {shopping.missing_days.length > 0 && (
              <> Missing: {shopping.missing_days.join(", ")}</>
            )}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3 font-mono">
              {shopping.start} → {shopping.end} · {shopping.item_count} items ·
              covered: {shopping.days_covered.length}d
              {shopping.missing_days.length > 0 && (
                <> · missing: {shopping.missing_days.join(", ")}</>
              )}
            </p>
            <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {shopping.items.map((it, i) => (
                <li key={i} className="flex justify-between border-b border-border py-2">
                  <span className="text-foreground font-medium">{it.name}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {it.amount ?? ""} {it.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Earlier entries */}
      <Card title="Earlier (last 7 days)">
        {earlierLogs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-muted-foreground text-sm font-medium">No earlier entries</p>
          </div>
        ) : (
          <ul className="space-y-1 text-sm">
            {earlierLogs.map((l) => (
              <li key={l.id} className="flex justify-between text-muted-foreground py-1.5 border-b border-border last:border-0">
                <span>
                  <span className="text-muted-foreground mr-2 font-mono text-xs">{l.day}</span>
                  <span className="text-foreground font-medium">{l.raw_text}</span>
                </span>
                <span className="font-mono text-muted-foreground text-xs">
                  {l.kcal?.toFixed(0)} kcal
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
