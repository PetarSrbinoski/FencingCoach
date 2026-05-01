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
import { Badge } from "@/components/ui/badge";
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

  const ri = readiness?.inputs;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── Page header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b-4 border-foreground pb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Today</h1>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1.5 font-mono">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
        {phase && (
          <Badge variant="outline" className="gap-1.5 font-bold h-7 sm:h-8 self-start sm:self-auto text-xs">
            <span>{phase.name}</span>
            {phase.next_event_name && phase.days_to_event != null && (
              <span className="text-muted-foreground hidden sm:inline">
                {"\u2192"} {phase.next_event_name} (T-{phase.days_to_event}d)
              </span>
            )}
          </Badge>
        )}
      </div>

      {err && (
        <div className="border-2 border-bauhaus-red bg-bauhaus-red/10 px-4 py-3">
          <p className="text-bauhaus-red text-sm font-bold">{err}</p>
        </div>
      )}

      {/* ── Top: readiness gauge + key vitals ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 md:gap-6">
        {/* Readiness gauge */}
        <Card>
          {readiness ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <Gauge score={readiness.score} size={140} />
              <BandPill band={readiness.band} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2 text-xs w-full">
                {Object.entries(readiness.components).map(([k, c]) => (
                  <div key={k} className="flex items-center justify-between gap-1">
                    <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider truncate">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono font-black text-[12px]">{Math.round(c.score)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6">
              <Skeleton className="h-36 w-36" />
              <Skeleton className="h-5 w-20" />
            </div>
          )}
        </Card>

        {/* Key vitals grid — 2 cols on mobile, 3 on sm, 6 on xl */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <VitalCard label="HRV" value={ri?.hrv_today} unit="ms" icon={<ActivityIcon className="h-3.5 w-3.5" />} series={hrv} />
          <VitalCard label="Sleep" value={ri?.sleep_h} unit="h" format={(v) => v.toFixed(1)} icon={<Moon className="h-3.5 w-3.5" />} series={sleep} />
          <VitalCard label="Sleep Score" value={lastValue(sleepScore)} unit="" icon={<Star className="h-3.5 w-3.5" />} series={sleepScore} />
          <VitalCard label="RHR" value={ri?.rhr} unit="bpm" icon={<Heart className="h-3.5 w-3.5" />} series={rhr} lowerIsBetter />
          <VitalCard label="Body Battery" value={ri?.body_battery_max} unit="" icon={<Zap className="h-3.5 w-3.5" />} series={bb} />
          <VitalCard label="Readiness" value={lastValue(readinessSeries)} unit="" icon={<Target className="h-3.5 w-3.5" />} series={readinessSeries} />
        </div>
      </div>

      {/* ── 14-day sparkline metrics ──────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <MetricCard title="HRV" icon={<ActivityIcon className="h-4 w-4" />} series={hrv} unit="ms" color="var(--bauhaus-blue)" />
        <MetricCard title="Sleep" icon={<Moon className="h-4 w-4" />} series={sleep} unit="h" color="var(--bauhaus-blue)" />
        <MetricCard title="Resting HR" icon={<Heart className="h-4 w-4" />} series={rhr} unit="bpm" color="var(--bauhaus-red)" lowerIsBetter />
        <MetricCard title="Body Battery" icon={<Zap className="h-4 w-4" />} series={bb} unit="" color="hsl(var(--foreground))" />
        <MetricCard title="Sleep Score" icon={<Star className="h-4 w-4" />} series={sleepScore} unit="" color="var(--bauhaus-blue)" />
        <MetricCard title="Training Readiness" icon={<Target className="h-4 w-4" />} series={readinessSeries} unit="" color="var(--bauhaus-yellow)" />
        <MetricCard title="Steps" icon={<Footprints className="h-4 w-4" />} series={steps} unit="" color="hsl(var(--foreground))" />
        <MetricCard title="Calories" icon={<Flame className="h-4 w-4" />} series={calories} unit="kcal" color="var(--bauhaus-red)" />
      </div>

      {/* ── Brief + intake + activities ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        {/* Coach brief */}
        <Card
          title="Coach Brief"
          className="lg:col-span-2"
          action={
            <Button
              size="sm"
              variant={brief ? "outline" : "default"}
              onClick={generateBrief}
              disabled={generating}
            >
              {generating ? "GENERATING..." : brief ? "REGENERATE" : "GENERATE"}
            </Button>
          }
        >
          {brief ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed font-medium">
              {brief.summary}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 bg-bauhaus-yellow/20">
                <Star className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No brief for today yet</p>
              <p className="text-muted-foreground text-xs mt-1 font-mono">Click Generate to create one</p>
            </div>
          )}
          {brief?.payload?.model && (
            <p className="text-[11px] text-muted-foreground/50 mt-4 font-mono border-t-2 border-foreground/10 pt-2">
              model: {brief.payload.model}
            </p>
          )}
        </Card>

        {/* Today's intake */}
        <Card title="Today's Intake">
          {nutritionToday ? (
            <>
              <StatRow label="Calories" value={`${nutritionToday.kcal.toFixed(0)} kcal`} hint={targets ? `/ ${targets.kcal.toFixed(0)}` : undefined} />
              <StatRow label="Protein" value={`${nutritionToday.protein_g.toFixed(0)} g`} hint={targets ? `/ ${targets.protein_g.toFixed(0)}` : undefined} />
              <StatRow label="Carbs" value={`${nutritionToday.carbs_g.toFixed(0)} g`} hint={targets ? `/ ${targets.carbs_g.toFixed(0)}` : undefined} />
              <StatRow label="Fat" value={`${nutritionToday.fat_g.toFixed(0)} g`} hint={targets ? `/ ${targets.fat_g.toFixed(0)}` : undefined} />
              <StatRow label="Entries" value={nutritionToday.entry_count} />
              {targets && (
                <p className="text-[11px] text-muted-foreground mt-3 font-mono">
                  {targets.day_type} day {"\u00b7"} {targets.phase} phase
                </p>
              )}
              <a href="/nutrition" className="inline-flex items-center gap-1 mt-3 text-xs font-bold uppercase tracking-wider hover:underline">
                Log a meal {"\u2192"}
              </a>
            </>
          ) : (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Recent activities ─────────────────────────────────────── */}
      {activities.length > 0 && (
        <Card title="Recent Activities">
          <div className="divide-y-2 divide-foreground/10">
            {activities.slice(0, 5).map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 gap-2 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                    {a.activity_type ?? "activity"}
                  </Badge>
                  <span className="truncate font-medium">{a.name ?? "Untitled"}</span>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 text-xs text-muted-foreground shrink-0 font-mono font-bold pl-0 sm:pl-4">
                  {a.duration_s != null && <span>{Math.round(a.duration_s / 60)}m</span>}
                  {a.calories != null && <span>{a.calories} kcal</span>}
                  {a.avg_hr != null && <span>{a.avg_hr} bpm</span>}
                  <span className="text-muted-foreground/60">
                    {new Date(a.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function lastValue(series: MetricSeries | null): number | null {
  if (!series) return null;
  const pts = series.points.filter((p) => p.value !== null);
  return pts.length > 0 ? pts[pts.length - 1].value : null;
}

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

function VitalCard({ label, value, unit, icon, series, format, lowerIsBetter = false }: {
  label: string; value: number | null | undefined; unit: string; icon: React.ReactNode;
  series: MetricSeries | null; format?: (v: number) => string; lowerIsBetter?: boolean;
}) {
  const stats = seriesStats(series);
  const displayValue = value != null ? (format ? format(value) : Math.round(value).toString()) : "\u2014";

  return (
    <Card className="!p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg sm:text-xl font-mono font-black tracking-tight">{displayValue}</span>
        {unit && value != null && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
      {stats && (
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/70">
          <span className="font-mono font-bold">avg {stats.avg.toFixed(stats.avg >= 100 ? 0 : 1)}</span>
        </div>
      )}
    </Card>
  );
}

function MetricCard({ title, icon, series, unit, color, lowerIsBetter = false }: {
  title: string; icon: React.ReactNode; series: MetricSeries | null;
  unit: string; color: string; lowerIsBetter?: boolean;
}) {
  const last = series?.points.filter((p) => p.value !== null).slice(-1)[0];
  const displayValue = last?.value;
  const stats = seriesStats(series);

  const TrendIcon = stats?.trend === "up" ? TrendingUp : stats?.trend === "down" ? TrendingDown : Minus;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
        </div>
        {stats && <TrendIcon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      {series ? (
        <>
          <Sparkline points={series.points} color={color} unit={unit} height={44} />
          <div className="flex items-baseline justify-between mt-2 border-t-2 border-foreground/10 pt-2">
            <span className="text-base sm:text-lg font-mono font-black tracking-tight">
              {displayValue != null ? displayValue.toFixed(displayValue >= 100 ? 0 : 1) : "\u2014"}
              {displayValue != null && unit && (
                <span className="text-[10px] font-medium text-muted-foreground ml-0.5">{unit}</span>
              )}
            </span>
            {stats && (
              <div className="text-[10px] text-muted-foreground/60 space-x-1 font-mono font-bold">
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
    </Card>
  );
}
