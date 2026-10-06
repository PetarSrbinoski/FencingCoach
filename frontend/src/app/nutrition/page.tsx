"use client";

import { QuickFoods } from "@/components/quick-foods";
import { PageHeading } from "@/components/page-heading";
import { NutritionProgress } from "@/components/nutrition-progress";

import { randomUUID } from "@/lib/uuid";

import { MacroProgress } from "@/components/charts";
import { CompetitionNutritionPlanner } from "@/components/competition-nutrition-planner";
import { FoodLibrary } from "@/components/food-library";
import { VoiceLogging } from "@/components/voice-logging";
import { RecipeLibrary } from "@/components/recipe-library";
import { MealSuggestions } from "@/components/meal-suggestions";
import {
  Editor,
  ErrorNotice,
  ReadMore,
  useView,
  ViewTabs,
} from "@/components/mobile-ui";
import { Card, StatRow } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  MealPlan,
  NutritionDayTotals,
  NutritionEstimate,
  NutritionLog,
  Profile,
  ShoppingList,
  Targets,
} from "@/lib/api";
import { createJobObserver, type JobObservation } from "@/lib/job-observer";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import {
  AlertTriangle,
  ArrowUp,
  BatteryCharging,
  CalendarClock,
  ChefHat,
  Coffee,
  Cookie,
  Loader2,
  Moon,
  ShoppingCart,
  Sun,
  Trash2,
  Utensils,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

function planContent(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  let current: unknown = value;
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return null;
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.meals)) return record;
    current = record.plan;
  }
  return null;
}

function nutrient(value: number | undefined, unit: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value} ${unit}`
    : `Unknown ${unit}`;
}


function slotLabel(slot: string): string {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NutritionPage() {
  const [view, setView] = useView(
    ["diary", "plans", "foods"] as const,
    "diary",
    (query) =>
      query.has("food") || query.has("recipe") || window.location.hash === "#my-foods"
        ? "foods"
        : query.has("competition") || query.has("plan") || query.has("suggestion")
          ? "plans"
          : undefined,
  );
  const [planView, setPlanView] = useView(
    ["daily", "suggestions", "competition", "shopping"] as const,
    "daily",
    (query) =>
      query.has("suggestion") ? "suggestions" : query.has("competition") || query.has("plan") ? "competition" : undefined,
    "planView",
  );
  const [libraryView, setLibraryView] = useView(
    ["products", "recipes"] as const, "products",
    (query) => query.has("recipe") ? "recipes" : undefined, "library",
  );
  const [today, setToday] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [cancellingEstimate, setCancellingEstimate] = useState(false);
  const activeEstimate = useRef<{ id: Promise<number>; observation: JobObservation }>();
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
  const displayedDay = useRef("");
  const [estimateDestination, setEstimateDestination] = useState<{
    day: string;
    meal: string;
  } | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [editing, setEditing] = useState<NutritionLog | null>(null);
  const [repeating, setRepeating] = useState<NutritionLog | null>(null);
  const [entryDraft, setEntryDraft] = useState({
    day: "",
    meal: "",
    raw_text: "",
    kcal: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
    fiber_g: "",
    multiplier: "1",
  });
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryMessage, setEntryMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [repeatRequestId, setRepeatRequestId] = useState("");

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

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    const raw = sessionStorage.getItem("pendingNutritionEstimate");
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          id?: number;
          text: string;
          day?: string;
          meal?: string;
          submission?: string;
        };
        setText(saved.text);
        if (saved.day)
          setEstimateDestination({ day: saved.day, meal: saved.meal || "" });
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

  function focusLogger(id: string) {
    const field = document.getElementById(id);
    field?.scrollIntoView({ block: "center" });
    field?.focus({ preventScroll: true });
  }

  function refresh() {
    setReloadTick((value) => value + 1);
    if (!today) loadContext();
  }
  useWorkflowRefresh(() => {
    refresh();
    api.profile
      .get()
      .then(setProfile)
      .catch(() => {});
    if (today)
      api.mealplan
        .get(today)
        .then(setPlan)
        .catch(() => {});
  });

  function loadContext() {
    setDayError(null);
    api.profile
      .get()
      .then(setProfile)
      .catch(() => {});
    api.readiness
      .today()
      .then((reading) => {
        setToday(reading.day);
        const requestedDay = new URLSearchParams(window.location.search).get(
          "day",
        );
        setSelectedDay(
          (current) =>
            current ||
            (requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay)
              ? requestedDay
              : reading.day),
        );
        api.mealplan
          .get(reading.day)
          .then(setPlan)
          .catch(() =>
            setPlanError(
              "Could not load today's plan. Retry by returning to this page.",
            ),
          );
      })
      .catch((error) => {
        setDayError(error instanceof Error ? error.message : String(error));
        setLoading(false);
      });
  }
  useEffect(loadContext, []);

  useEffect(() => {
    if (!selectedDay) return;
    const request = ++dayRequest.current;
    if (displayedDay.current !== selectedDay) {
      setTargets(null);
      setTotals(null);
      setLogs([]);
      displayedDay.current = selectedDay;
    }
    setLoading(true);
    setDayError(null);
    setTargetError(null);
    Promise.allSettled([
      api.nutrition.forDay(selectedDay),
      api.targets.forDay(selectedDay),
      api.nutrition.totals(selectedDay),
    ])
      .then(([entries, dayTargets, dayTotals]) => {
        if (request !== dayRequest.current) return;
        if (entries.status === "fulfilled") setLogs(entries.value);
        else {
          setLogs([]);
          setDayError(
            entries.reason instanceof Error
              ? entries.reason.message
              : String(entries.reason),
          );
        }
        if (dayTotals.status === "fulfilled") setTotals(dayTotals.value);
        else {
          setTotals(null);
          setDayError(
            dayTotals.reason instanceof Error
              ? dayTotals.reason.message
              : String(dayTotals.reason),
          );
        }
        if (dayTargets.status === "fulfilled") {
          setTargets(dayTargets.value);
          setDayTypeOverride(
            dayTargets.value.override_source === "manual"
              ? dayTargets.value.day_type
              : "auto",
          );
        } else {
          setTargets(null);
          setTargetError(
            dayTargets.reason instanceof Error
              ? dayTargets.reason.message
              : String(dayTargets.reason),
          );
        }
      })
      .catch((error) => {
        if (request === dayRequest.current)
          setDayError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (request === dayRequest.current) setLoading(false);
      });
  }, [selectedDay, reloadTick]);

  useEffect(() => {
    if (!selectedDay) return;
    const url = new URL(window.location.href);
    url.searchParams.set("day", selectedDay);
    window.history.replaceState({}, "", url);
  }, [selectedDay]);
  useEffect(() => {
    const readDay = () => {
      const day = new URLSearchParams(window.location.search).get("day");
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) setSelectedDay(day);
    };
    window.addEventListener("popstate", readDay);
    return () => window.removeEventListener("popstate", readDay);
  }, []);

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

  function receiveEstimate(est: NutritionEstimate) {
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
      setEstimateDestination(null);
      setErr(est.status === "cancelled" ? null : est.error ?? "Nutrition estimation failed");
    }
  }

  function pollEstimateResult(
    id: number,
    observation: JobObservation = estimateObserver.current.begin(),
  ) {
    activeEstimate.current = { id: Promise.resolve(id), observation };
    observation.poll(
      () => api.nutrition.pollEstimate(id),
      receiveEstimate,
      (error) => {
        setBusy(false);
        setErr(error instanceof Error ? error.message : String(error));
      },
    );
  }

  async function requestEstimate() {
    if (!text.trim() || busy || cancellingEstimate || estimate || estimateDestination || !selectedDay)
      return;
    const observation = estimateObserver.current.begin();
    const destination = { day: selectedDay, meal };
    setEstimateDestination(destination);
    const pending = JSON.stringify({
      text: text.trim(),
      ...destination,
      submission: Math.random().toString(36),
    });
    setBusy(true);
    setErr(null);

    try {
      sessionStorage.setItem("pendingNutritionEstimate", pending);
      const submission = api.nutrition.estimate(text.trim());
      const id = submission.then((accepted) => accepted.id);
      activeEstimate.current = { id, observation };
      void id.catch(() => {}); // The submission error is handled below.
      const accepted = await submission;
      // A newer submission may have replaced this one while we waited.
      if (sessionStorage.getItem("pendingNutritionEstimate") === pending) {
        sessionStorage.setItem(
          "pendingNutritionEstimate",
          JSON.stringify({
            id: accepted.id,
            text: text.trim(),
            ...destination,
          }),
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
      setEstimateDestination(null);
      setErr(e?.message ?? String(e));
    }
  }

  async function cancelEstimate() {
    const request = activeEstimate.current;
    if (!request || cancellingEstimate) return;
    setCancellingEstimate(true);
    setErr(null);
    try {
      const id = await request.id;
      const result = await api.nutrition.cancelEstimate(id);
      if (!request.observation.isCurrent()) return;
      stopEstimatePolling();
      activeEstimate.current = undefined;
      setCancellingEstimate(false);
      receiveEstimate(result);
    } catch (error) {
      if (request.observation.isCurrent()) {
        setErr(error instanceof Error ? error.message : "Could not cancel estimate");
      }
    } finally {
      if (request.observation.isCurrent()) setCancellingEstimate(false);
    }
  }

  function discardEstimate() {
    setEstimateDestination(null);
    sessionStorage.removeItem("pendingNutritionEstimate");
    setEstimate(null);
  }

  async function confirmLog() {
    if (!estimate || confirming) return;
    const required = [draft.kcal, draft.protein_g, draft.carbs_g, draft.fat_g];
    if (
      required.some(
        (value) =>
          value.trim() === "" ||
          !Number.isFinite(Number(value)) ||
          Number(value) < 0,
      ) ||
      (draft.fiber_g.trim() !== "" &&
        (!Number.isFinite(Number(draft.fiber_g)) || Number(draft.fiber_g) < 0))
    ) {
      setErr(
        "Enter finite, nonnegative values for calories, protein, carbs, and fat before logging.",
      );
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
        estimated_by: (
          ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const
        ).some(
          (key) =>
            (draft[key] === "" ? null : Number(draft[key])) !== estimate[key],
        )
          ? "manual"
          : estimate.estimated_by,
      });
      setText("");
      setEstimate(null);
      setEstimateDestination(null);
      setSelectedDay(estimateDestination?.day || selectedDay);
      setEntryMessage(
        `Logged meal for ${estimateDestination?.day || selectedDay}.`,
      );
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
      throw e;
    }
  }

  function openEntry(entry: NutritionLog, kind: "edit" | "repeat") {
    setEntryError(null);
    setEditing(kind === "edit" ? entry : null);
    setRepeating(kind === "repeat" ? entry : null);
    setManualMode(false);
    setRepeatRequestId(randomUUID());
    setEntryDraft({
      day: kind === "edit" ? entry.day : selectedDay,
      meal: entry.meal || "",
      raw_text: entry.raw_text,
      kcal: entry.kcal?.toString() ?? "",
      protein_g: entry.protein_g?.toString() ?? "",
      carbs_g: entry.carbs_g?.toString() ?? "",
      fat_g: entry.fat_g?.toString() ?? "",
      fiber_g: entry.fiber_g?.toString() ?? "",
      multiplier: "1",
    });
  }

  function openManual() {
    setEditing(null);
    setRepeating(null);
    setManualMode(true);
    setEntryError(null);
    setEntryDraft({
      day: selectedDay,
      meal,
      raw_text: "",
      kcal: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      fiber_g: "",
      multiplier: "1",
    });
  }

  async function saveEntry() {
    if (entryBusy) return;
    setEntryError(null);
    const values = [
      "kcal",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
    ] as const;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entryDraft.day) ||
      Number.isNaN(Date.parse(`${entryDraft.day}T12:00:00Z`))
    ) {
      setEntryError("Choose a valid destination date.");
      return;
    }
    if (repeating) {
      const multiplier = Number(entryDraft.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 20) {
        setEntryError(
          "Use a portion multiplier above zero and no greater than 20.",
        );
        return;
      }
    } else if (
      !entryDraft.raw_text.trim() ||
      values.some((key) => {
        const value = entryDraft[key];
        return (
          (!editing && key !== "fiber_g" && value.trim() === "") ||
          (value.trim() !== "" &&
            (!Number.isFinite(Number(value)) || Number(value) < 0))
        );
      })
    ) {
      setEntryError(
        "Enter a description and finite nonnegative nutrients. Leave optional unknown values blank.",
      );
      return;
    }
    setEntryBusy(true);
    try {
      let saved: NutritionLog;
      if (repeating) {
        saved = await api.nutrition.repeat(repeating.id, {
          day: entryDraft.day,
          meal: entryDraft.meal || null,
          multiplier: Number(entryDraft.multiplier),
          request_id: repeatRequestId,
        });
      } else if (editing) {
        saved = await api.nutrition.edit(editing.id, {
          expected_version: editing.version,
          day: entryDraft.day,
          meal: entryDraft.meal || null,
          raw_text: entryDraft.raw_text.trim(),
          ...(Object.fromEntries(
            values.map((key) => [
              key,
              entryDraft[key].trim() === "" ? null : Number(entryDraft[key]),
            ]),
          ) as Pick<
            NutritionLog,
            "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g"
          >),
        });
      } else {
        saved = await api.nutrition.log({
          day: entryDraft.day,
          meal: entryDraft.meal || undefined,
          raw_text: entryDraft.raw_text.trim(),
          kcal: Number(entryDraft.kcal),
          protein_g: Number(entryDraft.protein_g),
          carbs_g: Number(entryDraft.carbs_g),
          fat_g: Number(entryDraft.fat_g),
          fiber_g:
            entryDraft.fiber_g.trim() === ""
              ? null
              : Number(entryDraft.fiber_g),
          estimated_by: "manual",
        });
      }
      setEntryMessage(
        `${repeating ? "Repeated" : editing ? "Updated" : "Logged"} meal for ${saved.day}.`,
      );
      setEditing(null);
      setRepeating(null);
      setManualMode(false);
      setSelectedDay(saved.day);
      refresh();
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : String(error));
    } finally {
      setEntryBusy(false);
    }
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
        <p role="status" className="text-sm text-muted-foreground">
          This saved plan has no readable meals. Regenerate to try again.
        </p>
      );
    }

    const sorted = meals
      .filter((item) => item && typeof item.name === "string")
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (!sorted.length)
      return (
        <p role="status" className="text-sm text-muted-foreground">
          This saved plan is malformed. Regenerate to try again.
        </p>
      );
    const totals = content?.totals as MealPlanTotals | undefined;
    const rationale =
      typeof content?.rationale === "string" ? content.rationale : "";

    return (
      <div className="space-y-3">
        {sorted.map((mealItem, i) => {
          const Icon = SLOT_ICONS[mealItem.slot] ?? Utensils;
          return (
            <div key={i} className="border border-border p-4">
              <div className="flex flex-col gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className="h-4 w-4 text-accent shrink-0"
                    strokeWidth={1.5}
                  />
                  <span className="font-semibold text-base text-foreground break-words">
                    {mealItem.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{slotLabel(mealItem.slot)}</Badge>
                  {mealItem.time && (
                    <span className="font-sans text-xs text-muted-foreground">
                      {mealItem.time}
                    </span>
                  )}
                </div>
              </div>

              {mealItem.ingredients && mealItem.ingredients.length > 0 && (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {mealItem.ingredients.map((ing, j) => (
                    <li key={j} className="flex justify-between gap-3">
                      <span className="capitalize">{ing.name}</span>
                      <span className="font-sans text-xs text-muted-foreground/80">
                        {ing.qty_g} g
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                <span className="text-foreground/90">
                  {nutrient(mealItem.kcal, "kcal")}
                </span>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-muted-foreground border-t border-border pt-3 mt-1">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Day totals
            </span>
            <span className="text-foreground/90 font-medium">
              {nutrient(totals.kcal, "kcal")}
            </span>
            <span>P {nutrient(totals.protein_g, "g")}</span>
            <span>C {nutrient(totals.carbs_g, "g")}</span>
            <span>F {nutrient(totals.fat_g, "g")}</span>
          </div>
        )}

        {rationale && (
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">
            {rationale}
          </p>
        )}
      </div>
    );
  }

  const todayLogs = logs.filter((l) => l.day === selectedDay);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("entry");
    if (
      requested &&
      /^\d+$/.test(requested) &&
      logs.some(
        (log) => log.day === selectedDay && log.id === Number(requested),
      )
    ) {
      document
        .getElementById(`diary-entry-${requested}`)
        ?.scrollIntoView({ block: "center" });
    }
  }, [selectedDay, logs]);
  const savedContext = plan?.plan.profile_context as
    | Record<string, unknown>
    | undefined;
  const planNeedsReview = Boolean(
    plan &&
      profile &&
      (!savedContext ||
        savedContext.restrictions !==
          (profile.dietary_restrictions || "").trim() ||
        savedContext.preferences !== (profile.food_preferences || "").trim() ||
        savedContext.budget !== (profile.food_budget || "unspecified").trim()),
  );

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <PageHeading title="Nutrition" eyebrow="Fuel & recovery" />

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {entryMessage && (
        <p role="status" className="rounded-xl bg-success/10 p-3 text-sm">
          {entryMessage}
        </p>
      )}
      <ViewTabs
        value={view}
        onChange={setView}
        label="Nutrition views"
        items={[
          { value: "diary", label: "Diary" },
          { value: "plans", label: "Plans" },
          { value: "foods", label: "Foods" },
        ]}
      />
      {view === "diary" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {selectedDay === today ? "Today’s diary" : `Diary · ${selectedDay}`}
          </p>
          {dayError && (
            <div role="alert" className="mt-3 text-sm text-destructive">
              Could not load {selectedDay}: {dayError}{" "}
              <Button variant="outline" size="icon" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {selectedDay && selectedDay !== today && (
            <p className="text-xs text-muted-foreground mt-3">
              Historical targets are recalculated under the current rules.
            </p>
          )}

          {/* Targets vs intake */}
          {loading && !targets ? (
            <Card>
              <div
                className="grid grid-cols-4 gap-2 sm:gap-6"
                aria-label="Loading daily intake"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="mx-auto aspect-square w-full max-w-32 rounded-full sm:max-w-36" />
                    <Skeleton className="mx-auto h-3 w-12" />
                  </div>
                ))}
              </div>
            </Card>
          ) : targets && totals ? (
            <Card className="nutrition-intake">
              <div
                className="grid grid-cols-4 gap-2 sm:gap-6"
                aria-label="Daily intake"
              >
                {(
                  [
                    ["kcal", "Calories", "kcal", "text-accent"],
                    [
                      "protein_g",
                      "Protein",
                      "g",
                      "text-sky-600 dark:text-sky-400",
                    ],
                    [
                      "carbs_g",
                      "Carbs",
                      "g",
                      "text-amber-600 dark:text-amber-400",
                    ],
                    [
                      "fat_g",
                      "Fat",
                      "g",
                      "text-emerald-600 dark:text-emerald-400",
                    ],
                  ] as const
                ).map(([key, label, unit, color]) => (
                  <NutritionProgress
                    key={key}
                    label={label}
                    actual={totals[key]}
                    target={targets[key]}
                    unit={unit}
                    color={color}
                  />
                ))}
              </div>
              <details className="mt-2 text-sm">
                <summary className="text-muted-foreground">
                  Targets & details
                </summary>
                <div className="space-y-3 pt-2">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <Badge
                      variant={
                        targets.override_source === "manual"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {targets.override_source === "manual" ? "manual" : "auto"}
                    </Badge>
                    <Badge variant="outline">
                      {targets.target_source === "accepted"
                        ? `Accepted plan ${targets.plan_id} v${targets.plan_version}`
                        : "Ordinary calculated target"}
                    </Badge>
                    <Select
                      value={dayTypeOverride}
                      onValueChange={handleDayTypeChange}
                    >
                      <SelectTrigger
                        aria-label="Day type"
                        className="w-full min-w-0 h-12 text-base"
                      >
                        <CalendarClock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_TYPES.map((dt) => (
                          <SelectItem key={dt} value={dt}>
                            {dt === "auto"
                              ? "Auto"
                              : dt.charAt(0).toUpperCase() + dt.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">
                    Recorded intake reflects {totals.entry_count} entr
                    {totals.entry_count === 1 ? "y" : "ies"}; an incomplete
                    diary can understate actual intake. Unknown nutrient values
                    are not counted as zero.
                  </p>
                  {targets.needs_review && (
                    <p role="status" className="text-xs text-warning mt-2">
                      This accepted plan&rsquo;s event, profile, or training
                      inputs changed. Review a new preview before revising
                      targets.
                    </p>
                  )}
                  <details className="text-xs text-muted-foreground mt-3">
                    <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                      Why these targets?
                    </summary>
                    <div className="mt-2 space-y-2">
                      {targets.notes && <p>{targets.notes}</p>}
                      <p>
                        Goal: {targets.goal} · Weight: {targets.weight_kg} kg ·
                        Day: {targets.day_type} · Phase: {targets.phase}
                      </p>
                      <p>
                        Baseline: {targets.baseline_kcal} kcal from{" "}
                        {targets.baseline_source} through {targets.data_cutoff}.
                        Requested goal: {targets.requested_kcal} kcal. Displayed
                        energy equals protein × 4 + carbs × 4 + fat × 9.
                      </p>
                      {targets.energy_conflict && (
                        <p role="status">{targets.energy_conflict}</p>
                      )}
                      <p>
                        Policy {targets.policy_version}. These targets use
                        current profile and rules.
                      </p>
                    </div>
                  </details>
                </div>
              </details>
              {targets.needs_review && (
                <p className="text-xs text-warning">
                  Your accepted plan needs review. Open Targets & details.
                </p>
              )}
            </Card>
          ) : targetError ? (
            <Card title="Targets unavailable">
              <p role="alert" className="text-sm text-muted-foreground">
                {targetError}
              </p>
              <a
                className="text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href="/profile"
              >
                Update profile
              </a>
              <Button
                size="sm"
                variant="outline"
                className="ml-3"
                onClick={refresh}
              >
                Retry
              </Button>
            </Card>
          ) : null}

          <div className="space-y-5">
            <section aria-label="Log a meal" className="min-w-0 space-y-4">
              <Card className="border-accent/30">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    To {selectedDay === today ? "Today" : selectedDay}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">Meal slot</span>
                    <select
                      aria-label="Meal slot"
                      value={meal}
                      onChange={(event) => setMeal(event.target.value)}
                      className="h-11 rounded-xl border border-input bg-background px-3 text-base"
                    >
                      <option value="">Any meal</option>
                      {MEALS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slotLabel(slot)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="space-y-4">
                  <div className="flex flex-col gap-3">
                    <label
                      htmlFor="meal-description"
                      className="text-lg font-semibold"
                    >
                      Add food
                    </label>
                    <VoiceLogging
                      compact
                      day={selectedDay}
                      meal={meal}
                      onCommitted={() => refresh()}
                      input={
                        <Textarea
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="Add food…"
                          disabled={busy || !!estimate || !!estimateDestination}
                          id="meal-description"
                          aria-label="Meal description"
                          rows={2}
                          className="min-h-20 resize-none pr-28"
                        />
                      }
                      actions={
                        <Button
                          type="button"
                          size="icon"
                          className="rounded-full"
                          aria-label={busy ? "Estimating…" : "Estimate"}
                          title={busy ? "Estimating…" : "Estimate"}
                          onClick={requestEstimate}
                          disabled={
                            busy ||
                            cancellingEstimate ||
                            !!estimate ||
                            !!estimateDestination ||
                            !text.trim() ||
                            !selectedDay
                          }
                        >
                          {busy ? (
                            <Loader2 className="animate-spin" aria-hidden="true" />
                          ) : (
                            <ArrowUp aria-hidden="true" />
                          )}
                        </Button>
                      }
                    />
                    {(busy || (!estimate && estimateDestination)) && activeEstimate.current && (
                      <Button
                        onClick={cancelEstimate}
                        variant="ghost"
                        disabled={cancellingEstimate}
                      >
                        <X className="h-3.5 w-3.5" />
                        {cancellingEstimate ? "Cancelling…" : "Cancel estimate"}
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
                          variant={
                            estimate.confidence === "low"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {estimate.confidence} confidence
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Destination: {estimateDestination?.day} ·{" "}
                        {estimateDestination?.meal || "Unspecified meal"}
                      </p>

                      {estimate.confidence === "low" && (
                        <div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
                          <p className="text-xs text-warning">
                            Low-confidence estimate — double-check these numbers
                            before logging.
                          </p>
                        </div>
                      )}

                      <div
                        className="rounded-xl bg-muted/50 p-3"
                        aria-label="Meal estimate preview"
                      >
                        <p className="text-xl font-semibold">
                          {draft.kcal || "—"}{" "}
                          <span className="text-sm font-normal">kcal</span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Protein {draft.protein_g || "—"} g · Carbs{" "}
                          {draft.carbs_g || "—"} g · Fat {draft.fat_g || "—"} g
                        </p>
                        {estimate.items.length > 0 && (
                          <ul className="mt-3 space-y-1 text-sm">
                            {estimate.items.map((item, index) => (
                              <li
                                key={index}
                                className="flex justify-between gap-3"
                              >
                                <span>{item.name}</span>
                                <span className="shrink-0 text-muted-foreground">
                                  {item.qty_g} g
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <details>
                        <summary className="text-sm font-medium">
                          Edit calories & macros
                        </summary>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                              <label
                                htmlFor={`nutrition-review-${key}`}
                                className="text-xs font-medium uppercase tracking-widest text-muted-foreground block"
                              >
                                {label}
                              </label>
                              <Input
                                id={`nutrition-review-${key}`}
                                value={draft[key]}
                                onChange={(e) =>
                                  setDraft({ ...draft, [key]: e.target.value })
                                }
                                inputMode="decimal"
                                className="h-12 text-base"
                              />
                            </div>
                          ))}
                        </div>
                      </details>

                      {estimate.notes && (
                        <ReadMore label="Read estimate notes">
                          <Markdown>{estimate.notes}</Markdown>
                        </ReadMore>
                      )}

                      {estimate.items.some(
                        (item) => item.source === "saved",
                      ) && (
                        <details>
                          <summary>Ingredient sources</summary>
                          <ul className="text-sm space-y-2">
                            {estimate.items.map((item, index) => (
                              <li key={index}>
                                <span className="font-medium">{item.name}</span>
                                {item.source === "saved"
                                  ? ` · ${item.qty_g} g · saved values`
                                  : " · estimated"}
                                {item.nutrients && (
                                  <span className="block text-muted-foreground">
                                    {Object.entries(item.nutrients)
                                      .map(([key, value]) => `${key}: ${value}`)
                                      .join(" · ")}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-2 bg-card py-1">
                        <Button
                          onClick={confirmLog}
                          disabled={confirming}
                          size="sm"
                        >
                          {confirming ? "Saving…" : "Log meal"}
                        </Button>
                        <Button
                          onClick={discardEstimate}
                          disabled={confirming}
                          size="sm"
                          variant="ghost"
                        >
                          <X className="h-3.5 w-3.5" />
                          Edit description
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  className="mt-2"
                  variant="link"
                  size="sm"
                  onClick={openManual}
                  disabled={!selectedDay}
                >
                  Enter macros manually
                </Button>
                {busy && (
                  <p
                    role="status"
                    className="mt-3 text-sm text-muted-foreground"
                  >
                    Your estimate is running. You can leave and return.
                  </p>
                )}
                {!busy && !estimate && estimateDestination && (
                  <Button
                    variant="outline"
                    className="mt-3"
                    disabled={cancellingEstimate}
                    onClick={() => {
                      const raw = sessionStorage.getItem(
                        "pendingNutritionEstimate",
                      );
                      if (raw) {
                        const saved = JSON.parse(raw);
                        if (saved.id) {
                          setBusy(true);
                          pollEstimateResult(saved.id);
                        }
                      }
                    }}
                  >
                    Resume estimate
                  </Button>
                )}
                {err && <ErrorNotice message={err} />}
              </Card>
            </section>
            <section aria-label="Recently added foods">
              <Card title="Recently added foods">
                <QuickFoods
                  day={selectedDay}
                  meal={meal}
                  revision={reloadTick}
                  onChanged={refresh}
                />
              </Card>
            </section>
            <div
              className="min-w-0 space-y-4"
              aria-label="Foods eaten on selected day"
              role="region"
            >
              <Card
                title={
                  selectedDay === today
                    ? "Foods eaten today"
                    : `Foods eaten · ${selectedDay}`
                }
              >
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
                    <p className="text-muted-foreground text-sm font-medium">
                      Nothing logged yet
                    </p>
                    <Button
                      className="mt-3"
                      onClick={() => focusLogger("meal-description")}
                    >
                      Add food
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-3 divide-y divide-border">
                    {todayLogs.map((l) => (
                      <li
                        key={l.id}
                        id={`diary-entry-${l.id}`}
                        className="text-sm pt-3 first:pt-0 scroll-mt-24"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="outline">{l.meal || "\u2014"}</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-muted-foreground hover:text-accent hover:bg-accent/10"
                            onClick={() => setDeleteId(l.id)}
                            aria-label="Delete entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEntry(l, "edit")}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEntry(l, "repeat")}
                          >
                            Repeat
                          </Button>
                        </div>
                        <div className="text-foreground mt-1.5 font-medium">
                          {l.raw_text}
                        </div>
                        <div className="text-muted-foreground text-xs mt-1 font-sans">
                          {l.kcal?.toFixed(0)} kcal · P{" "}
                          {l.protein_g?.toFixed(0)} / C {l.carbs_g?.toFixed(0)}{" "}
                          / F {l.fat_g?.toFixed(0)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {l.estimated_by === "repeat"
                            ? "Repeated recorded values"
                            : l.estimated_by?.startsWith("saved")
                              ? "Saved food values"
                              : l.estimated_by?.startsWith("mixed")
                                ? "Saved values + estimates"
                                : l.estimated_by?.startsWith("manual")
                                  ? "Manual or edited values"
                                  : "Estimated values"}
                          {Boolean(l.micros?.totals_edited) &&
                            " · Ingredient estimates may differ from edited totals"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <details className="rounded-2xl border border-border bg-card p-4">
                <summary className="font-medium">
                  All nutrients & totals
                </summary>
                <div className="space-y-4 pt-3">
                  {targets && (
                    <MacroProgress
                      label="Fiber"
                      actual={totals?.fiber_g ?? 0}
                      target={targets.fiber_g}
                      unit="g"
                    />
                  )}
                  <Card title={`Diary totals (${selectedDay})`}>
                    {loading && !totals ? (
                      <div className="space-y-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <Skeleton key={i} className="h-5 w-full" />
                        ))}
                      </div>
                    ) : totals ? (
                      <>
                        <StatRow
                          label="Calories"
                          value={`${totals.kcal.toFixed(0)} kcal`}
                        />
                        <StatRow
                          label="Protein"
                          value={`${totals.protein_g.toFixed(0)} g`}
                        />
                        <StatRow
                          label="Carbs"
                          value={`${totals.carbs_g.toFixed(0)} g`}
                        />
                        <StatRow
                          label="Fat"
                          value={`${totals.fat_g.toFixed(0)} g`}
                        />
                        <StatRow
                          label="Fiber"
                          value={`${totals.fiber_g.toFixed(0)} g`}
                        />
                        <StatRow label="Entries" value={totals.entry_count} />
                      </>
                    ) : (
                      <div className="flex flex-col items-center py-8 text-center">
                        <div className="h-10 w-10 border border-dashed border-border flex items-center justify-center mb-2">
                          <Utensils
                            className="h-4 w-4 text-muted-foreground"
                            strokeWidth={1.5}
                          />
                        </div>
                        <p className="text-muted-foreground text-sm font-medium">
                          No data yet
                        </p>
                      </div>
                    )}
                  </Card>

                  <Card title={`Micros (${selectedDay})`}>
                    {loading && !totals ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-5 w-full" />
                        ))}
                      </div>
                    ) : totals && Object.keys(totals.micros).length > 0 ? (
                      Object.entries(totals.micros)
                        .filter(
                          ([k]) =>
                            !["items", "confidence", "notes"].includes(k),
                        )
                        .map(([k, v]) => (
                          <StatRow
                            key={k}
                            label={k}
                            value={
                              typeof v === "number" ? v.toFixed(1) : String(v)
                            }
                            hint={
                              totals.incomplete_micros?.includes(k)
                                ? "incomplete"
                                : undefined
                            }
                          />
                        ))
                    ) : (
                      <div className="flex flex-col items-center py-8 text-center">
                        <p className="text-muted-foreground text-sm font-medium">
                          No data yet
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">
                      Known amounts only. Missing nutrient values are unknown,
                      not zero.
                    </p>
                  </Card>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
      {view === "foods" && (
        <div id="my-foods" className="space-y-4">
          <ViewTabs label="Food library views" value={libraryView} onChange={setLibraryView}
            items={[{ value: "products", label: "My foods" }, { value: "recipes", label: "My recipes" }]} />
          {libraryView === "recipes" ? <RecipeLibrary day={selectedDay} onLogged={(loggedDay) => {
            setSelectedDay(loggedDay); refresh(); setEntryMessage(`Logged recipe portion for ${loggedDay}`);
          }} /> :
          <FoodLibrary
            mode="manage"
            onLogged={(loggedDay) => {
              setSelectedDay(loggedDay);
              setView("diary");
              refresh();
              setEntryMessage(`Logged food for ${loggedDay}`);
            }}
            meal={meal}
            day={selectedDay}
          />
          }
        </div>
      )}
      {view === "plans" && (
        <div className="space-y-4">
          <ViewTabs
            label="Plan views"
            value={planView}
            onChange={setPlanView}
            items={[
              { value: "daily", label: "Today" },
              { value: "suggestions", label: "Eat now" },
              { value: "competition", label: "Competition" },
              { value: "shopping", label: "Shopping" },
            ]}
          />
          {planView === "suggestions" && <MealSuggestions day={selectedDay} onLogged={(loggedDay) => {
            setSelectedDay(loggedDay); refresh(); setEntryMessage(`Logged chosen meal for ${loggedDay}`);
          }} />}
          {planView === "competition" && (
            <CompetitionNutritionPlanner
              onChanged={refresh}
              onSelectDay={(day) => {
                setSelectedDay(day);
                setView("diary");
              }}
            />
          )}
          {planView === "daily" && (
            <>
              {/* Meal plan */}
              <Card
                title="Today's meal plan"
                icon={<ChefHat className="h-4 w-4" />}
                action={
                  <Button
                    onClick={generatePlan}
                    disabled={planBusy}
                    size="sm"
                    variant={plan ? "outline" : "default"}
                  >
                    <ChefHat className="h-3.5 w-3.5" />
                    {planBusy
                      ? "Generating…"
                      : plan
                        ? "Regenerate"
                        : "Generate"}
                  </Button>
                }
              >
                {planError && (
                  <p role="alert" className="text-sm text-accent mb-3">
                    {planError} The previous plan remains available.
                  </p>
                )}
                {planNeedsReview && (
                  <p role="status" className="text-sm text-warning mb-3">
                    This saved plan predates your current food restrictions,
                    preferences, or budget. Review it and regenerate before
                    relying on it.
                  </p>
                )}
                {savedContext && (
                  <details className="mb-3 text-sm text-muted-foreground">
                    <summary>Preferences used in this plan</summary>
                    <p>
                      Planned with restrictions:{" "}
                      {String(savedContext.restrictions || "none")} ·
                      Preferences: {String(savedContext.preferences || "none")}{" "}
                      · Budget: {String(savedContext.budget || "unspecified")}.
                      Ingredient-name checks do not guarantee allergen or
                      cross-contact safety.
                    </p>
                  </details>
                )}
                {!plan ? (
                  <div className="flex flex-col items-center py-10 text-center">
                    <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
                      <ChefHat
                        className="h-5 w-5 text-muted-foreground"
                        strokeWidth={1.5}
                      />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">
                      No plan for today yet
                    </p>
                    <p className="text-muted-foreground text-xs mt-1 font-sans">
                      Click generate to have the coach build one
                    </p>
                  </div>
                ) : (
                  renderMealPlan(plan.plan)
                )}
              </Card>
            </>
          )}
          {planView === "shopping" && (
            <>
              {/* Shopping list */}
              <Card
                title="Weekly shopping list"
                icon={<ShoppingCart className="h-4 w-4" />}
                action={
                  <Button
                    onClick={loadShopping}
                    disabled={shopBusy}
                    size="sm"
                    variant="outline"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {shopBusy ? "Loading…" : shopping ? "Refresh" : "Load"}
                  </Button>
                }
              >
                {!shopping ? (
                  <div className="flex flex-col items-center py-10 text-center">
                    <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
                      <ShoppingCart
                        className="h-5 w-5 text-muted-foreground"
                        strokeWidth={1.5}
                      />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">
                      Weekly shopping aggregator
                    </p>
                    <p className="text-muted-foreground text-xs mt-1 font-sans">
                      Aggregates ingredients from generated meal plans for the
                      next 7 days
                    </p>
                  </div>
                ) : shopping.item_count === 0 ? (
                  <p className="text-muted-foreground text-sm font-sans">
                    No usable shopping quantities for {shopping.start} →{" "}
                    {shopping.end}.
                    {shopping.missing_days.length > 0 && (
                      <>
                        {" "}
                        Missing or unusable coverage:{" "}
                        {shopping.missing_days.join(", ")}
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3 font-sans">
                      {shopping.start} → {shopping.end} · {shopping.item_count}{" "}
                      items · covered: {shopping.days_covered.length}/7 days{" "}
                      {shopping.missing_days.length > 0
                        ? "(partial)"
                        : "(complete)"}
                      {shopping.missing_days.length > 0 && (
                        <>
                          {" "}
                          · missing or unusable coverage:{" "}
                          {shopping.missing_days.join(", ")}
                        </>
                      )}
                    </p>
                    <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                      {shopping.items.map((it, i) => (
                        <li
                          key={i}
                          className="flex justify-between border-b border-border py-2"
                        >
                          <span className="text-foreground font-medium">
                            {it.name}
                          </span>
                          <span className="font-sans text-muted-foreground text-xs">
                            {it.qty_g} g
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      {(manualMode || editing || repeating) && (
        <Editor
          open
          onOpenChange={(open) => {
            if (!open && !entryBusy) {
              setEditing(null);
              setRepeating(null);
              setManualMode(false);
            }
          }}
          title={
            repeating
              ? "Repeat meal"
              : editing
                ? "Edit diary entry"
                : "Enter macros manually"
          }
        >
          <div className="space-y-3">
            {entryError && (
              <p role="alert" className="text-sm text-destructive">
                {entryError}{" "}
                {entryError.includes("409") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!editing) return;
                      try {
                        const latest = (
                          await api.nutrition.forDay(editing.day)
                        ).find((item) => item.id === editing.id);
                        if (latest) openEntry(latest, "edit");
                        else
                          setEntryError(
                            "This entry was removed. Close this editor and refresh the diary.",
                          );
                        refresh();
                      } catch (error) {
                        setEntryError(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }}
                  >
                    Reload latest entry
                  </Button>
                )}
              </p>
            )}
            {repeating && (
              <p className="text-sm text-muted-foreground">
                Copying recorded values from {repeating.day}. The original stays
                unchanged.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs">
                Destination date
                <Input
                  type="date"
                  value={entryDraft.day}
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, day: event.target.value })
                  }
                />
              </label>
              <label className="text-xs">
                Meal slot
                <select
                  className="block h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                  value={entryDraft.meal}
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, meal: event.target.value })
                  }
                >
                  <option value="">Unspecified</option>
                  {MEALS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabel(slot)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!repeating && (
              <label className="text-xs block">
                Description
                <Input
                  value={entryDraft.raw_text}
                  onChange={(event) =>
                    setEntryDraft({
                      ...entryDraft,
                      raw_text: event.target.value,
                    })
                  }
                />
              </label>
            )}
            {repeating ? (
              <>
                <label className="text-xs block">
                  Portion multiplier
                  <Input
                    type="number"
                    min="0.01"
                    max="20"
                    step="any"
                    value={entryDraft.multiplier}
                    onChange={(event) =>
                      setEntryDraft({
                        ...entryDraft,
                        multiplier: event.target.value,
                      })
                    }
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  Preview: {repeating.raw_text} ·{" "}
                  {repeating.kcal === null
                    ? "Unknown kcal"
                    : `${(repeating.kcal * Number(entryDraft.multiplier || 0)).toFixed(0)} kcal`}{" "}
                  · P{" "}
                  {repeating.protein_g === null
                    ? "Unknown"
                    : (
                        repeating.protein_g * Number(entryDraft.multiplier || 0)
                      ).toFixed(1)}{" "}
                  g · C{" "}
                  {repeating.carbs_g === null
                    ? "Unknown"
                    : (
                        repeating.carbs_g * Number(entryDraft.multiplier || 0)
                      ).toFixed(1)}{" "}
                  g · F{" "}
                  {repeating.fat_g === null
                    ? "Unknown"
                    : (
                        repeating.fat_g * Number(entryDraft.multiplier || 0)
                      ).toFixed(1)}{" "}
                  g
                </p>
              </>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {(
                  [
                    ["kcal", "Calories (kcal)"],
                    ["protein_g", "Protein (g)"],
                    ["carbs_g", "Carbs (g)"],
                    ["fat_g", "Fat (g)"],
                    ["fiber_g", "Fiber (g)"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs">
                    {label}
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      placeholder={
                        editing || key === "fiber_g" ? "Unknown" : "Required"
                      }
                      value={entryDraft[key]}
                      onChange={(event) =>
                        setEntryDraft({
                          ...entryDraft,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="sticky bottom-0 flex flex-wrap gap-2 bg-card py-3">
              <Button size="sm" disabled={entryBusy} onClick={saveEntry}>
                {entryBusy
                  ? "Saving…"
                  : repeating
                    ? "Save copy"
                    : editing
                      ? "Save changes"
                      : "Log meal"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={entryBusy}
                onClick={() => {
                  setEditing(null);
                  setRepeating(null);
                  setManualMode(false);
                  setEntryError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Editor>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete diary entry?"
        description="This removes the meal and updates that day's totals."
        confirmLabel="Delete entry"
        onConfirm={async () => {
          if (deleteId !== null) await remove(deleteId);
        }}
      />
    </div>
  );
}
