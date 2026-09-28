"use client";

import { PageHeading } from "@/components/page-heading";
import { Gauge } from "@/components/charts";
import { StaleDataBanner } from "@/components/data-coverage-panel";
import { ErrorNotice, ReadMore } from "@/components/mobile-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  Activity,
  api,
  Brief,
  Competition,
  MetricSeries,
  Phase,
  Readiness,
} from "@/lib/api";
import {
  announceGarminSync,
  useGarminSyncObserver,
} from "@/lib/garmin-refresh";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const router = useRouter();
  const { toast } = useToast();

  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [hrv, setHrv] = useState<MetricSeries | null>(null);
  const [sleepScore, setSleepScore] = useState<MetricSeries | null>(null);
  const [rhr, setRhr] = useState<MetricSeries | null>(null);
  const [readinessSeries, setReadinessSeries] = useState<MetricSeries | null>(
    null,
  );
  const [calories, setCalories] = useState<MetricSeries | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextComp, setNextComp] = useState<Competition | null | undefined>(
    undefined,
  );
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState<string | null>(null);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const loadVersion = useRef(0);
  const [chatInput, setChatInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function loadAll() {
    const version = ++loadVersion.current;
    const current = () => loadVersion.current === version;
    setErr(null);
    setLoadErrors({});
    const failed = (key: string, error: unknown) => {
      if (current())
        setLoadErrors((previous) => ({
          ...previous,
          [key]: error instanceof Error ? error.message : String(error),
        }));
    };
    api.readiness
      .today()
      .then((value) => {
        if (current()) setReadiness(value);
      })
      .catch((e) => {
        if (current()) setErr(String(e));
      });
    api.brief
      .today()
      .then((value) => {
        if (current()) setBrief(value);
      })
      .catch((error) => failed("brief", error));
    api.phase
      .today()
      .then((value) => {
        if (current()) setPhase(value);
      })
      .catch((error) => failed("phase", error));
    api.metrics
      .series("hrv", 7)
      .then((value) => {
        if (current()) setHrv(value);
      })
      .catch((error) => failed("hrv", error));
    api.metrics
      .series("sleep_score", 7)
      .then((value) => {
        if (current()) setSleepScore(value);
      })
      .catch((error) => failed("sleep", error));
    api.metrics
      .series("resting_hr", 7)
      .then((value) => {
        if (current()) setRhr(value);
      })
      .catch((error) => failed("rhr", error));
    api.metrics
      .series("training_readiness", 7)
      .then((value) => {
        if (current()) setReadinessSeries(value);
      })
      .catch((error) => failed("readiness", error));
    api.metrics
      .series("calories", 7)
      .then((value) => {
        if (current()) setCalories(value);
      })
      .catch((error) => failed("calories", error));
    api.activities
      .recent(3)
      .then((value) => {
        if (current()) setActivities(value);
      })
      .catch((error) => failed("activities", error));
    api.competitions
      .list(true)
      .then((list) => {
        if (current()) setNextComp(list[0] ?? null);
      })
      .catch((error) => failed("competitions", error));
    setCoverageRevision((value) => value + 1);
  }

  useEffect(loadAll, []);
  useGarminSyncObserver(loadAll);
  useWorkflowRefresh(loadAll);

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

  async function syncSinceLastSync() {
    setSyncing(true);
    try {
      const status = await api.garmin.status();
      const days = status.last_fetch
        ? Math.max(
            1,
            Math.ceil(
              (Date.now() - new Date(status.last_fetch).getTime()) / 86400000,
            ),
          )
        : 2;
      const res = await api.garmin.syncRecent(days);
      announceGarminSync();
      if (res.outcome === "partial") {
        setSyncState(
          "Sync partially completed. Usable readings remain visible; some endpoints are unavailable. Retry is available.",
        );
        toast({
          title: "Partial sync",
          description: "Some Garmin endpoints could not be fetched.",
        });
      } else if (res.ok) {
        const latest = await api.readiness.today();
        setSyncState(
          latest.score === null
            ? "Sync complete; today's readiness is unavailable."
            : `Sync complete; today's readiness is ${latest.score} (${latest.band}).`,
        );
        toast({
          title: `Synced last ${days} day${days === 1 ? "" : "s"}`,
          variant: "success",
        });
      } else {
        setSyncState(
          "Sync failed. Any committed readings remain visible; retry is available.",
        );
        toast({
          title: "Sync failed",
          description: res.error,
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      setSyncState("Sync failed. Retry is available.");
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  function sendToCoach(e: React.FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    sessionStorage.setItem("pendingChatMessage", message);
    router.push("/chat");
  }

  const daysToComp = nextComp
    ? Math.round(
        (new Date(nextComp.event_date).getTime() - Date.now()) / 86400000,
      )
    : null;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Today"
        eyebrow={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        action={
          <Button
            variant="outline"
            onClick={syncSinceLastSync}
            disabled={syncing}
          >
            <RefreshCw className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        }
      />
      {err && <ErrorNotice message={err} retry={loadAll} />}
      {syncState && (
        <p role="status" className="text-sm text-muted-foreground">
          {syncState}
        </p>
      )}
      <section
        className="performance-panel space-y-4"
        aria-label="Today's readiness"
      >
        <svg
          className="fencing-illustration"
          viewBox="0 0 240 145"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 131H232M32 139H208"
            stroke="currentColor"
            strokeOpacity=".25"
          />
          <g
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ellipse
              cx="105"
              cy="29"
              rx="12"
              ry="15"
              transform="rotate(15 105 29)"
            />
            <path d="M99 44L77 76L112 82L142 121L160 125M77 76L57 106L30 126L15 128M84 74L64 111L35 132M111 83L132 125L158 129M98 47L127 62L162 51M96 54L125 69L165 56M96 46L69 40L53 22M91 51L66 46L48 26M164 46L169 61M167 52L228 29" />
          </g>
        </svg>
        <div className="performance-overview flex flex-wrap items-center gap-4">
          {readiness?.score != null && (
            <Gauge score={readiness.score} size={120} />
          )}
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-muted-foreground">Your daily edge</p>
            <h2 className="mt-1 text-xl sm:text-2xl font-semibold tracking-tight">
              Readiness
            </h2>
            {readiness ? (
              <>
                <p className="text-sm">
                  {readiness.score === null
                    ? "Unavailable today"
                    : `Today’s band: ${readiness.band}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {readiness.day}
                  {phase ? ` · ${phase.name} phase` : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {err ? "Could not load readiness" : "Loading readiness…"}
              </p>
            )}
          </div>
        </div>
        {readiness && (
          <details className="text-sm">
            <summary>Readiness details</summary>
            <div className="space-y-3">
              {Object.entries(readiness.advisories).map(([key, advice]) => (
                <div key={key}>
                  <strong className="capitalize">
                    {key.replaceAll("_", " ")}
                  </strong>
                  <p className="text-muted-foreground">{advice.detail}</p>
                </div>
              ))}
              <p className="text-muted-foreground">
                {readiness.reading_fetched_at
                  ? `Fetched ${new Date(readiness.reading_fetched_at).toLocaleString()}`
                  : "No reading time available."}
              </p>
            </div>
          </details>
        )}
        <StaleDataBanner revision={coverageRevision} />
        <div className="grid grid-cols-[1.5fr_1fr] gap-2 sm:grid-cols-2">
          <Button
            asChild
            className="bg-accent text-accent-foreground border-accent hover:bg-accent/90"
          >
            <a href="/training">
              Today&apos;s training <span aria-hidden="true">↗</span>
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/nutrition">Log food</a>
          </Button>
        </div>
      </section>
      <div className="dashboard-editorial">
        <section className="coach-brief">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-2xl sm:text-3xl">Coach brief</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={generateBrief}
              disabled={generating}
            >
              {generating ? "Generating…" : brief ? "Regenerate" : "Generate"}
            </Button>
          </div>
          {loadErrors.brief && (
            <ErrorNotice
              message={`Could not load the brief: ${loadErrors.brief}`}
              retry={loadAll}
            />
          )}
          {brief ? (
            <ReadMore label="Read full brief">
              <Markdown>{brief.summary}</Markdown>
            </ReadMore>
          ) : (
            !loadErrors.brief && (
              <p className="text-sm text-muted-foreground">
                Generate today&apos;s brief for guidance on your training and
                recovery.
              </p>
            )
          )}
          {brief?.payload?.model && (
            <details className="text-sm text-muted-foreground">
              <summary>Brief source</summary>
              <p>{brief.payload.model}</p>
            </details>
          )}
          <details className="border-t border-border mt-3 pt-2">
            <summary className="font-semibold">Ask your coach</summary>
            <form onSubmit={sendToCoach} className="mt-3 flex gap-2">
              <Input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Should I skip gym today?"
                aria-label="Message the coach"
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                className="h-12 w-12 shrink-0"
                disabled={!chatInput.trim()}
                aria-label="Send message"
              >
                <Send />
              </Button>
            </form>
          </details>
        </section>
        <section className="competition-feature space-y-3">
          <h2 className="eyebrow">Next competition</h2>
          {loadErrors.competitions ? (
            <ErrorNotice
              message="Could not load competitions."
              retry={loadAll}
            />
          ) : nextComp === undefined ? (
            <Skeleton className="h-14 w-full" />
          ) : nextComp ? (
            <>
              <div className="competition-countdown">
                <p className="countdown-number">
                  {Math.max(0, daysToComp ?? 0)
                    .toString()
                    .padStart(2, "0")}
                </p>
                <span className="eyebrow">
                  {daysToComp !== null && daysToComp <= 0
                    ? "Competition time"
                    : "Days to go"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {daysToComp !== null && daysToComp <= 0
                    ? "Ongoing"
                    : `In ${daysToComp} days`}
                </Badge>
                <Badge variant="outline">Priority {nextComp.priority}</Badge>
              </div>
              <p className="font-serif text-2xl leading-snug">
                {nextComp.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {[nextComp.event_date, nextComp.location, nextComp.level]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={`/competitions#competition-${nextComp.id}`}>
                  View event
                </a>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No upcoming competitions.
              </p>
              <Button variant="outline" asChild>
                <a href="/competitions">Add a competition</a>
              </Button>
            </>
          )}
        </section>
      </div>
      <section aria-label="Recovery metrics" className="space-y-4">
        <h2 className="eyebrow">Recovery metrics</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
          <StatCard title="HRV" series={hrv} unit="ms" error={loadErrors.hrv} />
          <StatCard
            title="Resting HR"
            series={rhr}
            unit="bpm"
            error={loadErrors.rhr}
          />
          <StatCard
            title="Sleep score"
            series={sleepScore}
            unit=""
            error={loadErrors.sleep}
          />
          <StatCard
            title="Readiness"
            series={readinessSeries}
            unit=""
            error={loadErrors.readiness}
          />
          <StatCard
            title="Calories"
            series={calories}
            unit="kcal"
            error={loadErrors.calories}
          />
        </div>
        {Object.keys(loadErrors).length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={loadAll}
          >
            Retry unavailable data
          </Button>
        )}
        <Button variant="link" asChild>
          <a href="/weekly">View trends</a>
        </Button>
      </section>
      <details className="border-y border-border py-2">
        <summary className="font-semibold">Recent activities</summary>
        {loadErrors.activities ? (
          <ErrorNotice message="Could not load activities." retry={loadAll} />
        ) : activities.length ? (
          <div className="divide-y divide-border">
            {activities.slice(0, 5).map((activity) => (
              <div key={activity.id} className="py-3 space-y-1">
                <p className="font-medium">
                  {activity.name ?? "Untitled activity"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {activity.activity_type ?? "Activity"} ·{" "}
                  {new Date(activity.start_time).toLocaleDateString()}
                </p>
                <p className="text-sm">
                  {activity.duration_s != null
                    ? `${Math.round(activity.duration_s / 60)} min · `
                    : ""}
                  {activity.calories != null
                    ? `${activity.calories} kcal · `
                    : ""}
                  {activity.avg_hr != null ? `${activity.avg_hr} bpm` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recent activities. Sync Garmin to check for new sessions.
          </p>
        )}
      </details>
    </div>
  );
}

function StatCard({
  title,
  series,
  unit,
  error,
}: {
  title: string;
  series: MetricSeries | null;
  unit: string;
  error?: string;
}) {
  const last = series?.points.filter((point) => point.value !== null).at(-1);
  return (
    <div className="min-w-0 bg-background p-4 space-y-2 last:col-span-2 sm:last:col-span-1">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      {error ? (
        <p className="text-sm">Unavailable</p>
      ) : !series ? (
        <Skeleton className="h-7 w-14" />
      ) : (
        <>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {last?.value != null
              ? last.value.toFixed(last.value >= 100 ? 0 : 1)
              : "—"}{" "}
            <span className="text-xs font-normal">{unit}</span>
          </p>
          <MetricTrace points={series.points} />
          <p className="text-xs text-muted-foreground">
            {last?.day ?? "No readings"}
          </p>
        </>
      )}
    </div>
  );
}

/** Small noninteractive preview; the Trends screen provides exact dated values. */
function MetricTrace({ points }: { points: MetricSeries["points"] }) {
  const recent = points.slice(-14);
  const values = recent.flatMap((point) =>
    point.value == null ? [] : [point.value],
  );
  if (values.length < 2) return null;
  const min = Math.min(...values),
    range = Math.max(...values) - min || 1;
  const x = (index: number) =>
    2 + (index / Math.max(1, recent.length - 1)) * 116;
  const y = (value: number) => 25 - ((value - min) / range) * 22;
  return (
    <svg
      viewBox="0 0 120 28"
      className="h-7 w-full text-accent"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {recent.map((point, index) => {
        const previous = recent[index - 1];
        return index > 0 && previous.value != null && point.value != null ? (
          <path
            key={index}
            d={`M${x(index - 1)},${y(previous.value)} L${x(index)},${y(point.value)}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null;
      })}
    </svg>
  );
}
