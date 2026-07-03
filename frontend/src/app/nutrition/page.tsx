"use client";

import { useEffect, useState } from "react";
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
    try {
      const est = await api.nutrition.estimate(text.trim());
      setEstimate(est);
      setDraft({
        kcal: String(est.kcal),
        protein_g: String(est.protein_g),
        carbs_g: String(est.carbs_g),
        fat_g: String(est.fat_g),
        fiber_g: est.fiber_g != null ? String(est.fiber_g) : "",
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
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
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted p-4 border-2 border-foreground/10 max-h-96 overflow-auto">
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
            <div key={mealKey} className="border-2 border-foreground/20 bg-card p-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">{label}</h4>
              {Array.isArray(mealData?.items ?? mealData) ? (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {(mealData?.items ?? mealData).map((item: any, i: number) => (
                    <li key={i} className="flex justify-between">
                      <span>{typeof item === "string" ? item : item?.name ?? item?.food ?? JSON.stringify(item)}</span>
                      {item?.amount && (
                        <span className="text-muted-foreground font-mono text-xs font-bold">
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
                    <p className="text-xs text-muted-foreground mt-1.5 font-mono font-bold">
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
          <p className="text-xs text-muted-foreground font-mono font-bold mt-2">
            Plan totals: {JSON.stringify(plan.totals)}
          </p>
        )}
      </div>
    );
  }

  const todayLogs = logs.filter((l) => l.day === today);
  const earlierLogs = logs.filter((l) => l.day !== today);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="border-b-4 border-foreground pb-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Nutrition</h1>
        <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1.5 font-mono">Track meals, macros, and meal plans</p>
      </div>

      {/* Log a meal */}
      <Card title="Log a meal" icon={<Utensils className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground mb-3 font-mono">
          Describe what you ate. The coach LLM will estimate macros, key micros,
          and a confidence level. Quantities help — &ldquo;200g chicken with 1
          cup of rice&rdquo; beats &ldquo;chicken with rice&rdquo;. Nothing is
          saved until you confirm the numbers below.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Select value={meal} onValueChange={setMeal}>
            <SelectTrigger className="w-[140px]">
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
          />
          <Button onClick={requestEstimate} disabled={busy || !!estimate}>
            {busy ? "ESTIMATING..." : "ESTIMATE"}
          </Button>
        </div>
        {err && (
          <div className="border-2 border-bauhaus-red bg-bauhaus-red/5 px-3 py-2 mt-3">
            <p className="text-bauhaus-red text-sm font-bold">{err}</p>
          </div>
        )}

        {/* Review/edit before saving */}
        {estimate && (
          <div className="mt-4 border-2 border-foreground/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Review estimate
              </span>
              <Badge
                variant={estimate.confidence === "low" ? "destructive" : "outline"}
                className="text-[10px] uppercase tracking-wider"
              >
                {estimate.confidence} confidence
              </Badge>
            </div>

            {estimate.confidence === "low" && (
              <div className="flex items-start gap-2 border-2 border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-400">
                  Low-confidence estimate — double-check these numbers before logging.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {(
                [
                  ["kcal", "Kcal"],
                  ["protein_g", "Protein g"],
                  ["carbs_g", "Carbs g"],
                  ["fat_g", "Fat g"],
                  ["fiber_g", "Fiber g"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                    {label}
                  </span>
                  <Input
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    inputMode="decimal"
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>

            {estimate.notes && (
              <p className="text-xs text-muted-foreground font-mono">{estimate.notes}</p>
            )}

            <div className="flex gap-2">
              <Button onClick={confirmLog} disabled={confirming} size="sm">
                {confirming ? "SAVING..." : "CONFIRM & LOG"}
              </Button>
              <Button onClick={discardEstimate} disabled={confirming} size="sm" variant="ghost">
                <X className="h-3.5 w-3.5 mr-1" />
                DISCARD
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
          <div className="space-y-2">
            <MacroProgress label="Calories" actual={totals.kcal} target={targets.kcal} unit="kcal" />
            <MacroProgress label="Protein" actual={totals.protein_g} target={targets.protein_g} unit="g" />
            <MacroProgress label="Carbs" actual={totals.carbs_g} target={targets.carbs_g} unit="g" />
            <MacroProgress label="Fat" actual={totals.fat_g} target={targets.fat_g} unit="g" />
            <MacroProgress label="Fiber" actual={totals.fiber_g} target={targets.fiber_g} unit="g" />
          </div>
          {targets.notes && (
            <p className="text-xs text-muted-foreground mt-3 font-mono">{targets.notes}</p>
          )}
        </Card>
      ) : null}

      {/* Summary + Micros + Today's entries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
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
            <div className="flex flex-col items-center py-6 text-center">
              <div className="h-10 w-10 border-2 border-foreground flex items-center justify-center mb-2 shadow-hard-sm">
                <Utensils className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No data yet</p>
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
            <div className="flex flex-col items-center py-6 text-center">
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No data yet</p>
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
            <div className="flex flex-col items-center py-6 text-center">
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Nothing logged yet</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {todayLogs.map((l) => (
                <li key={l.id} className="text-sm border-b-2 border-foreground/10 pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      {l.meal || "\u2014"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-bauhaus-red hover:bg-bauhaus-red/10"
                      onClick={() => remove(l.id)}
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="text-foreground mt-1 font-medium">{l.raw_text}</div>
                  <div className="text-muted-foreground text-xs mt-1 font-mono font-bold">
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
            <ChefHat className="h-3.5 w-3.5 mr-1.5" />
            {planBusy ? "GENERATING..." : plan ? "REGENERATE" : "GENERATE"}
          </Button>
        }
      >
        {!plan ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
              <ChefHat className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">
              No plan for today yet
            </p>
            <p className="text-muted-foreground text-xs mt-1 font-mono">Click Generate to have the coach build one</p>
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
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
            {shopBusy ? "LOADING..." : shopping ? "REFRESH" : "LOAD"}
          </Button>
        }
      >
        {!shopping ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
              <ShoppingCart className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">
              Weekly shopping aggregator
            </p>
            <p className="text-muted-foreground text-xs mt-1 font-mono">Aggregates ingredients from generated meal plans for the next 7 days</p>
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
            <p className="text-xs text-muted-foreground mb-3 font-mono font-bold">
              {shopping.start} → {shopping.end} · {shopping.item_count} items ·
              covered: {shopping.days_covered.length}d
              {shopping.missing_days.length > 0 && (
                <> · missing: {shopping.missing_days.join(", ")}</>
              )}
            </p>
            <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {shopping.items.map((it, i) => (
                <li key={i} className="flex justify-between border-b-2 border-foreground/10 py-2">
                  <span className="text-foreground font-medium">{it.name}</span>
                  <span className="font-mono text-muted-foreground text-xs font-bold">
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
          <div className="flex flex-col items-center py-6 text-center">
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No earlier entries</p>
          </div>
        ) : (
          <ul className="space-y-1 text-sm">
            {earlierLogs.map((l) => (
              <li key={l.id} className="flex justify-between text-muted-foreground py-1 border-b border-foreground/5">
                <span>
                  <span className="text-muted-foreground mr-2 font-mono text-xs font-bold">{l.day}</span>
                  <span className="text-foreground font-medium">{l.raw_text}</span>
                </span>
                <span className="font-mono text-muted-foreground text-xs font-bold">
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
