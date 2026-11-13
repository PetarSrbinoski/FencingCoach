"use client";

import { PageHeading } from "@/components/page-heading";
import { Gauge } from "@/components/charts";
import { FencerStudy } from "@/components/fencer-study";
import { SignalForm } from "@/components/signal-form";
import { StaleDataBanner } from "@/components/data-coverage-panel";
import { ErrorNotice, ReadMore } from "@/components/mobile-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
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
    <div className="dashboard-home">
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
      <div className="dashboard-primary">
      <section
        className="performance-panel space-y-4"
        aria-label="Today's readiness"
      >
        <div className="readiness-scene">
          <FencerStudy />
          <div className="readiness-data">
            <h2>Readiness</h2>
            {readiness?.score != null && <Gauge score={readiness.score} size={112} />}
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
          <Button asChild>
            <a href="/training">
              Today&apos;s training <span aria-hidden="true">↗</span>
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/nutrition">Log food</a>
          </Button>
        </div>
      </section>
      <section className="dashboard-section coach-question" aria-labelledby="ask-coach-title">
        <h2
          id="ask-coach-title"
          className="dashboard-section-heading font-sans font-medium text-lg"
        >
          Ask your coach
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">Make sense of today’s data before you train</p>
        <form onSubmit={sendToCoach} className="flex gap-3">
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
      </section>
      <section
        aria-labelledby="recovery-metrics-title"
        className="dashboard-section recovery-section"
      >
        <div className="dashboard-section-heading flex flex-wrap items-center justify-between gap-2">
          <h2
            id="recovery-metrics-title"
            className="font-sans font-medium text-lg"
          >
            Recovery metrics
          </h2>
          <Button variant="link" size="sm" asChild>
            <a href="/weekly">View trends</a>
          </Button>
        </div>
        <div className="recovery-grid">
          <StatCard title="HRV" series={hrv} unit="ms" error={loadErrors.hrv} variant={0} />
          <StatCard
            title="Resting HR"
            series={rhr}
            unit="bpm"
            error={loadErrors.rhr}
            variant={1}
          />
          <StatCard
            title="Sleep score"
            series={sleepScore}
            unit=""
            error={loadErrors.sleep}
            variant={2}
          />
          <StatCard
            title="Readiness"
            series={readinessSeries}
            unit=""
            error={loadErrors.readiness}
            variant={3}
          />
          <StatCard
            title="Calories"
            series={calories}
            unit="kcal"
            error={loadErrors.calories}
            variant={4}
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
      </section>
      </div>
      <div className="dashboard-editorial">
        <section
          className="dashboard-section coach-brief"
          aria-labelledby="coach-brief-title"
        >
          <div className="dashboard-section-heading flex flex-wrap items-center justify-between gap-2">
            <h2
              id="coach-brief-title"
              className="font-sans font-medium text-lg"
            >
              Coach brief
            </h2>
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
            <details className="mt-4 border-t border-border pt-2 text-sm text-muted-foreground">
              <summary>Brief source</summary>
              <p>{brief.payload.model}</p>
            </details>
          )}
        </section>
        <section
          className="competition-feature space-y-4"
          aria-labelledby="next-competition-title"
        >
          <h2
            id="next-competition-title"
            className="dashboard-section-heading font-sans font-medium text-lg"
          >
            Next competition
          </h2>
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
                <Badge variant="outline">Priority {nextComp.priority}</Badge>
              </div>
              <p className="text-lg font-medium leading-snug">
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
    </div>
  );
}

function StatCard({
  title,
  series,
  unit,
  error,
  variant,
}: {
  title: string;
  series: MetricSeries | null;
  unit: string;
  error?: string;
  variant: number;
}) {
  const readings = series?.points.filter((point) => point.value !== null) ?? [];
  const last = readings.at(-1);
  const previous = readings.at(-2);
  const delta = last?.value != null && previous?.value != null ? last.value - previous.value : null;
  return (
    <div className="metric-tile">
      <h3>{title}</h3>
      {error ? (
        <p className="text-sm">Unavailable</p>
      ) : !series ? (
        <Skeleton className="h-7 w-14" />
      ) : (
        <>
          <p className="metric-value tabular-nums">
            {last?.value != null
              ? last.value.toFixed(last.value >= 100 ? 0 : 1)
              : "—"}{" "}
            <span className="text-xs font-normal">{unit}</span>
          </p>
          {last?.value != null && <SignalForm variant={variant} />}
          <div className="metric-meta">
            <p>{delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs prior reading` : "No comparison yet"}</p>
            <p>{last?.day ?? "No readings"}</p>
          </div>
        </>
      )}
    </div>
  );
}
