"use client";

import { useEffect, useState } from "react";
import {
  api,
  MealPlan,
  NutritionDayTotals,
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

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.nutrition.log(text.trim(), meal || undefined);
      setText("");
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
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
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded-lg max-h-96 overflow-auto">
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
            <div key={mealKey} className="rounded-lg border border-border/40 bg-surface-2/50 p-4">
              <h4 className="text-sm font-semibold text-foreground/90 mb-2">{label}</h4>
              {Array.isArray(mealData?.items ?? mealData) ? (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {(mealData?.items ?? mealData).map((item: any, i: number) => (
                    <li key={i} className="flex justify-between">
                      <span>{typeof item === "string" ? item : item?.name ?? item?.food ?? JSON.stringify(item)}</span>
                      {item?.amount && (
                        <span className="text-muted-foreground/50 font-mono text-xs">
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
                    <p className="text-xs text-muted-foreground/50 mt-1.5 font-mono">
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
          <p className="text-xs text-muted-foreground/50 font-mono mt-2">
            Plan totals: {JSON.stringify(plan.totals)}
          </p>
        )}
      </div>
    );
  }

  const todayLogs = logs.filter((l) => l.day === today);
  const earlierLogs = logs.filter((l) => l.day !== today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nutrition</h1>
        <p className="text-sm text-muted-foreground mt-1">Track meals, macros, and meal plans</p>
      </div>

      {/* Log a meal */}
      <Card title="Log a meal" icon={<Utensils className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground/60 mb-3">
          Describe what you ate. The coach LLM will estimate macros, key micros,
          and a confidence level. Quantities help — &ldquo;200g chicken with 1
          cup of rice&rdquo; beats &ldquo;chicken with rice&rdquo;.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Select value={meal} onValueChange={setMeal}>
            <SelectTrigger className="w-[140px]">
              <Utensils className="h-3.5 w-3.5 mr-1.5 text-muted-foreground/50" />
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
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="200g chicken breast, 150g cooked rice, broccoli, olive oil"
            className="flex-1"
          />
          <Button onClick={submit} disabled={busy}>
            {busy ? "Estimating\u2026" : "Log"}
          </Button>
        </div>
        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 mt-3">
            <p className="text-destructive text-sm">{err}</p>
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
            <div className="flex items-center gap-2">
              <Badge
                variant={targets.override_source === "manual" ? "default" : "secondary"}
              >
                {targets.override_source === "manual" ? "manual" : "auto"}
              </Badge>
              <Select value={dayTypeOverride} onValueChange={handleDayTypeChange}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <CalendarClock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground/50" />
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
            <p className="text-xs text-muted-foreground/50 mt-3">{targets.notes}</p>
          )}
        </Card>
      ) : null}

      {/* Summary + Micros + Today's entries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
              <Utensils className="h-8 w-8 text-muted-foreground/20 mb-2" />
              <p className="text-muted-foreground/60 text-sm">No data yet.</p>
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
              <p className="text-muted-foreground/60 text-sm">No data yet.</p>
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
              <p className="text-muted-foreground/60 text-sm">Nothing logged yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {todayLogs.map((l) => (
                <li key={l.id} className="text-sm border-b border-border/30 pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      {l.meal || "\u2014"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground/40 hover:text-destructive"
                      onClick={() => remove(l.id)}
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="text-foreground/90 mt-1">{l.raw_text}</div>
                  <div className="text-muted-foreground/50 text-xs mt-1 font-mono">
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
            {planBusy ? "Generating\u2026" : plan ? "Regenerate" : "Generate"}
          </Button>
        }
      >
        {!plan ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="h-10 w-10 rounded-xl bg-primary/8 flex items-center justify-center mb-3">
              <ChefHat className="h-5 w-5 text-primary/40" />
            </div>
            <p className="text-muted-foreground/60 text-sm">
              No plan for today yet. Click Generate to have the coach build one.
            </p>
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
            {shopBusy ? "Loading\u2026" : shopping ? "Refresh" : "Load"}
          </Button>
        }
      >
        {!shopping ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              <ShoppingCart className="h-5 w-5 text-muted-foreground/30" />
            </div>
            <p className="text-muted-foreground/60 text-sm">
              Aggregates ingredients from generated meal plans for the next 7 days.
            </p>
          </div>
        ) : shopping.item_count === 0 ? (
          <p className="text-muted-foreground/60 text-sm">
            No meal plans generated yet for {shopping.start} → {shopping.end}.
            {shopping.missing_days.length > 0 && (
              <> Missing: {shopping.missing_days.join(", ")}</>
            )}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground/50 mb-3 font-mono">
              {shopping.start} → {shopping.end} · {shopping.item_count} items ·
              covered: {shopping.days_covered.length}d
              {shopping.missing_days.length > 0 && (
                <> · missing: {shopping.missing_days.join(", ")}</>
              )}
            </p>
            <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {shopping.items.map((it, i) => (
                <li key={i} className="flex justify-between border-b border-border/30 py-2">
                  <span className="text-foreground/90">{it.name}</span>
                  <span className="font-mono text-muted-foreground/50 text-xs">
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
            <p className="text-muted-foreground/60 text-sm">No earlier entries.</p>
          </div>
        ) : (
          <ul className="space-y-1 text-sm">
            {earlierLogs.map((l) => (
              <li key={l.id} className="flex justify-between text-muted-foreground py-1">
                <span>
                  <span className="text-muted-foreground/50 mr-2 font-mono text-xs">{l.day}</span>
                  <span className="text-foreground/80">{l.raw_text}</span>
                </span>
                <span className="font-mono text-muted-foreground/50 text-xs">
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
