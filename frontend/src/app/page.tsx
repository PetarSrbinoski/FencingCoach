"use client";

import { useEffect, useState } from "react";
import {
  api,
  Activity,
  Brief,
  MetricSeries,
  NutritionDayTotals,
  Phase,
  Readiness,
  Targets,
} from "@/lib/api";
import { Sparkline, Gauge } from "@/components/charts";
import { Card, BandPill, StatRow } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Heart,
  Moon,
  Zap,
  Activity as ActivityIcon,
  Target,
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  Footprints,
  Flame,
  ArrowRight,
} from "lucide-react";

export default function Home() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [hrv, setHrv] = useState<MetricSeries | null>(null);
  const [sleep, setSleep] = useState<MetricSeries | null>(null);
  const [sleepScore, setSleepScore] = useState<MetricSeries | null>(null);
  const [rhr, setRhr] = useState<MetricSeries | null>(null);
  const [bb, setBb] = useState<MetricSeries | null>(null);
  const [readinessSeries, setReadinessSeries] = useState<MetricSeries | null>(null);
  const [steps, setSteps] = useState<MetricSeries | null>(null);
  const [calories, setCalories] = useState<MetricSeries | null>(null);
  const [nutritionToday, setNutritionToday] = useState<NutritionDayTotals | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function loadAll() {
    setErr(null);
    api.readiness.today().then(setReadiness).catch((e) => setErr(String(e)));
    api.brief.today().then(setBrief).catch(() => {});
    api.phase.today().then(setPhase).catch(() => {});
    api.targets.today().then(setTargets).catch(() => {});
    api.metrics.series("hrv", 14).then(setHrv).catch(() => {});
    api.metrics.series("sleep", 14).then(setSleep).catch(() => {});
    api.metrics.series("sleep_score", 14).then(setSleepScore).catch(() => {});
    api.metrics.series("resting_hr", 14).then(setRhr).catch(() => {});
    api.metrics.series("body_battery", 14).then(setBb).catch(() => {});
    api.metrics.series("training_readiness", 14).then(setReadinessSeries).catch(() => {});
    api.metrics.series("steps", 14).then(setSteps).catch(() => {});
    api.metrics.series("calories", 14).then(setCalories).catch(() => {});
    api.activities.recent(3).then(setActivities).catch(() => {});
    const today = new Date().toISOString().slice(0, 10);
    api.nutrition.totals(today).then(setNutritionToday).catch(() => {});
  }

  useEffect(loadAll, []);

  async function generateBrief() {
    setGenerating(true);
    setErr(null);
    try {
      const b = await api.brief.generate();
      setBrief(b);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Hero header ───────────────────────────────────────────── */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Today
        </h1>
        {phase && (
          <p className="mt-4 text-sm text-muted-foreground font-mono">
            {phase.name}
            {phase.next_event_name && phase.days_to_event != null && (
              <span className="text-accent ml-3">
                {phase.next_event_name} — T-{phase.days_to_event}d
              </span>
            )}
          </p>
        )}
        {/* Accent bar */}
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* ── Readiness gauge section ───────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12 lg:gap-16">
        {/* Gauge */}
        <div className="flex flex-col items-center lg:items-start gap-4">
          {readiness ? (
            <>
              <Gauge score={readiness.score} size={160} />
              <BandPill band={readiness.band} />
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 w-full">
                {Object.entries(readiness.components).map(([k, c]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono text-xs font-medium">{Math.round(c.score)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6">
              <Skeleton className="h-40 w-40" />
              <Skeleton className="h-5 w-20" />
            </div>
          )}
        </div>

        {/* 14-day sparkline metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          <MetricCard title="HRV" icon={<ActivityIcon className="h-4 w-4" />} series={hrv} unit="ms" />
          <MetricCard title="Sleep" icon={<Moon className="h-4 w-4" />} series={sleep} unit="h" />
          <MetricCard title="Resting HR" icon={<Heart className="h-4 w-4" />} series={rhr} unit="bpm" lowerIsBetter />
          <MetricCard title="Body Battery" icon={<Zap className="h-4 w-4" />} series={bb} unit="" />
          <MetricCard title="Sleep Score" icon={<Star className="h-4 w-4" />} series={sleepScore} unit="" />
          <MetricCard title="Readiness" icon={<Target className="h-4 w-4" />} series={readinessSeries} unit="" />
          <MetricCard title="Steps" icon={<Footprints className="h-4 w-4" />} series={steps} unit="" />
          <MetricCard title="Calories" icon={<Flame className="h-4 w-4" />} series={calories} unit="kcal" />
        </div>
      </section>

      {/* ── Brief + intake ──────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-12 border-t border-border pt-16">
        {/* Coach brief */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Coach Brief</h2>
            <Button
              variant={brief ? "ghost" : "default"}
              size="sm"
              onClick={generateBrief}
              disabled={generating}
            >
              {generating ? "Generating..." : brief ? "Regenerate" : "Generate"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {brief ? (
            <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/90 max-w-2xl">
              {brief.summary}
            </div>
          ) : (
            <div className="py-12 text-center border border-border">
              <p className="text-muted-foreground text-sm uppercase tracking-wider">No brief for today</p>
              <p className="text-muted-foreground/60 text-xs mt-2 font-mono">Click generate to create one</p>
            </div>
          )}
          {brief?.payload?.model && (
            <p className="text-[11px] text-muted-foreground/40 mt-6 font-mono">
              model: {brief.payload.model}
            </p>
          )}
        </div>

        {/* Today's intake */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">Today&apos;s Intake</h2>
          {nutritionToday ? (
            <div className="space-y-0">
              <StatRow label="Calories" value={`${nutritionToday.kcal.toFixed(0)} kcal`} hint={targets ? `/ ${targets.kcal.toFixed(0)}` : undefined} />
              <StatRow label="Protein" value={`${nutritionToday.protein_g.toFixed(0)} g`} hint={targets ? `/ ${targets.protein_g.toFixed(0)}` : undefined} />
              <StatRow label="Carbs" value={`${nutritionToday.carbs_g.toFixed(0)} g`} hint={targets ? `/ ${targets.carbs_g.toFixed(0)}` : undefined} />
              <StatRow label="Fat" value={`${nutritionToday.fat_g.toFixed(0)} g`} hint={targets ? `/ ${targets.fat_g.toFixed(0)}` : undefined} />
              <StatRow label="Entries" value={nutritionToday.entry_count} />
              {targets && (
                <p className="text-[11px] text-muted-foreground mt-4 font-mono">
                  {targets.day_type} day · {targets.phase} phase
                </p>
              )}
              <a href="/nutrition" className="inline-flex items-center gap-2 mt-4 text-xs font-semibold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors duration-150">
                Log a meal <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Recent activities ─────────────────────────────────────── */}
      {activities.length > 0 && (
        <section className="border-t border-border pt-16">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-8">Recent Activities</h2>
          <div className="divide-y divide-border">
            {activities.slice(0, 5).map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-4 gap-2">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground border border-border px-2 py-0.5 shrink-0">
                    {a.activity_type ?? "activity"}
                  </span>
                  <span className="truncate text-sm font-medium">{a.name ?? "Untitled"}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 font-mono pl-0 sm:pl-4">
                  {a.duration_s != null && <span>{Math.round(a.duration_s / 60)}m</span>}
                  {a.calories != null && <span>{a.calories} kcal</span>}
                  {a.avg_hr != null && <span>{a.avg_hr} bpm</span>}
                  <span className="text-muted-foreground/50">
                    {new Date(a.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function seriesStats(series: MetricSeries | null) {
  if (!series) return null;
  const vals = series.points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const recent = vals.slice(-3);
  const earlier = vals.slice(0, 3);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const trend = recentAvg > earlierAvg * 1.03 ? "up" : recentAvg < earlierAvg * 0.97 ? "down" : "flat";
  return { avg, min, max, trend };
}

function MetricCard({ title, icon, series, unit, lowerIsBetter = false }: {
  title: string; icon: React.ReactNode; series: MetricSeries | null;
  unit: string; lowerIsBetter?: boolean;
}) {
  const last = series?.points.filter((p) => p.value !== null).slice(-1)[0];
  const displayValue = last?.value;
  const stats = seriesStats(series);

  const TrendIcon = stats?.trend === "up" ? TrendingUp : stats?.trend === "down" ? TrendingDown : Minus;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        </div>
        {stats && <TrendIcon className="h-3 w-3 text-muted-foreground/50" strokeWidth={1.5} />}
      </div>
      {series ? (
        <>
          <Sparkline points={series.points} color="hsl(var(--accent))" unit={unit} height={44} />
          <div className="flex items-baseline justify-between pt-2 border-t border-border">
            <span className="text-lg font-mono font-medium tracking-tight">
              {displayValue != null ? displayValue.toFixed(displayValue >= 100 ? 0 : 1) : "\u2014"}
              {displayValue != null && unit && (
                <span className="text-[10px] text-muted-foreground ml-1">{unit}</span>
              )}
            </span>
            {stats && (
              <div className="text-[10px] text-muted-foreground/50 space-x-1 font-mono">
                <span>{stats.min.toFixed(stats.min >= 100 ? 0 : 1)}</span>
                <span>/</span>
                <span>{stats.avg.toFixed(stats.avg >= 100 ? 0 : 1)}</span>
                <span>/</span>
                <span>{stats.max.toFixed(stats.max >= 100 ? 0 : 1)}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-5 w-16" />
        </div>
      )}
    </div>
  );
}
