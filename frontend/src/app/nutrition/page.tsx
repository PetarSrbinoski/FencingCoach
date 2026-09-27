"use client";

import { useEffect, useRef, useState } from "react";
import { createJobObserver, type JobObservation } from "@/lib/job-observer";
import {
  api,
  MealPlan,
  Profile,
  NutritionDayTotals,
  NutritionEstimate,
  NutritionLog,
  ShoppingList,
  Targets,
} from "@/lib/api";
import { Card, StatRow } from "@/components/ui";
import { MacroProgress } from "@/components/charts";
import { FoodLibrary } from "@/components/food-library";
import { CompetitionNutritionPlanner } from "@/components/competition-nutrition-planner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  Coffee,
  Sun,
  Moon,
  Cookie,
  Zap,
  BatteryCharging,
  X,
  type LucideIcon,
} from "lucide-react";

const MEALS = ["breakfast", "lunch", "dinner", "snack", "pre", "post"];
const DAY_TYPES = ["auto", "rest", "gym", "fencing", "double", "competition"];

type MealPlanIngredient = { name: string; qty_g: number };

type MealPlanMeal = {
  slot: string;
  time: string;
  name: string;
  ingredients?: MealPlanIngredient[];
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  notes?: string;
};

type MealPlanTotals = {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
};

const SLOT_ICONS: Record<string, LucideIcon> = {
  breakfast: Coffee,
  lunch: Sun,
  dinner: Moon,
  snack: Cookie,
  pre_workout: Zap,
  post_workout: BatteryCharging,
};

function planContent(value: Record<string, unknown>): Record<string, unknown> | null {
  let current: unknown = value;
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.meals)) return record;
    current = record.plan;
  }
  return null;
}

function nutrient(value: number | undefined, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value} ${unit}` : `Unknown ${unit}`;
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function slotLabel(slot: string): string {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NutritionPage() {
  const [today, setToday] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<NutritionDayTotals | null>(null);
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shopping, setShopping] = useState<ShoppingList | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [shopBusy, setShopBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dayTypeOverride, setDayTypeOverride] = useState<string>("auto");
  const [loading, setLoading] = useState(true);
  const [dayError, setDayError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const dayRequest = useRef(0);
  const [estimateDestination, setEstimateDestination] = useState<{ day: string; meal: string } | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [editing, setEditing] = useState<NutritionLog | null>(null);
  const [repeating, setRepeating] = useState<NutritionLog | null>(null);
  const [entryDraft, setEntryDraft] = useState({ day: "", meal: "", raw_text: "", kcal: "", protein_g: "", carbs_g: "", fat_g: "", fiber_g: "", multiplier: "1" });
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryMessage, setEntryMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [repeatRequestId, setRepeatRequestId] = useState("");

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
  const estimateObserver = useRef(createJobObserver());

  // Resume watching an estimate that was still generating server-side
  // last time this page was open (e.g. the athlete navigated away or
  // reloaded before it finished) — see requestEstimate/pollEstimateResult.
  useEffect(() => {
    const raw = sessionStorage.getItem("pendingNutritionEstimate");
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { id?: number; text: string; day?: string; meal?: string; submission?: string };
        setText(saved.text);
        if (saved.day) setEstimateDestination({ day: saved.day, meal: saved.meal || "" });
        if (typeof saved.id === "number") {
          setBusy(true);
          pollEstimateResult(saved.id);
        }
      } catch {
        sessionStorage.removeItem("pendingNutritionEstimate");
      }
    }
    return () => stopEstimatePolling();
  }, []);

  function refresh() { setReloadTick(value => value + 1); }

  useEffect(() => {
    api.profile.get().then(setProfile).catch(() => {});
    api.readiness.today().then(reading => {
      setToday(reading.day);
      const requestedDay = new URLSearchParams(window.location.search).get("day");
      setSelectedDay(current => current || (requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : reading.day));
      api.mealplan.get(reading.day).then(setPlan).catch(() => setPlanError("Could not load today's plan. Retry by returning to this page."));
    }).catch(error => { setDayError(error instanceof Error ? error.message : String(error)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selectedDay) return;
    const request = ++dayRequest.current;
    setLoading(true);
    setDayError(null);
    setTargetError(null);
    Promise.allSettled([api.nutrition.forDay(selectedDay), api.targets.forDay(selectedDay), api.nutrition.totals(selectedDay)])
      .then(([entries, dayTargets, dayTotals]) => {
        if (request !== dayRequest.current) return;
        if (entries.status === "fulfilled") setLogs(entries.value);
        else { setLogs([]); setDayError(entries.reason instanceof Error ? entries.reason.message : String(entries.reason)); }
        if (dayTotals.status === "fulfilled") setTotals(dayTotals.value);
        else { setTotals(null); setDayError(dayTotals.reason instanceof Error ? dayTotals.reason.message : String(dayTotals.reason)); }
        if (dayTargets.status === "fulfilled") {
          setTargets(dayTargets.value);
          setDayTypeOverride(dayTargets.value.override_source === "manual" ? dayTargets.value.day_type : "auto");
        } else {
          setTargets(null);
          setTargetError(dayTargets.reason instanceof Error ? dayTargets.reason.message : String(dayTargets.reason));
        }
      })
      .catch(error => { if (request === dayRequest.current) setDayError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (request === dayRequest.current) setLoading(false); });
  }, [selectedDay, reloadTick]);

  async function handleDayTypeChange(value: string) {
    setDayTypeOverride(value);
    setErr(null);
    try {
      if (value === "auto") {
        await api.targets.clearDayType(selectedDay);
      } else {
        await api.targets.setDayType(selectedDay, value);
      }
      const t = await api.targets.forDay(selectedDay);
      setTargets(t);
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  function stopEstimatePolling() {
    estimateObserver.current.stop();
  }

  function pollEstimateResult(id: number, observation: JobObservation = estimateObserver.current.begin()) {
    observation.poll(
      () => api.nutrition.pollEstimate(id),
      (est) => {
        setBusy(false);
        sessionStorage.removeItem("pendingNutritionEstimate");
        if (est.status === "done") {
          setEstimate(est);
          setDraft({
            kcal: String(est.kcal ?? ""),
            protein_g: String(est.protein_g ?? ""),
            carbs_g: String(est.carbs_g ?? ""),
            fat_g: String(est.fat_g ?? ""),
            fiber_g: est.fiber_g != null ? String(est.fiber_g) : "",
          });
        } else {
          setErr(est.error ?? "Nutrition estimation failed");
        }
      },
      (error) => {
        setBusy(false);
        // Keep the job reference: a connection failure is not a failed job.
        setErr(error instanceof Error ? error.message : String(error));
      },
    );
  }

  async function requestEstimate() {
    if (!text.trim() || busy) return;
    const observation = estimateObserver.current.begin();
    const destination = { day: selectedDay, meal };
    setEstimateDestination(destination);
    const pending = JSON.stringify({ text: text.trim(), ...destination, submission: Math.random().toString(36) });
    setBusy(true);
    setErr(null);

    try {
      sessionStorage.setItem("pendingNutritionEstimate", pending);
      const accepted = await api.nutrition.estimate(text.trim());
      // Preserve resumability even if the page closed before acceptance, but
      // never overwrite a newer submission's saved reference.
      if (sessionStorage.getItem("pendingNutritionEstimate") === pending) {
        sessionStorage.setItem(
          "pendingNutritionEstimate",
          JSON.stringify({ id: accepted.id, text: text.trim(), ...destination })
        );
      }
      if (!observation.isCurrent()) return;
      pollEstimateResult(accepted.id, observation);
    } catch (e: any) {
      if (sessionStorage.getItem("pendingNutritionEstimate") === pending) {
        sessionStorage.removeItem("pendingNutritionEstimate");
      }
      if (!observation.isCurrent()) return;
      setBusy(false);
      setErr(e?.message ?? String(e));
    }
  }

  function stopWatchingEstimate() {
    // Client-side only: the estimate keeps generating server-side —
    // reopening this page while it's still pending resumes watching it.
    stopEstimatePolling();
    setBusy(false);
  }

  function discardEstimate() {
    setEstimate(null);
  }

  async function confirmLog() {
    if (!estimate || confirming) return;
    const required = [draft.kcal, draft.protein_g, draft.carbs_g, draft.fat_g];
    if (required.some(value => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) ||
        (draft.fiber_g.trim() !== "" && (!Number.isFinite(Number(draft.fiber_g)) || Number(draft.fiber_g) < 0))) {
      setErr("Enter finite, nonnegative values for calories, protein, carbs, and fat before logging.");
      return;
    }
    setConfirming(true);
    setErr(null);
    try {
      await api.nutrition.log({
        raw_text: text.trim(),
        day: estimateDestination?.day || selectedDay,
        meal: estimateDestination?.meal || undefined,
        kcal: Number(draft.kcal),
        protein_g: Number(draft.protein_g),
        carbs_g: Number(draft.carbs_g),
        fat_g: Number(draft.fat_g),
        fiber_g: draft.fiber_g ? Number(draft.fiber_g) : undefined,
        micros: estimate.micros,
        items: estimate.items,
        confidence: estimate.confidence ?? undefined,
        notes: estimate.notes,
        incomplete_micros: estimate.incomplete_micros,
        estimated_by: (["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const)
          .some(key => (draft[key] === "" ? null : Number(draft[key])) !== estimate[key])
          ? "manual" : estimate.estimated_by,
      });
      setText("");
      setEstimate(null);
      setEstimateDestination(null);
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

  function openEntry(entry: NutritionLog, kind: "edit" | "repeat") {
    setEntryError(null);
    setEditing(kind === "edit" ? entry : null);
    setRepeating(kind === "repeat" ? entry : null);
    setManualMode(false);
    setRepeatRequestId(crypto.randomUUID());
    setEntryDraft({
      day: kind === "edit" ? entry.day : selectedDay,
      meal: entry.meal || "", raw_text: entry.raw_text,
      kcal: entry.kcal?.toString() ?? "", protein_g: entry.protein_g?.toString() ?? "",
      carbs_g: entry.carbs_g?.toString() ?? "", fat_g: entry.fat_g?.toString() ?? "",
      fiber_g: entry.fiber_g?.toString() ?? "", multiplier: "1",
    });
  }

  function openManual() {
    setEditing(null);
    setRepeating(null);
    setManualMode(true);
    setEntryError(null);
    setEntryDraft({ day: selectedDay, meal, raw_text: "", kcal: "", protein_g: "", carbs_g: "", fat_g: "", fiber_g: "", multiplier: "1" });
  }

  async function saveEntry() {
    if (entryBusy) return;
    setEntryError(null);
    const values = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDraft.day) || Number.isNaN(Date.parse(`${entryDraft.day}T12:00:00Z`))) {
      setEntryError("Choose a valid destination date."); return;
    }
    if (repeating) {
      const multiplier = Number(entryDraft.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 20) {
        setEntryError("Use a portion multiplier above zero and no greater than 20."); return;
      }
    } else if (!entryDraft.raw_text.trim() || values.some(key => {
      const value = entryDraft[key];
      return (!editing && key !== "fiber_g" && value.trim() === "") || (value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0));
    })) {
      setEntryError("Enter a description and finite nonnegative nutrients. Leave optional unknown values blank."); return;
    }
    setEntryBusy(true);
    try {
      let saved: NutritionLog;
      if (repeating) {
        saved = await api.nutrition.repeat(repeating.id, {
          day: entryDraft.day, meal: entryDraft.meal || null,
          multiplier: Number(entryDraft.multiplier), request_id: repeatRequestId,
        });
      } else if (editing) {
        saved = await api.nutrition.edit(editing.id, {
          expected_version: editing.version, day: entryDraft.day,
          meal: entryDraft.meal || null, raw_text: entryDraft.raw_text.trim(),
          ...Object.fromEntries(values.map(key => [key, entryDraft[key].trim() === "" ? null : Number(entryDraft[key])])) as
            Pick<NutritionLog, "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g">,
        });
      } else {
        saved = await api.nutrition.log({
          day: entryDraft.day, meal: entryDraft.meal || undefined, raw_text: entryDraft.raw_text.trim(),
          kcal: Number(entryDraft.kcal), protein_g: Number(entryDraft.protein_g),
          carbs_g: Number(entryDraft.carbs_g), fat_g: Number(entryDraft.fat_g),
          fiber_g: entryDraft.fiber_g.trim() === "" ? null : Number(entryDraft.fiber_g),
          estimated_by: "manual",
        });
      }
      setEntryMessage(`${repeating ? "Repeated" : editing ? "Updated" : "Logged"} meal for ${saved.day}.`);
      setEditing(null); setRepeating(null); setManualMode(false);
      setSelectedDay(saved.day);
      refresh();
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : String(error));
    } finally { setEntryBusy(false); }
  }

  async function generatePlan() {
    setPlanBusy(true);
    setPlanError(null);
    try {
      const p = await api.mealplan.generateToday();
      setPlan(p);
    } catch (e: any) {
      setPlanError(e?.message ?? "Generation failed. Try again.");
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
    const content = planContent(plan);
    const meals = content?.meals as MealPlanMeal[] | undefined;

    if (!Array.isArray(meals) || meals.length === 0) {
      return (
        <p role="status" className="text-sm text-muted-foreground">This saved plan has no readable meals. Regenerate to try again.</p>
      );
    }

    const sorted = meals.filter((item) => item && typeof item.name === "string").sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (!sorted.length) return <p role="status" className="text-sm text-muted-foreground">This saved plan is malformed. Regenerate to try again.</p>;
    const totals = content?.totals as MealPlanTotals | undefined;
    const rationale = typeof content?.rationale === "string" ? content.rationale : "";

    return (
      <div className="space-y-3">
        {sorted.map((mealItem, i) => {
          const Icon = SLOT_ICONS[mealItem.slot] ?? Utensils;
          return (
            <div key={i} className="border border-border p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="h-4 w-4 text-accent shrink-0" strokeWidth={1.5} />
                  <span className="font-semibold text-sm text-foreground truncate">
                    {mealItem.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{slotLabel(mealItem.slot)}</Badge>
                  {mealItem.time && (
                    <span className="font-mono text-xs text-muted-foreground">{mealItem.time}</span>
                  )}
                </div>
              </div>

              {mealItem.ingredients && mealItem.ingredients.length > 0 && (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {mealItem.ingredients.map((ing, j) => (
                    <li key={j} className="flex justify-between">
                      <span className="capitalize">{ing.name}</span>
                      <span className="font-mono text-xs text-muted-foreground/80">
                        {ing.qty_g} g
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                <span className="text-foreground/90">{nutrient(mealItem.kcal, "kcal")}</span>
                <span>P {nutrient(mealItem.protein_g, "g")}</span>
                <span>C {nutrient(mealItem.carbs_g, "g")}</span>
                <span>F {nutrient(mealItem.fat_g, "g")}</span>
              </div>

              {mealItem.notes && (
                <p className="text-xs text-muted-foreground mt-2 italic leading-relaxed">
                  {mealItem.notes}
                </p>
              )}
            </div>
          );
        })}

        {totals && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground border-t border-border pt-3 mt-1">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
              Day totals
            </span>
            <span className="text-foreground/90 font-medium">{nutrient(totals.kcal, "kcal")}</span>
            <span>P {nutrient(totals.protein_g, "g")}</span>
            <span>C {nutrient(totals.carbs_g, "g")}</span>
            <span>F {nutrient(totals.fat_g, "g")}</span>
          </div>
        )}

        {rationale && (
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">{rationale}</p>
        )}
      </div>
    );
  }

  const todayLogs = logs.filter((l) => l.day === selectedDay);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("entry");
    if (requested && /^\d+$/.test(requested) && logs.some(log => log.day === selectedDay && log.id === Number(requested))) {
      document.getElementById(`diary-entry-${requested}`)?.scrollIntoView({ block: "center" });
    }
  }, [selectedDay, logs]);
  const savedContext = plan?.plan.profile_context as Record<string, unknown> | undefined;
  const planNeedsReview = Boolean(plan && profile && (!savedContext ||
    savedContext.restrictions !== (profile.dietary_restrictions || "").trim() ||
    savedContext.preferences !== (profile.food_preferences || "").trim() ||
    savedContext.budget !== (profile.food_budget || "unspecified").trim()));

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

      <Card title="Diary date" icon={<CalendarClock className="h-4 w-4" />}>
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedDay(addDays(selectedDay, -1))} disabled={!selectedDay} aria-label="Previous diary day">Previous</Button>
          <label className="text-xs text-muted-foreground">Selected day
            <Input type="date" value={selectedDay} onChange={event => setSelectedDay(event.target.value)} className="mt-1" aria-label="Diary date" />
          </label>
          <Button variant="outline" size="sm" onClick={() => setSelectedDay(addDays(selectedDay, 1))} disabled={!selectedDay} aria-label="Next diary day">Next</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedDay(today)} disabled={!today || selectedDay === today}>Today</Button>
        </div>
        {dayError && <div role="alert" className="mt-3 text-sm text-destructive">Could not load {selectedDay}: {dayError} <Button variant="outline" size="sm" onClick={refresh}>Retry</Button></div>}
        {selectedDay && selectedDay !== today && <p className="text-xs text-muted-foreground mt-3">Historical targets are recalculated under the current rules.</p>}
      </Card>

      {/* Log a meal */}
      <Card title={`Log a meal · ${selectedDay || "loading"}`} icon={<Utensils className="h-4 w-4" />}>
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
          <Button onClick={requestEstimate} disabled={busy || !!estimate || !text.trim() || !selectedDay}>
            {busy ? "Estimating…" : "Estimate"}
          </Button>
          {busy && (
            <Button
              onClick={stopWatchingEstimate}
              variant="ghost"
              aria-label="Stop watching (estimate keeps generating)"
              title="The estimate keeps generating in the background — this just stops watching it here."
            >
              <X className="h-3.5 w-3.5" />
              Stop watching
            </Button>
          )}
        </div>
        <Button className="mt-3" variant="outline" size="sm" onClick={openManual} disabled={!selectedDay}>Enter macros manually</Button>

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
            <p className="text-xs text-muted-foreground">Destination: {estimateDestination?.day} · {estimateDestination?.meal || "Unspecified meal"}</p>

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
                  <label htmlFor={`nutrition-review-${key}`} className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block">
                    {label}
                  </label>
                  <Input
                    id={`nutrition-review-${key}`}
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

            {estimate.items.some(item => item.source === "saved") && (
              <ul className="text-xs space-y-2">
                {estimate.items.map((item, index) => <li key={index}>
                  <span className="font-medium">{item.name}</span>
                  {item.source === "saved" ? ` · ${item.qty_g} g · saved values` : " · estimated"}
                  {item.nutrients && <span className="block text-muted-foreground">
                    {Object.entries(item.nutrients).map(([key, value]) => `${key}: ${value}`).join(" · ")}
                  </span>}
                </li>)}
              </ul>
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

      <FoodLibrary onLogged={refresh} meal={meal} day={selectedDay} />

      {(manualMode || editing || repeating) && <Card title={repeating ? "Repeat meal" : editing ? "Edit diary entry" : "Enter macros manually"}>
        <div className="space-y-3">
          {entryError && <p role="alert" className="text-sm text-destructive">{entryError} {entryError.includes("409") && <Button size="sm" variant="outline" onClick={refresh}>Refresh diary</Button>}</p>}
          {repeating && <p className="text-sm text-muted-foreground">Copying recorded values from {repeating.day}. The original stays unchanged.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs">Destination date
              <Input type="date" value={entryDraft.day} onChange={event => setEntryDraft({ ...entryDraft, day: event.target.value })} />
            </label>
            <label className="text-xs">Meal slot
              <select className="block h-10 w-full border border-input bg-background px-2 text-sm" value={entryDraft.meal} onChange={event => setEntryDraft({ ...entryDraft, meal: event.target.value })}>
                <option value="">Unspecified</option>{MEALS.map(slot => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
              </select>
            </label>
          </div>
          {!repeating && <label className="text-xs block">Description
            <Input value={entryDraft.raw_text} onChange={event => setEntryDraft({ ...entryDraft, raw_text: event.target.value })} />
          </label>}
          {repeating ? <>
            <label className="text-xs block">Portion multiplier
              <Input type="number" min="0.01" max="20" step="any" value={entryDraft.multiplier} onChange={event => setEntryDraft({ ...entryDraft, multiplier: event.target.value })} />
            </label>
            <p className="text-sm text-muted-foreground">Preview: {repeating.raw_text} · {repeating.kcal === null ? "Unknown kcal" : `${(repeating.kcal * Number(entryDraft.multiplier || 0)).toFixed(0)} kcal`} · P {repeating.protein_g === null ? "Unknown" : (repeating.protein_g * Number(entryDraft.multiplier || 0)).toFixed(1)} g · C {repeating.carbs_g === null ? "Unknown" : (repeating.carbs_g * Number(entryDraft.multiplier || 0)).toFixed(1)} g · F {repeating.fat_g === null ? "Unknown" : (repeating.fat_g * Number(entryDraft.multiplier || 0)).toFixed(1)} g</p>
          </> : <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {([ ["kcal", "Calories (kcal)"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"], ["fiber_g", "Fiber (g)"] ] as const).map(([key, label]) => <label key={key} className="text-xs">{label}
              <Input type="number" min="0" step="any" placeholder={editing || key === "fiber_g" ? "Unknown" : "Required"} value={entryDraft[key]} onChange={event => setEntryDraft({ ...entryDraft, [key]: event.target.value })} />
            </label>)}
          </div>}
          <div className="flex gap-2">
            <Button size="sm" disabled={entryBusy} onClick={saveEntry}>{entryBusy ? "Saving…" : repeating ? "Save copy" : editing ? "Save changes" : "Log meal"}</Button>
            <Button size="sm" variant="outline" disabled={entryBusy} onClick={() => { setEditing(null); setRepeating(null); setManualMode(false); setEntryError(null); }}>Cancel</Button>
          </div>
        </div>
      </Card>}
      {entryMessage && <p role="status" className="text-sm">{entryMessage}</p>}

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
              <Badge variant="outline">{targets.target_source === "accepted" ? `Accepted plan ${targets.plan_id} v${targets.plan_version}` : "Ordinary calculated target"}</Badge>
              <Select value={dayTypeOverride} onValueChange={handleDayTypeChange}>
                <SelectTrigger aria-label="Day type" className="w-[140px] h-8 text-xs">
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
          <p className="text-xs text-muted-foreground mt-3">Recorded intake reflects {totals.entry_count} entr{totals.entry_count === 1 ? "y" : "ies"}; an incomplete diary can understate actual intake. Unknown nutrient values are not counted as zero.</p>
          {targets.needs_review && <p role="status" className="text-xs text-amber-500 mt-2">This accepted plan&rsquo;s event, profile, or training inputs changed. Review a new preview before revising targets.</p>}
          {targets.notes && (
            <p className="text-xs text-muted-foreground mt-4 font-mono">{targets.notes}</p>
          )}
          <details className="text-xs text-muted-foreground mt-3">
            <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Why these targets?</summary>
            <div className="mt-2 space-y-1">
              <p>Goal: {targets.goal} · Weight: {targets.weight_kg} kg · Day: {targets.day_type} · Phase: {targets.phase}</p>
              <p>Baseline: {targets.baseline_kcal} kcal from {targets.baseline_source} through {targets.data_cutoff}. Requested goal: {targets.requested_kcal} kcal. Displayed energy equals protein × 4 + carbs × 4 + fat × 9.</p>
              {targets.energy_conflict && <p role="status">{targets.energy_conflict}</p>}
              <p>Policy {targets.policy_version}. These targets use current profile and rules.</p>
            </div>
          </details>
        </Card>
      ) : targetError ? <Card title="Targets unavailable"><p role="alert" className="text-sm text-muted-foreground">{targetError}</p><a className="text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" href="/profile">Update profile</a><Button size="sm" variant="outline" className="ml-3" onClick={refresh}>Retry</Button></Card> : null}

      {/* Summary + Micros + Today's entries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <Card title={`Diary totals (${selectedDay})`}>
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

        <Card title={`Micros (${selectedDay})`}>
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
                  hint={totals.incomplete_micros?.includes(k) ? "incomplete" : undefined}
                />
              ))
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-muted-foreground text-sm font-medium">No data yet</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">Known amounts only. Missing nutrient values are unknown, not zero.</p>
        </Card>

        <Card title={`Entries (${selectedDay})`}>
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
                <li key={l.id} id={`diary-entry-${l.id}`} className="text-sm pt-3 first:pt-0 scroll-mt-24">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">
                      {l.meal || "\u2014"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-accent hover:bg-accent/10"
                      onClick={() => setDeleteId(l.id)}
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex gap-2 mt-2"><Button size="sm" variant="outline" onClick={() => openEntry(l, "edit")}>Edit</Button><Button size="sm" variant="outline" onClick={() => openEntry(l, "repeat")}>Repeat</Button></div>
                  <div className="text-foreground mt-1.5 font-medium">{l.raw_text}</div>
                  <div className="text-muted-foreground text-xs mt-1 font-mono">
                    {l.kcal?.toFixed(0)} kcal · P{" "}
                    {l.protein_g?.toFixed(0)} / C {l.carbs_g?.toFixed(0)} / F{" "}
                    {l.fat_g?.toFixed(0)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {l.estimated_by === "repeat" ? "Repeated recorded values" :
                      l.estimated_by?.startsWith("saved") ? "Saved food values" :
                      l.estimated_by?.startsWith("mixed") ? "Saved values + estimates" :
                      l.estimated_by?.startsWith("manual") ? "Manual or edited values" : "Estimated values"}
                    {Boolean(l.micros?.totals_edited) && " · Ingredient estimates may differ from edited totals"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CompetitionNutritionPlanner onChanged={refresh} onSelectDay={setSelectedDay} />

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
        {planError && <p role="alert" className="text-sm text-accent mb-3">{planError} The previous plan remains available.</p>}
        {planNeedsReview && <p role="status" className="text-sm text-amber-500 mb-3">This saved plan predates your current food restrictions, preferences, or budget. Review it and regenerate before relying on it.</p>}
        {savedContext && <p className="text-xs text-muted-foreground mb-3">Planned with restrictions: {String(savedContext.restrictions || "none")} · Preferences: {String(savedContext.preferences || "none")} · Budget: {String(savedContext.budget || "unspecified")}. Ingredient-name checks do not guarantee allergen or cross-contact safety.</p>}
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
              covered: {shopping.days_covered.length}/7 days {shopping.missing_days.length > 0 ? "(partial)" : "(complete)"}
              {shopping.missing_days.length > 0 && (
                <> · missing: {shopping.missing_days.join(", ")}</>
              )}
            </p>
            <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {shopping.items.map((it, i) => (
                <li key={i} className="flex justify-between border-b border-border py-2">
                  <span className="text-foreground font-medium">{it.name}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {it.qty_g} g
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <ConfirmDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }} title="Delete diary entry?" description="This removes the meal and updates that day's totals." confirmLabel="Delete entry" onConfirm={() => { if (deleteId !== null) void remove(deleteId); setDeleteId(null); }} />
    </div>
  );
}
