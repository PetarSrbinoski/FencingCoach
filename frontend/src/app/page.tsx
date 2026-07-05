"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  Activity,
  Brief,
  Competition,
  MetricSeries,
  Phase,
  Readiness,
} from "@/lib/api";
import { Gauge } from "@/components/charts";
import { BandPill } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/ui/markdown";
import { StaleDataBanner } from "@/components/data-coverage-panel";
import { useToast } from "@/components/ui/toast";
import {
  Heart,
  Activity as ActivityIcon,
  Target,
  Star,
  Flame,
  ArrowRight,
  Send,
  RefreshCw,
  MapPin,
} from "lucide-react";

export default function Home() {
  const router = useRouter();
  const { toast } = useToast();

  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [hrv, setHrv] = useState<MetricSeries | null>(null);
  const [sleepScore, setSleepScore] = useState<MetricSeries | null>(null);
  const [rhr, setRhr] = useState<MetricSeries | null>(null);
  const [readinessSeries, setReadinessSeries] = useState<MetricSeries | null>(null);
  const [calories, setCalories] = useState<MetricSeries | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextComp, setNextComp] = useState<Competition | null | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function loadAll() {
    setErr(null);
    api.readiness.today().then(setReadiness).catch((e) => setErr(String(e)));
    api.brief.today().then(setBrief).catch(() => {});
    api.phase.today().then(setPhase).catch(() => {});
    api.metrics.series("hrv", 7).then(setHrv).catch(() => {});
    api.metrics.series("sleep_score", 7).then(setSleepScore).catch(() => {});
    api.metrics.series("resting_hr", 7).then(setRhr).catch(() => {});
    api.metrics.series("training_readiness", 7).then(setReadinessSeries).catch(() => {});
    api.metrics.series("calories", 7).then(setCalories).catch(() => {});
    api.activities.recent(3).then(setActivities).catch(() => {});
    api.competitions.list(true).then((list) => setNextComp(list[0] ?? null)).catch(() => setNextComp(null));
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

  async function syncSinceLastSync() {
    setSyncing(true);
    try {
      const status = await api.garmin.status();
      const days = status.last_fetch
        ? Math.max(1, Math.ceil((Date.now() - new Date(status.last_fetch).getTime()) / 86400000))
        : 2;
      const res = await api.garmin.syncRecent(days);
      if (res.ok) {
        toast({ title: `Synced last ${days} day${days === 1 ? "" : "s"}`, variant: "success" });
        loadAll();
      } else {
        toast({ title: "Sync failed", description: res.error, variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
    ? Math.round((new Date(nextComp.event_date).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Hero header ───────────────────────────────────────────── */}
      <header className="relative">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
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
              <p className="mt-4 text-sm text-muted-foreground font-mono">{phase.name} phase</p>
            )}
          </div>
          <Button variant="outline" onClick={syncSinceLastSync} disabled={syncing} className="shrink-0">
            <RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        </div>
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* ── Ask the coach ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
          Ask your coach
        </h2>
        <form onSubmit={sendToCoach} className="flex gap-2">
          <Input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Should I skip gym today?"
            aria-label="Message the coach"
            className="flex-1 h-12 text-base"
          />
          <Button type="submit" size="icon" className="h-12 w-12 shrink-0" disabled={!chatInput.trim()} aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </section>

      <StaleDataBanner />

      {/* ── Stat cards ────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
          <StatCard title="HRV" icon={<ActivityIcon className="h-3.5 w-3.5" />} series={hrv} unit="ms" />
          <StatCard title="Resting HR" icon={<Heart className="h-3.5 w-3.5" />} series={rhr} unit="bpm" />
          <StatCard title="Sleep Score" icon={<Star className="h-3.5 w-3.5" />} series={sleepScore} unit="" />
          <StatCard title="Readiness" icon={<Target className="h-3.5 w-3.5" />} series={readinessSeries} unit="" />
          <StatCard title="Calories" icon={<Flame className="h-3.5 w-3.5" />} series={calories} unit="kcal" />
        </div>
      </section>

      {/* ── Readiness gauge ───────────────────────────────────────── */}
      {readiness && readiness.score !== null && (
        <section className="flex items-center gap-8 border-t border-border pt-10">
          <Gauge score={readiness.score} size={120} />
          <div className="flex flex-col gap-3 min-w-0">
            <BandPill band={readiness.band} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              {Object.entries(readiness.advisories).map(([k, a]) => (
                <div key={k} className="flex items-baseline gap-2 text-xs">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-widest shrink-0">
                    {k.replace(/_/g, " ")}
                  </span>
                  <span className="text-foreground/80 truncate">{a.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Brief + next competition ─────────────────────────────── */}
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
            <div className="max-w-2xl text-base text-foreground/90">
              <Markdown>{brief.summary}</Markdown>
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

        {/* Next competition */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
            Next Competition
          </h2>
          {nextComp === undefined ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : nextComp ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">T-{daysToComp}d</Badge>
                <BandPill band={nextComp.priority === "A" ? "red" : nextComp.priority === "B" ? "amber" : "green"} />
              </div>
              <div className="text-foreground font-semibold text-xl leading-snug">{nextComp.name}</div>
              {(nextComp.location || nextComp.level) && (
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-mono">
                  {nextComp.location && (
                    <>
                      <MapPin className="h-3 w-3" />
                      <span>{nextComp.location}</span>
                    </>
                  )}
                  {nextComp.location && nextComp.level && <span className="text-border">·</span>}
                  {nextComp.level && <span className="uppercase">{nextComp.level}</span>}
                </div>
              )}
              <a href="/competitions" className="inline-flex items-center gap-2 mt-4 text-xs font-semibold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors duration-150">
                View all <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <div className="py-8 text-center border border-border">
              <p className="text-muted-foreground text-sm">No upcoming competitions</p>
              <a href="/competitions" className="inline-flex items-center gap-2 mt-4 text-xs font-semibold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors duration-150">
                Add one <ArrowRight className="h-3 w-3" />
              </a>
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
function StatCard({ title, icon, series, unit }: {
  title: string; icon: React.ReactNode; series: MetricSeries | null; unit: string;
}) {
  const last = series?.points.filter((p) => p.value !== null).slice(-1)[0];
  const value = last?.value;

  return (
    <div className="border border-border p-3 sm:p-4 flex flex-col items-center justify-center gap-1.5 min-h-[4.5rem] overflow-hidden transition-colors duration-150 hover:border-foreground/25">
      <div className="flex items-center gap-1 text-muted-foreground/70">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-tight whitespace-nowrap">
          {title}
        </span>
      </div>
      {series ? (
        <span className="flex items-baseline gap-1 font-mono font-bold tracking-tight tabular-nums leading-none">
          <span className="text-xl sm:text-2xl">
            {value != null ? value.toFixed(value >= 100 ? 0 : 1) : "\u2014"}
          </span>
          {value != null && unit && (
            <span className="text-[10px] text-muted-foreground font-sans font-medium">{unit}</span>
          )}
        </span>
      ) : (
        <Skeleton className="h-7 w-14" />
      )}
    </div>
  );
}
