"use client";

import { PageHeading } from "@/components/page-heading";

import {
  ErrorNotice,
  ReadMore,
  useView,
  ViewTabs,
} from "@/components/mobile-ui";
import { BandPill, Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  FencingAnalysis,
  MentalEntry,
  MentalEntryInput,
  MentalInsight,
  TrainingSession,
} from "@/lib/api";
import { useGarminSyncObserver } from "@/lib/garmin-refresh";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import {
  BedDouble,
  Brain,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Minus,
  RotateCcw,
  Send,
  Sparkles,
  Swords,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ── helpers ──────────────────────────────────────────────────────────
function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  check_in: "Check-in",
  pre_comp: "Pre-comp",
  reflection: "Reflection",
};

// ── Fencing Session Analysis ─────────────────────────────────────────
const TREND_LABELS: Record<FencingAnalysis["training_load_trend"], string> = {
  increasing: "Load trending up",
  decreasing: "Load trending down",
  stable: "Load stable",
  insufficient_data: "Not enough sessions yet",
};

function FencingAnalysisSection() {
  const [analysis, setAnalysis] = useState<FencingAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function loadAnalysis() {
    setErr(null);
    api.fencing
      .analysis(90)
      .then(setAnalysis)
      .catch((e: any) => setErr(e?.message ?? String(e)));
  }
  useEffect(loadAnalysis, []);

  const TrendIcon =
    analysis?.training_load_trend === "increasing"
      ? TrendingUp
      : analysis?.training_load_trend === "decreasing"
        ? TrendingDown
        : Minus;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <Swords className="h-5 w-5 text-accent" />
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
          Fencing sessions
        </h2>
      </div>

      {err && <ErrorNotice message={err} retry={loadAnalysis} />}

      {!analysis && !err ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : analysis ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Sessions ({analysis.window_days}d)
              </span>
              <span className="text-2xl font-sans font-medium">
                {analysis.session_count}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Avg duration
              </span>
              <span className="text-2xl font-sans font-medium">
                {analysis.avg_duration_min != null
                  ? `${analysis.avg_duration_min.toFixed(0)}m`
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Avg load
              </span>
              <span className="text-2xl font-sans font-medium">
                {analysis.avg_training_load != null
                  ? analysis.avg_training_load.toFixed(0)
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Trend
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <TrendIcon className="h-4 w-4" />
                {TREND_LABELS[analysis.training_load_trend]}
              </span>
            </div>
          </div>

          {analysis.max_hr_estimate && (
            <details className="text-sm text-muted-foreground">
              <summary>How HR zones are estimated</summary>
              <p>
                HR zones estimated from max HR ≈{" "}
                {analysis.max_hr_estimate.toFixed(0)} bpm (
                {analysis.max_hr_source}). Zones characterize each
                session&rsquo;s avg/max HR — not time-in-zone (Garmin
                doesn&rsquo;t give us per-minute detail for these activities).
              </p>
            </details>
          )}

          {analysis.sessions.length > 0 && (
            <Card title="Recent sessions">
              <div className="divide-y divide-border lg:hidden">
                {analysis.sessions
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((session) => (
                    <details key={session.activity_id}>
                      <summary className="text-sm font-medium">
                        {formatDate(session.day)} ·{" "}
                        {session.duration_min?.toFixed(0) ?? "Unknown"} min
                      </summary>
                      <dl className="grid grid-cols-2 gap-3 pb-4 text-sm">
                        <div>
                          <dt className="text-muted-foreground">Average HR</dt>
                          <dd>
                            {session.avg_hr ?? "—"} bpm {session.avg_hr_zone}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Maximum HR</dt>
                          <dd>
                            {session.max_hr ?? "—"} bpm {session.max_hr_zone}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            Training load
                          </dt>
                          <dd>{session.training_load ?? "—"}</dd>
                        </div>
                      </dl>
                    </details>
                  ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground">
                      <th className="font-medium pb-2">Day</th>
                      <th className="font-medium pb-2">Duration</th>
                      <th className="font-medium pb-2">Avg HR</th>
                      <th className="font-medium pb-2">Max HR</th>
                      <th className="font-medium pb-2">Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.sessions
                      .slice()
                      .reverse()
                      .slice(0, 10)
                      .map((s) => (
                        <tr
                          key={s.activity_id}
                          className="border-t border-border"
                        >
                          <td className="py-2 font-sans text-xs">{s.day}</td>
                          <td className="py-2 font-sans text-xs">
                            {s.duration_min != null
                              ? `${s.duration_min.toFixed(0)}m`
                              : "—"}
                          </td>
                          <td className="py-2 font-sans text-xs">
                            {s.avg_hr ?? "—"}
                            {s.avg_hr_zone ? ` (${s.avg_hr_zone})` : ""}
                          </td>
                          <td className="py-2 font-sans text-xs">
                            {s.max_hr ?? "—"}
                            {s.max_hr_zone ? ` (${s.max_hr_zone})` : ""}
                          </td>
                          <td className="py-2 font-sans text-xs">
                            {s.training_load ?? "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {analysis.session_count === 0 && (
            <p className="text-sm text-muted-foreground">
              No fencing sessions found in the last {analysis.window_days} days.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── Mental Training Section ──────────────────────────────────────────
function MentalTrainingSection() {
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [entries, setEntries] = useState<MentalEntry[] | null>(null);
  const [insight, setInsight] = useState<MentalInsight | null>(null);
  const [entryType, setEntryType] =
    useState<MentalEntryInput["entry_type"]>("check_in");
  const [mood, setMood] = useState<number>(7);
  const [energy, setEnergy] = useState<number>(7);
  const [focus, setFocus] = useState<number>(7);
  const [confidence, setConfidence] = useState<number>(7);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    api.mental
      .list(14)
      .then(setEntries)
      .catch((error) =>
        setError(
          error instanceof Error ? error.message : "Could not load check-ins",
        ),
      );
  }, []);

  const fetchInsight = useCallback(() => {
    setLoadingInsight(true);
    api.mental
      .insight(14)
      .then(setInsight)
      .catch((error) =>
        setError(
          error instanceof Error ? error.message : "Could not load insight",
        ),
      )
      .finally(() => setLoadingInsight(false));
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchInsight();
  }, [fetchEntries, fetchInsight]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.mental.create({
        entry_type: entryType,
        mood_score: mood,
        energy_score: energy,
        focus_score: focus,
        confidence_score: confidence,
        content: content.trim() || undefined,
      });
      setContent("");
      setSaved(true);
      fetchEntries();
      fetchInsight();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    }
    setSubmitting(false);
  }

  async function handleDelete(id: number) {
    try {
      await api.mental.delete(id);
      fetchEntries();
      fetchInsight();
    } catch (err) {
      throw err;
    }
  }

  const TrendIcon =
    insight?.trend === "improving"
      ? TrendingUp
      : insight?.trend === "declining"
        ? TrendingDown
        : Minus;

  const trendColor =
    insight?.trend === "improving"
      ? "text-success"
      : insight?.trend === "declining"
        ? "text-accent"
        : "text-muted-foreground";

  return (
    <section>
      {/* Section header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Brain className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground font-sans">
            Mental training
          </p>
        </div>
        <div className="h-px w-full bg-border" />
      </div>

      {error && (
        <ErrorNotice
          message={error}
          retry={() => {
            setError(null);
            fetchEntries();
            fetchInsight();
          }}
        />
      )}

      {saved && (
        <p role="status" className="text-sm text-success mb-4">
          Check-in saved.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Check-in / Editor ──────────────────────────── */}
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Entry type selector */}
            <div className="flex flex-wrap gap-2">
              {(["check_in", "pre_comp", "reflection"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={entryType === t}
                  onClick={() => setEntryType(t)}
                  className={`
                    min-h-11 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150
                    ${
                      entryType === t
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground border border-border"
                    }
                  `}
                >
                  {ENTRY_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Score sliders */}
            <div className="space-y-3">
              {(
                [
                  ["Mood", mood, setMood],
                  ["Energy", energy, setEnergy],
                  ["Focus", focus, setFocus],
                  ["Confidence", confidence, setConfidence],
                ] as [
                  string,
                  number,
                  React.Dispatch<React.SetStateAction<number>>,
                ][]
              ).map(([label, value, setter]) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground font-sans">
                      {label}
                    </span>
                    <span className="text-xs font-sans text-foreground">
                      {value}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={value}
                    onChange={(e) => setter(Number(e.target.value))}
                    className="w-full h-11 cursor-pointer accent-accent"
                    aria-valuetext={`${value} out of 10`}
                    aria-label={`${label} score`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 · Low</span>
                    <span>10 · High</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Content textarea */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                entryType === "check_in"
                  ? "How are you feeling today?"
                  : entryType === "pre_comp"
                    ? "Mindset and goals for the upcoming competition..."
                    : "Reflect on today's training or competition..."
              }
              rows={3}
              className="w-full bg-transparent border border-border px-3 py-2 rounded-xl text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground resize-none font-sans"
              aria-label="Mental training content"
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 rounded-xl items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors duration-150"
            >
              <Send className="h-3 w-3" strokeWidth={1.5} />
              {submitting ? "Saving..." : "Log entry"}
            </button>
          </form>
        </div>

        {/* ── Recent entries ─────────────────────────────── */}
        <details className="lg:col-span-1 rounded-2xl border border-border bg-card p-4">
          <summary className="font-medium">Recent entries</summary>
          {entries === null && !error ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {error
                ? "Entries unavailable. Retry above."
                : "No entries yet. Start with a check-in."}
            </p>
          ) : (
            <div className="space-y-2">
              {entries.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="border border-border p-3 group relative"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                        {ENTRY_TYPE_LABELS[entry.entry_type] ||
                          entry.entry_type}
                      </span>
                      <span className="text-xs text-muted-foreground font-sans">
                        {formatDate(entry.day)}
                      </span>
                    </div>
                    <button
                      onClick={() => setDeleteId(entry.id)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-accent"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>

                  {/* Scores bar */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-1">
                    {entry.mood_score != null && (
                      <span>Mood {entry.mood_score}</span>
                    )}
                    {entry.energy_score != null && (
                      <span>Energy {entry.energy_score}</span>
                    )}
                    {entry.focus_score != null && (
                      <span>Focus {entry.focus_score}</span>
                    )}
                    {entry.confidence_score != null && (
                      <span>Confidence {entry.confidence_score}</span>
                    )}
                  </div>

                  {entry.content && (
                    <ReadMore className="text-sm text-muted-foreground">
                      {entry.content}
                    </ReadMore>
                  )}
                </div>
              ))}
            </div>
          )}
        </details>

        {/* ── Insight / Snapshot ─────────────────────────── */}
        <details className="lg:col-span-1 rounded-2xl border border-border bg-card p-4">
          <summary className="font-medium">Insight</summary>
          {loadingInsight ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : insight && insight.entry_count > 0 ? (
            <div className="space-y-4">
              {/* Trend */}
              <div className="flex items-center gap-2">
                <TrendIcon
                  className={`h-4 w-4 ${trendColor}`}
                  strokeWidth={1.5}
                />
                <span
                  className={`text-xs font-sans uppercase tracking-wide ${trendColor}`}
                >
                  {insight.trend}
                </span>
                <span className="text-xs text-muted-foreground font-sans">
                  ({insight.entry_count} entries / {insight.period_days}d)
                </span>
              </div>

              {/* Averages */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["Mood", insight.avg_mood],
                    ["Energy", insight.avg_energy],
                    ["Focus", insight.avg_focus],
                    ["Confidence", insight.avg_confidence],
                  ] as [string, number | null][]
                ).map(([label, val]) => (
                  <div key={label} className="border border-border p-2">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground font-sans">
                      {label}
                    </p>
                    <p className="text-lg font-bold tracking-tight">
                      {val != null ? val.toFixed(1) : "\u2014"}
                    </p>
                  </div>
                ))}
              </div>

              {/* LLM insight text */}
              <div className="border-l-2 border-accent pl-3">
                <ReadMore label="Read full insight">
                  <Markdown>{insight.insight}</Markdown>
                </ReadMore>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {error
                ? "Insight unavailable. Retry above."
                : "Log at least 3 entries to see insights."}
            </p>
          )}
        </details>
      </div>
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete check-in?"
        description="This permanently removes this mental training entry."
        confirmLabel="Delete entry"
        onConfirm={async () => {
          if (deleteId !== null) await handleDelete(deleteId);
        }}
      />
    </section>
  );
}

// ── main ─────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const [view, setView] = useView(
    ["plan", "fencing", "mindset"] as const,
    "plan",
  );
  const [selectedDay, setSelectedDay] = useState("");
  const [resetDay, setResetDay] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [weekStart, setWeekStart] = useState<Date>(mondayOf(new Date()));
  const [week, setWeek] = useState<TrainingSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resettingDay, setResettingDay] = useState<string | null>(null);
  const weekRequest = useRef(0);

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  const fetchWeek = useCallback(() => {
    setErr(null);
    const request = ++weekRequest.current;
    api.training
      .week(isoDate(weekStart))
      .then((value) => {
        if (request === weekRequest.current) setWeek(value);
      })
      .catch((e) => {
        if (request === weekRequest.current) {
          setErr(e?.message);
          setWeek([]);
        }
      });
  }, [weekStart]);

  useEffect(() => {
    fetchWeek();
  }, [fetchWeek]);
  useEffect(() => {
    api.readiness
      .today()
      .then((t) => {
        setToday(t.day);
        const requestedDay = new URLSearchParams(window.location.search).get(
          "day",
        );
        const shownDay =
          requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay)
            ? requestedDay
            : t.day;
        setSelectedDay(shownDay);
        setWeekStart(mondayOf(new Date(`${shownDay}T12:00:00`)));
      })
      .catch(() => {});
  }, []);
  useGarminSyncObserver(fetchWeek);
  useWorkflowRefresh(fetchWeek);

  async function resetOverride(day: string) {
    setResettingDay(day);
    try {
      await api.training.clearOverride(day);
      fetchWeek();
    } finally {
      setResettingDay(null);
    }
  }

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
    setWeek(null);
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
    setWeek(null);
  }

  useEffect(() => {
    const rail = document.querySelector<HTMLElement>(
      '[aria-label="Select training day"]',
    );
    const selected = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !selected) return;
    const bounds = rail.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.right > bounds.right) rail.scrollLeft += item.right - bounds.right;
    else if (item.left < bounds.left)
      rail.scrollLeft -= bounds.left - item.left;
  }, [selectedDay, week, view]);

  const loading = week === null;
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <PageHeading title="Training" eyebrow="Weekly split" />
      <ViewTabs
        value={view}
        onChange={setView}
        label="Training views"
        items={[
          { value: "plan", label: "Plan" },
          { value: "fencing", label: "Fencing" },
          { value: "mindset", label: "Mindset" },
        ]}
      />
      {view === "plan" && (
        <section className="space-y-4">
          {/* Week navigation */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              aria-label="Previous week"
              onClick={prevWeek}
              className="h-11 w-11 rounded-xl inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <span className="text-sm font-sans text-muted-foreground tracking-wide">
              {formatDate(isoDate(weekStart))} —{" "}
              {formatDate(isoDate(weekEndDate))}
            </span>
            <button
              aria-label="Next week"
              onClick={nextWeek}
              className="h-11 w-11 rounded-xl inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!today}
            onClick={() => {
              setSelectedDay(today);
              setWeekStart(mondayOf(new Date(`${today}T12:00:00`)));
            }}
          >
            Today
          </Button>

          {err && <ErrorNotice message={err} retry={fetchWeek} />}

          {week && (
            <div
              aria-label="Select training day"
              className="flex gap-1 overflow-x-auto pb-2"
            >
              {week.map((day) => (
                <button
                  key={day.day}
                  aria-label={`${day.weekday}, ${day.day}`}
                  onClick={() => {
                    setSelectedDay(day.day);
                    const url = new URL(window.location.href);
                    url.searchParams.set("day", day.day);
                    window.history.replaceState({}, "", url);
                  }}
                  aria-pressed={
                    (week.some((item) => item.day === selectedDay)
                      ? selectedDay
                      : week[0]?.day) === day.day
                  }
                  className={`min-h-14 min-w-11 flex-1 rounded-xl border px-1 text-sm ${(week.some((item) => item.day === selectedDay) ? selectedDay : week[0]?.day) === day.day ? "border-accent bg-accent/10 text-accent" : "border-border"}`}
                >
                  <span className="block">{day.weekday.slice(0, 3)}</span>
                  <span className="text-xs">{day.day.slice(-2)}</span>
                </button>
              ))}
            </div>
          )}
          {/* ── Weekly Schedule Cards ──────────────────────────────────── */}
          {loading ? (
            <div className="space-y-4">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="border border-border p-6 space-y-3">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {week
                .filter(
                  (session) =>
                    session.day ===
                    (week.some((item) => item.day === selectedDay)
                      ? selectedDay
                      : week[0]?.day),
                )
                .map((session) => {
                  const dayType = session.activity_type;
                  const isToday = session.day === today;

                  return (
                    <div
                      key={session.day}
                      className={`
                  training-session relative rounded-lg bg-card border p-4 sm:p-6 transition-colors duration-150
                  ${isToday ? "border-accent" : "border-border hover:border-muted-foreground/30"}
                `}
                    >
                      {/* Top accent bar for today */}
                      {isToday && (
                        <div className="absolute top-0 left-0 h-0.5 w-full bg-accent" />
                      )}

                      {/* Day header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          {dayType === "fencing" && (
                            <Swords
                              className="h-4 w-4 text-muted-foreground"
                              strokeWidth={1.5}
                            />
                          )}
                          {dayType === "gym" && (
                            <Dumbbell
                              className="h-4 w-4 text-accent"
                              strokeWidth={1.5}
                            />
                          )}
                          {dayType === "rest" && (
                            <BedDouble
                              className="h-4 w-4 text-muted-foreground"
                              strokeWidth={1.5}
                            />
                          )}
                          {dayType === "competition" && (
                            <Swords
                              className="h-4 w-4 text-accent"
                              strokeWidth={1.5}
                            />
                          )}
                          <span className="font-semibold text-base tracking-wide text-foreground">
                            {session.weekday}
                          </span>
                        </div>
                        <span className="text-xs text-foreground/75 font-sans tracking-wide">
                          {formatDate(session.day)}
                        </span>
                      </div>

                      {/* Fencing day */}
                      {dayType === "competition" && (
                        <div className="space-y-3">
                          <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                            Competition day
                          </span>
                          {session.competitions.map((event) => (
                            <div
                              key={event.id}
                              className="border border-border p-3 space-y-1"
                            >
                              <a
                                href={`/competitions#competition-${event.id}`}
                                className="font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              >
                                {event.name}
                              </a>
                              <p className="text-xs text-muted-foreground">
                                {event.event_date}
                                {event.end_date &&
                                event.end_date !== event.event_date
                                  ? ` – ${event.end_date}`
                                  : ""}{" "}
                                · Priority {event.priority}
                                {event.location ? ` · ${event.location}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {dayType === "fencing" && (
                        <div className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
                            Fencing
                          </span>
                          <p className="text-base text-foreground/90 leading-relaxed">
                            Club session — conditioning + sparring (~2h)
                          </p>
                          <p className="text-xs text-foreground/70 font-sans">
                            {session.weekday === "Saturday" ? "11:00" : "20:00"}
                          </p>
                        </div>
                      )}

                      {/* Rest day */}
                      {dayType === "rest" && (
                        <div className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-widest text-foreground/70">
                            Rest
                          </span>
                          <p className="text-base text-foreground/80 leading-relaxed">
                            Recovery day — no structured training.
                          </p>
                        </div>
                      )}

                      {/* Gym day */}
                      {(dayType === "gym" || dayType === "competition") &&
                        session.session && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                                {dayType === "competition"
                                  ? "Additional planned work"
                                  : "Gym"}
                              </span>
                              <span className="text-xs text-foreground/75 capitalize font-sans">
                                {session.session.name.replace(/_/g, " ")}
                              </span>
                              {session.source === "manual" && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-accent border border-accent/40 px-1.5 py-0.5">
                                  <Sparkles
                                    className="h-3 w-3"
                                    strokeWidth={1.5}
                                  />
                                  Coach edit
                                </span>
                              )}
                            </div>
                            <div className="space-y-1.5 border-t border-border pt-3">
                              {session.session.exercises.map((rx) => (
                                <div
                                  key={rx.exercise}
                                  className="flex flex-col gap-1 border-b border-border py-2 text-sm sm:flex-row sm:justify-between"
                                >
                                  <span className="text-foreground text-base leading-snug">
                                    {rx.exercise}
                                  </span>
                                  <span className="font-sans text-foreground/75 text-xs whitespace-nowrap">
                                    {rx.sets}x{rx.reps}
                                    {rx.load_kg != null
                                      ? ` @${rx.load_kg}kg`
                                      : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {session.source === "manual" &&
                              session.session.rationale && (
                                <details className="text-sm">
                                  <summary>Why the coach changed this</summary>
                                  <p>{session.session.rationale}</p>
                                </details>
                              )}
                            {session.source === "manual" && (
                              <button
                                onClick={() => setResetDay(session.day)}
                                disabled={resettingDay === session.day}
                                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors duration-150"
                              >
                                <RotateCcw
                                  className="h-3 w-3"
                                  strokeWidth={1.5}
                                />
                                {resettingDay === session.day
                                  ? "Resetting…"
                                  : "Reset to auto plan"}
                              </button>
                            )}
                          </div>
                        )}

                      {/* Phase & readiness (today only) */}
                      {isToday && (
                        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                          <span className="text-xs font-sans text-foreground/75">
                            {(session.phase as any)?.name ?? "\u2014"}
                          </span>
                          {(session.readiness as any)?.band && (
                            <BandPill band={(session.readiness as any).band} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}
      {view === "fencing" && <FencingAnalysisSection />}

      {/* ── Mental Training ────────────────────────────────────────── */}
      {view === "mindset" && <MentalTrainingSection />}
      <ConfirmDialog
        open={resetDay !== null}
        onOpenChange={(open) => {
          if (!open) setResetDay(null);
        }}
        title="Reset to automatic workout?"
        description="This removes the coach edit for this date and restores the calculated session. Competition details stay unchanged."
        confirmLabel="Reset workout"
        onConfirm={async () => {
          if (resetDay) await resetOverride(resetDay);
        }}
      />
    </div>
  );
}
