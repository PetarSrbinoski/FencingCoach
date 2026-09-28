"use client";

import { Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { api, Diagnostics, MetricDiagnostic } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const KIND_LABELS: Record<string, string> = {
  sleep: "Sleep",
  sleep_score: "Sleep score",
  hrv: "HRV",
  hrv_weekly: "HRV (weekly avg)",
  body_battery: "Body battery",
  stress_daily: "Stress",
  resting_hr: "Resting HR",
  steps: "Steps",
  calories: "Calories",
  training_readiness: "Training readiness",
  training_status: "Training status",
  vo2max: "VO2 max",
  intensity_minutes: "Intensity minutes",
};

function label(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function staleMessage(m: MetricDiagnostic): string {
  if (m.last_ok_day === null) {
    return `${label(m.kind)} has no usable reading yet`;
  }
  const days = m.days_since_ok ?? 0;
  if (days === 0) return `${label(m.kind)} is up to date`;
  return `${label(m.kind)} has no new usable reading in ${days} day${days === 1 ? "" : "s"}`;
}

/** Surfaces Garmin extraction gaps instead of letting them silently degrade
 * readiness/targets/coach context. See GET /diagnostics. */
export function DataCoveragePanel({
  windowDays = 30,
  revision = 0,
}: {
  windowDays?: number;
  revision?: number;
}) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setErr(null);
    api.diagnostics
      .get(windowDays)
      .then(setData)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : String(e)),
      );
  }, [windowDays, revision, retry]);

  if (err) {
    return (
      <Card title="Data coverage">
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
        <Button
          onClick={() => setRetry((value) => value + 1)}
          variant="outline"
        >
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card title="Data coverage">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      </Card>
    );
  }

  const stale = data.metrics.filter((m) => m.stale);
  const healthy = data.metrics.filter((m) => !m.stale);

  return (
    <Card title="Data coverage" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Available readings over the last {data.window_days} days.
      </p>

      {stale.length > 0 && (
        <details>
          <summary className="font-medium text-warning">
            {stale.length} metrics need attention
          </summary>
          <ul className="space-y-2">
            {stale.map((m) => (
              <li
                key={m.kind}
                className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 px-3 py-2"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-warning">
                    {staleMessage(m)}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">
                    coverage {m.coverage_days}/{m.window_days}d
                    {m.last_ok_day && ` · last ok ${m.last_ok_day}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {healthy.length > 0 && (
        <details className="group">
          <summary className="text-sm text-muted-foreground cursor-pointer select-none flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            {healthy.length} metric{healthy.length === 1 ? "" : "s"} up to date
          </summary>
          <ul className="mt-2 space-y-1">
            {healthy.map((m) => (
              <li
                key={m.kind}
                className={cn(
                  "flex items-center justify-between text-sm py-1 border-b border-border last:border-0",
                )}
              >
                <span className="text-muted-foreground">{label(m.kind)}</span>
                <span className="font-mono text-foreground/80">
                  {m.last_ok_value ?? "—"} · {m.coverage_days}/{m.window_days}d
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Slim, dashboard-friendly variant: renders nothing when all metrics are
 * healthy, otherwise a compact warning list. */
export function StaleDataBanner({
  windowDays = 30,
  revision = 0,
}: {
  windowDays?: number;
  revision?: number;
}) {
  const [data, setData] = useState<Diagnostics | null>(null);

  useEffect(() => {
    api.diagnostics
      .get(windowDays)
      .then(setData)
      .catch(() => {});
  }, [windowDays, revision]);

  // Only surface metrics that were working and went stale (actionable sync
  // gap) — metrics that never parsed at all are unsupported-metric noise.
  const stale =
    data?.metrics.filter((m) => m.stale && m.last_ok_day !== null) ?? [];
  if (stale.length === 0) return null;

  return (
    <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <summary className="text-sm text-warning">
        {stale.length} recovery metrics need a refresh
      </summary>
      <div className="space-y-2">
        {stale.map((m) => (
          <p
            key={m.kind}
            className="flex items-center gap-2 text-sm text-warning"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {staleMessage(m)}
          </p>
        ))}
        <Button size="sm" variant="outline" asChild>
          <a href="/garmin">Review Garmin data</a>
        </Button>
      </div>
    </details>
  );
}
