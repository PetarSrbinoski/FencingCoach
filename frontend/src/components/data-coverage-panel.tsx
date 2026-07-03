"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { api, Diagnostics, MetricDiagnostic } from "@/lib/api";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

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
    return `${label(m.kind)} has never parsed successfully`;
  }
  const days = m.days_since_ok ?? 0;
  if (days === 0) return `${label(m.kind)} is up to date`;
  return `${label(m.kind)} hasn't parsed in ${days} day${days === 1 ? "" : "s"}`;
}

/** Surfaces Garmin extraction gaps instead of letting them silently degrade
 * readiness/targets/coach context. See GET /diagnostics. */
export function DataCoveragePanel({ windowDays = 30 }: { windowDays?: number }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.diagnostics
      .get(windowDays)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [windowDays]);

  if (err) {
    return (
      <Card title="Data coverage">
        <p className="text-sm text-accent">{err}</p>
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
      <p className="text-xs text-muted-foreground">
        Extraction coverage over the last {data.window_days} days.
      </p>

      {stale.length > 0 && (
        <ul className="space-y-2">
          {stale.map((m) => (
            <li
              key={m.kind}
              className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 px-3 py-2"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-400">{staleMessage(m)}</p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  coverage {m.coverage_days}/{m.window_days}d
                  {m.last_ok_day && ` · last ok ${m.last_ok_day}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {healthy.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer select-none flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            {healthy.length} metric{healthy.length === 1 ? "" : "s"} up to date
          </summary>
          <ul className="mt-2 space-y-1">
            {healthy.map((m) => (
              <li
                key={m.kind}
                className={cn(
                  "flex items-center justify-between text-xs py-1 border-b border-border last:border-0"
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
