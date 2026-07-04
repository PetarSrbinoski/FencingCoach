"use client";

import { useEffect, useState, useCallback } from "react";
import { api, TrainingSession, MentalEntry, MentalInsight, MentalEntryInput, FencingAnalysis } from "@/lib/api";
import { BandPill, Card, StatRow } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/ui/markdown";
import {
  Dumbbell, Swords, BedDouble, ChevronLeft, ChevronRight,
  Brain, Send, Trash2, TrendingUp, TrendingDown, Minus, X,
  Sparkles, RotateCcw,
} from "lucide-react";

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

function classifyDay(s: TrainingSession): "fencing" | "gym" | "rest" {
  if (s.session) return "gym";
  const reason = (s.reason || "").toLowerCase();
  if (reason.includes("rest")) return "rest";
  const wd = s.weekday;
  if (["Monday", "Wednesday", "Friday", "Saturday"].includes(wd)) return "fencing";
  return "rest";
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

  useEffect(() => {
    api.fencing
      .analysis(90)
      .then(setAnalysis)
      .catch((e: any) => setErr(e?.message ?? String(e)));
  }, []);

  const TrendIcon =
    analysis?.training_load_trend === "increasing"
      ? TrendingUp
      : analysis?.training_load_trend === "decreasing"
        ? TrendingDown
        : Minus;

  return (
    <section className="border-t border-border pt-12">
      <div className="flex items-center gap-2 mb-6">
        <Swords className="h-5 w-5 text-accent" />
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Fencing sessions</h2>
      </div>

      {err && <p className="text-sm text-accent">{err}</p>}

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
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Sessions ({analysis.window_days}d)
              </span>
              <span className="text-2xl font-mono font-medium">{analysis.session_count}</span>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Avg duration
              </span>
              <span className="text-2xl font-mono font-medium">
                {analysis.avg_duration_min != null ? `${analysis.avg_duration_min.toFixed(0)}m` : "—"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Avg load
              </span>
              <span className="text-2xl font-mono font-medium">
                {analysis.avg_training_load != null ? analysis.avg_training_load.toFixed(0) : "—"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-1">
                Trend
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <TrendIcon className="h-4 w-4" />
                {TREND_LABELS[analysis.training_load_trend]}
              </span>
            </div>
          </div>

          {analysis.max_hr_estimate && (
            <p className="text-xs text-muted-foreground font-mono">
              HR zones estimated from max HR ≈ {analysis.max_hr_estimate.toFixed(0)} bpm ({analysis.max_hr_source}).
              Zones characterize each session&rsquo;s avg/max HR — not time-in-zone (Garmin doesn&rsquo;t
              give us per-minute detail for these activities).
            </p>
          )}

          {analysis.sessions.length > 0 && (
            <Card title="Recent sessions">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
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
                        <tr key={s.activity_id} className="border-t border-border">
                          <td className="py-2 font-mono text-xs">{s.day}</td>
                          <td className="py-2 font-mono text-xs">
                            {s.duration_min != null ? `${s.duration_min.toFixed(0)}m` : "—"}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {s.avg_hr ?? "—"}
                            {s.avg_hr_zone ? ` (${s.avg_hr_zone})` : ""}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {s.max_hr ?? "—"}
                            {s.max_hr_zone ? ` (${s.max_hr_zone})` : ""}
                          </td>
                          <td className="py-2 font-mono text-xs">{s.training_load ?? "—"}</td>
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
  const [entries, setEntries] = useState<MentalEntry[] | null>(null);
  const [insight, setInsight] = useState<MentalInsight | null>(null);
  const [entryType, setEntryType] = useState<MentalEntryInput["entry_type"]>("check_in");
  const [mood, setMood] = useState<number>(7);
  const [energy, setEnergy] = useState<number>(7);
  const [focus, setFocus] = useState<number>(7);
  const [confidence, setConfidence] = useState<number>(7);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    api.mental.list(14).then(setEntries).catch(() => setEntries([]));
  }, []);

  const fetchInsight = useCallback(() => {
    setLoadingInsight(true);
    api.mental.insight(14).then(setInsight).catch(() => {}).finally(() => setLoadingInsight(false));
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
      setError(err instanceof Error ? err.message : "Failed to delete entry");
    }
  }

  const TrendIcon = insight?.trend === "improving" ? TrendingUp
    : insight?.trend === "declining" ? TrendingDown
    : Minus;

  const trendColor = insight?.trend === "improving" ? "text-green-500"
    : insight?.trend === "declining" ? "text-accent"
    : "text-muted-foreground";

  return (
    <section>
      {/* Section header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Brain className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground font-mono">
            Mental training
          </p>
        </div>
        <div className="h-px w-full bg-border" />
      </div>

      {error && (
        <div className="border border-accent/30 bg-accent/5 px-4 py-3 mb-6 flex items-center justify-between">
          <p className="text-accent text-xs">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-accent/60 hover:text-accent text-xs font-mono"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* ── Check-in / Editor ──────────────────────────── */}
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Entry type selector */}
            <div className="flex gap-1">
              {(["check_in", "pre_comp", "reflection"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEntryType(t)}
                  className={`
                    px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors duration-150
                    ${entryType === t
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
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Mood", mood, setMood],
                ["Energy", energy, setEnergy],
                ["Focus", focus, setFocus],
                ["Confidence", confidence, setConfidence],
              ] as [string, number, React.Dispatch<React.SetStateAction<number>>][]).map(
                ([label, value, setter]) => (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                        {label}
                      </span>
                      <span className="text-xs font-mono text-foreground">{value}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={value}
                      onChange={(e) => setter(Number(e.target.value))}
                      className="w-full h-1 bg-border appearance-none cursor-pointer accent-foreground [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-foreground"
                      aria-label={`${label} score`}
                    />
                  </div>
                )
              )}
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
              className="w-full bg-transparent border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground resize-none font-mono"
              aria-label="Mental training content"
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors duration-150"
            >
              <Send className="h-3 w-3" strokeWidth={1.5} />
              {submitting ? "Saving..." : "Log entry"}
            </button>
          </form>
        </div>

        {/* ── Recent entries ─────────────────────────────── */}
        <div className="lg:col-span-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 font-mono">
            Recent entries
          </p>
          {entries === null ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground/60">
              No entries yet. Start with a check-in.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {entries.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="border border-border p-3 group relative"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                        {ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatDate(entry.day)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-accent transition-opacity duration-150"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </div>

                  {/* Scores bar */}
                  <div className="flex gap-3 text-[10px] font-mono text-muted-foreground mb-1">
                    {entry.mood_score != null && <span>M:{entry.mood_score}</span>}
                    {entry.energy_score != null && <span>E:{entry.energy_score}</span>}
                    {entry.focus_score != null && <span>F:{entry.focus_score}</span>}
                    {entry.confidence_score != null && <span>C:{entry.confidence_score}</span>}
                  </div>

                  {entry.content && (
                    <p className="text-xs text-foreground/60 leading-relaxed line-clamp-2">
                      {entry.content}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Insight / Snapshot ─────────────────────────── */}
        <div className="lg:col-span-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 font-mono">
            Insight
          </p>
          {loadingInsight ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : insight && insight.entry_count > 0 ? (
            <div className="space-y-4">
              {/* Trend */}
              <div className="flex items-center gap-2">
                <TrendIcon className={`h-4 w-4 ${trendColor}`} strokeWidth={1.5} />
                <span className={`text-xs font-mono uppercase tracking-wide ${trendColor}`}>
                  {insight.trend}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  ({insight.entry_count} entries / {insight.period_days}d)
                </span>
              </div>

              {/* Averages */}
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["Mood", insight.avg_mood],
                  ["Energy", insight.avg_energy],
                  ["Focus", insight.avg_focus],
                  ["Confidence", insight.avg_confidence],
                ] as [string, number | null][]).map(([label, val]) => (
                  <div key={label} className="border border-border p-2">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
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
                <Markdown className="text-xs text-foreground/70">{insight.insight}</Markdown>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60">
              Log at least 3 entries to see insights.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── main ─────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState<Date>(mondayOf(new Date()));
  const [week, setWeek] = useState<TrainingSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resettingDay, setResettingDay] = useState<string | null>(null);

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  const fetchWeek = useCallback(() => {
    api.training.week(isoDate(weekStart)).then(setWeek).catch((e) => setErr(e?.message));
  }, [weekStart]);

  useEffect(() => { fetchWeek(); }, [fetchWeek]);

  async function resetOverride(day: string) {
    setResettingDay(day);
    try {
      await api.training.clearOverride(day);
      fetchWeek();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reset workout");
    }
    setResettingDay(null);
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

  const loading = week === null;
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          Weekly split
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Training
        </h1>
        <div className="h-1 w-16 bg-accent mt-6" />

        {/* Week navigation */}
        <div className="flex items-center gap-4 mt-8">
          <button
            onClick={prevWeek}
            className="h-10 w-10 inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <span className="text-sm font-mono text-muted-foreground tracking-wide">
            {formatDate(isoDate(weekStart))} — {formatDate(isoDate(weekEndDate))}
          </span>
          <button
            onClick={nextWeek}
            className="h-10 w-10 inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* ── Weekly Schedule Cards ──────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {week.map((session) => {
            const dayType = classifyDay(session);
            const isToday = session.day === today;

            return (
              <div
                key={session.day}
                className={`
                  relative border p-6 transition-all duration-150
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
                    {dayType === "fencing" && <Swords className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />}
                    {dayType === "gym" && <Dumbbell className="h-4 w-4 text-accent" strokeWidth={1.5} />}
                    {dayType === "rest" && <BedDouble className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />}
                    <span className="font-semibold text-base tracking-wide text-foreground">
                      {session.weekday}
                    </span>
                  </div>
                  <span className="text-xs text-foreground/75 font-mono tracking-wide">
                    {formatDate(session.day)}
                  </span>
                </div>

                {/* Fencing day */}
                {dayType === "fencing" && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
                      Fencing
                    </span>
                    <p className="text-base text-foreground/90 leading-relaxed">
                      Club session — conditioning + sparring (~2h)
                    </p>
                    <p className="text-xs text-foreground/70 font-mono">
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
                {dayType === "gym" && session.session && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                        Gym
                      </span>
                      <span className="text-xs text-foreground/75 capitalize font-mono">
                        {session.session.name.replace(/_/g, " ")}
                      </span>
                      {session.source === "manual" && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-accent border border-accent/40 px-1.5 py-0.5"
                          title={session.session.rationale || "Manually edited via chat"}
                        >
                          <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                          Coach edit
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5 border-t border-border pt-3">
                      {session.session.exercises.map((rx) => (
                        <div
                          key={rx.exercise}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-foreground truncate mr-3 text-sm leading-snug">
                            {rx.exercise}
                          </span>
                          <span className="font-mono text-foreground/75 text-xs whitespace-nowrap">
                            {rx.sets}x{rx.reps}
                            {rx.load_kg != null ? ` @${rx.load_kg}kg` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {session.source === "manual" && (
                      <button
                        onClick={() => resetOverride(session.day)}
                        disabled={resettingDay === session.day}
                        className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors duration-150"
                      >
                        <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                        {resettingDay === session.day ? "Resetting…" : "Reset to auto plan"}
                      </button>
                    )}
                  </div>
                )}

                {/* Phase & readiness (today only) */}
                {isToday && (
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                    <span className="text-xs font-mono text-foreground/75">
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

      {/* ── Fencing Session Analysis ───────────────────────────────── */}
      <FencingAnalysisSection />

      {/* ── Mental Training ────────────────────────────────────────── */}
      <MentalTrainingSection />
    </div>
  );
}
