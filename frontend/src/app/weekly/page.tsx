"use client";

import { BarChartComponent, Sparkline } from "@/components/charts";
import { ErrorNotice, ViewTabs, useView } from "@/components/mobile-ui";
import { Card, StatRow } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, MetricSeries, NutritionLog, api } from "@/lib/api";
import { Flame, Heart, Moon, Star, Target } from "lucide-react";
import { useEffect, useState } from "react";

export default function WeeklyPage() {
  const [view, setView] = useView(
    ["recovery", "training", "nutrition"] as const,
    "recovery",
  );
  const [metric, setMetric] = useState("Training Readiness");
  const [errors, setErrors] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [hrv, setHrv] = useState<MetricSeries | null>(null);
  const [sleep, setSleep] = useState<MetricSeries | null>(null);
  const [sleepScore, setSleepScore] = useState<MetricSeries | null>(null);
  const [rhr, setRhr] = useState<MetricSeries | null>(null);
  const [readinessSeries, setReadinessSeries] = useState<MetricSeries | null>(
    null,
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setErrors([]);
    Promise.allSettled([
      api.metrics.series("hrv", 28).then(setHrv),
      api.metrics.series("sleep", 28).then(setSleep),
      api.metrics.series("sleep_score", 28).then(setSleepScore),
      api.metrics.series("resting_hr", 28).then(setRhr),
      api.metrics.series("training_readiness", 28).then(setReadinessSeries),
      api.activities.recent(28).then(setActivities),
      api.nutrition.list(28).then(setLogs),
    ])
      .then((results) =>
        setErrors(
          results.flatMap((result, index) =>
            result.status === "rejected"
              ? [
                  `Could not load ${["HRV", "sleep", "sleep score", "resting heart rate", "readiness", "activities", "nutrition"][index]}.`,
                ]
              : [],
          ),
        ),
      )
      .finally(() => setLoading(false));
  }, [reload]);

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
    const vals = series.points
      .filter((p) => p.value != null)
      .map((p) => p.value!);
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
    {
      title: "HRV",
      series: hrv,
      icon: <Heart className="h-4 w-4" />,
      unit: "ms",
    },
    {
      title: "Sleep",
      series: sleep,
      icon: <Moon className="h-4 w-4" />,
      unit: "hrs",
    },
    {
      title: "Sleep Score",
      series: sleepScore,
      icon: <Star className="h-4 w-4" />,
    },
    {
      title: "Resting HR",
      series: rhr,
      icon: <Heart className="h-4 w-4" />,
      unit: "bpm",
    },
    {
      title: "Training Readiness",
      series: readinessSeries,
      icon: <Target className="h-4 w-4" />,
    },
    {
      title: "Weekly Summary",
      series: null,
      icon: <Flame className="h-4 w-4" />,
    },
  ];

  const activityBadgeColor = (
    type: string | null,
  ): "default" | "secondary" | "outline" => {
    if (!type) return "outline";
    const t = type.toLowerCase();
    if (t.includes("fencing") || t.includes("bout")) return "default";
    if (t.includes("strength") || t.includes("gym")) return "secondary";
    return "outline";
  };

  const selected =
    sparklines.find((item) => item.title === metric) ?? sparklines[0];
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">Training & recovery</p>
        <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
      </header>
      {errors.length > 0 && (
        <ErrorNotice
          message={`${errors.join(" ")} Some summaries may be incomplete.`}
          retry={() => setReload((value) => value + 1)}
        />
      )}
      <Card title="Weekly summary">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Sessions · 7 days
                </p>
                <p className="text-2xl font-semibold">
                  {errors.some((error) => error.includes("activities"))
                    ? "Unavailable"
                    : sessions7}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Training load · 7 days
                </p>
                <p className="text-2xl font-semibold">
                  {errors.some((error) => error.includes("activities"))
                    ? "Unavailable"
                    : totalLoad7.toFixed(0)}
                </p>
              </div>
            </div>
            <details className="mt-3">
              <summary className="text-sm">All weekly statistics</summary>
              <StatRow
                label="Average logged calories"
                value={
                  errors.some((error) => error.includes("nutrition"))
                    ? "Unavailable"
                    : `${avgKcal} kcal/day`
                }
              />
              <StatRow label="Latest HRV" value={latestValue(hrv)} />
              <StatRow
                label="Average readiness · 28 days"
                value={avgValue(readinessSeries)}
              />
            </details>
          </>
        )}
      </Card>
      <ViewTabs
        label="Trend views"
        value={view}
        onChange={setView}
        items={[
          { value: "recovery", label: "Recovery" },
          { value: "training", label: "Training" },
          { value: "nutrition", label: "Nutrition" },
        ]}
      />
      {view === "recovery" && (
        <Card title="Recovery · 28 days">
          <label className="block text-sm font-medium mb-4">
            Metric
            <select
              className="mt-2 block min-h-12 w-full rounded-xl border border-border bg-input px-3 text-base"
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
            >
              {sparklines
                .filter((item) => item.title !== "Weekly Summary")
                .map((item) => (
                  <option key={item.title}>{item.title}</option>
                ))}
            </select>
          </label>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <Sparkline
                points={selected.series?.points ?? []}
                height={160}
                color="hsl(var(--accent))"
                unit={selected.unit}
              />
              <div className="mt-3 flex flex-wrap justify-between gap-3 text-sm">
                <p>
                  Latest:{" "}
                  <strong>
                    {latestValue(selected.series)} {selected.unit}
                  </strong>
                </p>
                <p>
                  28-day average:{" "}
                  <strong>
                    {avgValue(selected.series)} {selected.unit}
                  </strong>
                </p>
              </div>
            </>
          )}
        </Card>
      )}
      {view === "training" && (
        <>
          <Card title="Training load · 7 days">
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : errors.some((error) => error.includes("activities")) ? (
              <p className="text-sm">Training load unavailable. Retry above.</p>
            ) : (
              <BarChartComponent values={last7Days} height={180} unit="load" />
            )}
          </Card>
          <Card title="Activities · last 28 days">
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : activities.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {errors.some((error) => error.includes("activities"))
                    ? "Activities could not be loaded."
                    : "No activities synced yet."}
                </p>
                <Button variant="outline" className="mt-3" asChild>
                  <a href="/garmin">Open Garmin</a>
                </Button>
              </>
            ) : (
              <>
                <div className="divide-y divide-border lg:hidden">
                  {activities.slice(0, 30).map((activity) => (
                    <details key={activity.id}>
                      <summary className="text-sm">
                        <span className="font-medium">
                          {activity.name ||
                            activity.activity_type ||
                            "Activity"}
                        </span>
                        <span className="block text-muted-foreground">
                          {new Date(activity.start_time).toLocaleDateString()} ·{" "}
                          {activity.duration_s
                            ? `${Math.round(activity.duration_s / 60)} min`
                            : "Duration unknown"}
                        </span>
                      </summary>
                      <div className="pb-3">
                        <StatRow
                          label="When"
                          value={new Date(activity.start_time).toLocaleString()}
                        />
                        <StatRow
                          label="Type"
                          value={activity.activity_type ?? "Unknown"}
                        />
                        <StatRow
                          label="Heart rate · avg/max"
                          value={`${activity.avg_hr ?? "—"}/${activity.max_hr ?? "—"} bpm`}
                        />
                        <StatRow
                          label="Load"
                          value={activity.training_load?.toFixed(0) ?? "—"}
                        />
                      </div>
                    </details>
                  ))}
                </div>
                <div className="hidden lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>HR avg/max</TableHead>
                        <TableHead>Load</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activities.slice(0, 30).map((activity) => (
                        <TableRow key={activity.id}>
                          <TableCell>
                            {new Date(activity.start_time).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {activity.activity_type ?? "Unknown"}
                          </TableCell>
                          <TableCell>
                            {activity.duration_s
                              ? `${Math.round(activity.duration_s / 60)}m`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {activity.avg_hr ?? "—"}/{activity.max_hr ?? "—"}
                          </TableCell>
                          <TableCell>
                            {activity.training_load?.toFixed(0) ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </Card>
        </>
      )}
      {view === "nutrition" && (
        <Card title="Calories logged · 7 days">
          <p className="mb-4 text-sm text-muted-foreground">
            Recorded intake only. An incomplete diary can understate what you
            ate.
          </p>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : errors.some((error) => error.includes("nutrition")) ? (
            <p className="text-sm">Recorded intake unavailable. Retry above.</p>
          ) : (
            <BarChartComponent values={last7Kcal} height={180} unit="kcal" />
          )}
        </Card>
      )}
    </div>
  );
}
