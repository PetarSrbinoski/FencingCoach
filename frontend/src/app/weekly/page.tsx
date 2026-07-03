"use client";

import { useEffect, useState } from "react";
import { Activity, MetricSeries, NutritionLog, api } from "@/lib/api";
import { BarChartComponent, Sparkline } from "@/components/charts";
import { Card, StatRow } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity as ActivityIcon, Heart, Moon, Star, Target, Flame, TrendingUp, Utensils } from "lucide-react";

export default function WeeklyPage() {
  const [hrv, setHrv] = useState<MetricSeries | null>(null);
  const [sleep, setSleep] = useState<MetricSeries | null>(null);
  const [sleepScore, setSleepScore] = useState<MetricSeries | null>(null);
  const [rhr, setRhr] = useState<MetricSeries | null>(null);
  const [readinessSeries, setReadinessSeries] = useState<MetricSeries | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.metrics.series("hrv", 28).then(setHrv),
      api.metrics.series("sleep", 28).then(setSleep),
      api.metrics.series("sleep_score", 28).then(setSleepScore),
      api.metrics.series("resting_hr", 28).then(setRhr),
      api.metrics.series("training_readiness", 28).then(setReadinessSeries),
      api.activities.recent(28).then(setActivities),
      api.nutrition.list(28).then(setLogs),
    ]).finally(() => setLoading(false));
  }, []);

  // ── 7-day load by day ─────────────────────────────────────────────
  const last7Days: { label: string; value: number }[] = (() => {
    const out: { label: string; value: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const sum = activities
        .filter((a) => a.start_time.slice(0, 10) === iso)
        .reduce((s, a) => s + (a.training_load ?? 0), 0);
      out.push({ label: iso.slice(5), value: sum });
    }
    return out;
  })();

  // ── 7-day kcal compliance ─────────────────────────────────────────
  const last7Kcal: { label: string; value: number }[] = (() => {
    const out: { label: string; value: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const sum = logs
        .filter((l) => l.day === iso)
        .reduce((s, l) => s + (l.kcal ?? 0), 0);
      out.push({ label: iso.slice(5), value: sum });
    }
    return out;
  })();

  const totalLoad7 = last7Days.reduce((s, d) => s + d.value, 0);
  const sessions7 = activities.filter((a) => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    return new Date(a.start_time) >= since;
  }).length;

  const avgKcal = (last7Kcal.reduce((s, d) => s + d.value, 0) / 7).toFixed(0);

  // ── helpers ───────────────────────────────────────────────────────
  function latestValue(series: MetricSeries | null): string {
    if (!series) return "—";
    const pts = series.points.filter((p) => p.value != null);
    if (pts.length === 0) return "—";
    const v = pts[pts.length - 1].value!;
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  }

  function avgValue(series: MetricSeries | null): string {
    if (!series) return "—";
    const vals = series.points.filter((p) => p.value != null).map((p) => p.value!);
    if (vals.length === 0) return "—";
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Number.isInteger(avg) ? avg.toString() : avg.toFixed(1);
  }

  const sparklines: {
    title: string;
    series: MetricSeries | null;
    icon: React.ReactNode;
    unit?: string;
  }[] = [
    { title: "HRV", series: hrv, icon: <Heart className="h-4 w-4" />, unit: "ms" },
    { title: "Sleep", series: sleep, icon: <Moon className="h-4 w-4" />, unit: "hrs" },
    { title: "Sleep Score", series: sleepScore, icon: <Star className="h-4 w-4" /> },
    { title: "Resting HR", series: rhr, icon: <Heart className="h-4 w-4" />, unit: "bpm" },
    { title: "Training Readiness", series: readinessSeries, icon: <Target className="h-4 w-4" /> },
    {
      title: "Weekly Summary",
      series: null,
      icon: <Flame className="h-4 w-4" />,
    },
  ];

  const activityBadgeColor = (type: string | null): "default" | "secondary" | "outline" => {
    if (!type) return "outline";
    const t = type.toLowerCase();
    if (t.includes("fencing") || t.includes("bout")) return "default";
    if (t.includes("strength") || t.includes("gym")) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-16 md:space-y-20">
      {/* Header */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          28-day trends
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          This Week
        </h1>
        <p className="mt-4 text-sm text-muted-foreground font-mono">
          Training load, recovery, and weekly performance overview
        </p>
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {/* ── Bar charts: Training load & Calories ─────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Training load" icon={<TrendingUp className="h-4 w-4" />}>
          {loading ? (
            <Skeleton className="h-[120px] w-full" />
          ) : (
            <>
              <BarChartComponent values={last7Days} height={120} unit=" load" />
              <div className="mt-4 pt-3 border-t border-border text-sm space-y-0">
                <StatRow label="Total load (7d)" value={totalLoad7.toFixed(0)} />
                <StatRow label="Sessions (7d)" value={sessions7} />
              </div>
            </>
          )}
        </Card>

        <Card title="Calories logged" icon={<Utensils className="h-4 w-4" />}>
          {loading ? (
            <Skeleton className="h-[120px] w-full" />
          ) : (
            <>
              <BarChartComponent values={last7Kcal} height={120} unit=" kcal" />
              <div className="mt-4 pt-3 border-t border-border text-sm space-y-0">
                <StatRow label="Avg/day" value={`${avgKcal} kcal`} />
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── 28-day sparkline grid (2×3) ──────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">28-day trends</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {sparklines.map((s) => (
            <Card key={s.title}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-muted-foreground">{s.icon}</span>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.title}</span>
              </div>
              {loading ? (
                <Skeleton className="h-[70px] w-full" />
              ) : s.title === "Weekly Summary" ? (
                <div className="text-sm space-y-0 pt-1">
                  <StatRow label="Sessions (7d)" value={sessions7} />
                  <StatRow label="Total load (7d)" value={totalLoad7.toFixed(0)} />
                  <StatRow label="Avg kcal/day" value={`${avgKcal}`} />
                  <StatRow label="Latest HRV" value={latestValue(hrv)} />
                  <StatRow label="Avg readiness" value={avgValue(readinessSeries)} />
                </div>
              ) : (
                <>
                  <Sparkline points={s.series?.points ?? []} color="hsl(var(--accent))" height={70} unit={s.unit} />
                  <div className="mt-3 flex items-baseline justify-between text-xs text-muted-foreground font-mono pt-2 border-t border-border">
                    <span>Latest: <span className="text-foreground font-medium">{latestValue(s.series)}{s.unit ? ` ${s.unit}` : ""}</span></span>
                    <span>28d avg: <span className="text-foreground font-medium">{avgValue(s.series)}{s.unit ? ` ${s.unit}` : ""}</span></span>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* ── Activities table ─────────────────────────────────────────── */}
      <Card title="Activities" icon={<ActivityIcon className="h-4 w-4" />} action={<span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Last 28 days</span>}>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
              <ActivityIcon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">No activities synced yet</p>
            <p className="text-muted-foreground/60 text-xs mt-1 font-mono">Connect Garmin to start tracking</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">HR avg/max</TableHead>
                <TableHead className="text-right">Load</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.slice(0, 30).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {new Date(a.start_time).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={activityBadgeColor(a.activity_type)}>
                      <ActivityIcon className="mr-1 h-3 w-3" />
                      {a.activity_type ?? "Unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {a.duration_s ? `${Math.round(a.duration_s / 60)}m` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {a.avg_hr ? `${a.avg_hr}/${a.max_hr ?? "—"}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {a.training_load?.toFixed(0) ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
