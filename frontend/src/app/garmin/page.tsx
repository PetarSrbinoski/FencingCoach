"use client";

import { useEffect, useState } from "react";
import { api, type Readiness } from "@/lib/api";
import { announceGarminSync, useGarminSyncObserver } from "@/lib/garmin-refresh";
import { Loader2 } from "lucide-react";
import { DataCoveragePanel } from "@/components/data-coverage-panel";
import { useToast } from "@/components/ui/toast";

export default function GarminPage() {
  const [status, setStatus] = useState<{ last_fetch: string | null; metric_rows: number; last_sync_at: string | null; last_sync_ok: boolean | null } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [syncState, setSyncState] = useState<string | null>(null);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const { toast } = useToast();

  async function refresh() {
    try {
      const [nextStatus, nextReadiness] = await Promise.all([api.garmin.status(), api.readiness.today()]);
      setStatus(nextStatus);
      setReadiness(nextReadiness);
      setCoverageRevision(value => value + 1);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    }
  }

  useEffect(() => { refresh(); }, []);
  useGarminSyncObserver(refresh);

  async function syncRecent() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.garmin.syncRecent(2);
      announceGarminSync();
      if (res.ok) {
        const current = await api.readiness.today();
        setSyncState(current.score === null ? "Sync complete; today's readiness is unavailable." : `Sync complete; readiness is ${current.score} (${current.band}).`);
        toast({ title: "Synced last 2 days", description: JSON.stringify(res.fetched), variant: "success" });
      } else {
        setSyncState("Recent sync failed. Retry is available.");
        toast({ title: "Sync failed", description: res.error, variant: "destructive" });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  async function syncFullHistory() {
    setHistoryBusy(true);
    setErr(null);
    try {
      const res = await api.garmin.syncFull(365);
      announceGarminSync();
      if (res.ok) {
        const current = await api.readiness.today();
        setSyncState(current.score === null ? "Full sync complete; today's readiness is unavailable." : `Full sync complete; readiness is ${current.score} (${current.band}).`);
        toast({ title: "Full sync complete", description: JSON.stringify(res.fetched), variant: "success" });
      } else {
        setSyncState("Full sync failed. Retry is available.");
        toast({ title: "Sync failed", description: res.error, variant: "destructive" });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setHistoryBusy(false);
    }
  }

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          Wearable data
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Garmin
        </h1>
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {/* ── Messages ───────────────────────────────────────────────── */}
      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}
      {syncState && <p role="status" className="text-sm text-muted-foreground">{syncState}</p>}

      {/* ── Sync Buttons — typographic hero layout ─────────────────── */}
      <section className="relative">
        {/* Decorative large text behind */}
        <div className="absolute -top-8 left-0 text-[12rem] md:text-[16rem] font-bold tracking-tighter text-border/30 leading-none select-none pointer-events-none hidden md:block overflow-hidden">
          S
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-16 md:gap-20 items-start">
          {/* Primary: Sync Recent */}
          <button
            onClick={syncRecent}
            disabled={busy || historyBusy}
            className="group text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Last 2 days
              </span>
              {busy && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            </div>
            <div className="relative">
              <span className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold tracking-tighter leading-none text-foreground group-hover:text-accent transition-colors duration-150">
                Sync
              </span>
              {/* Underline accent */}
              <span className="block h-0.5 bg-accent mt-3 origin-left scale-x-100 group-hover:scale-x-110 transition-transform duration-150" />
            </div>
            <p className="text-sm text-muted-foreground mt-4 max-w-xs leading-relaxed">
              Pull the latest metrics, sleep, and activity data from Garmin Connect.
            </p>
          </button>

          {/* Secondary: Sync All */}
          <button
            onClick={syncFullHistory}
            disabled={busy || historyBusy}
            className="group text-left disabled:opacity-50 disabled:cursor-not-allowed md:pt-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Full history — 1 year
              </span>
              {historyBusy && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            </div>
            <div className="relative">
              <span className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tighter leading-none text-muted-foreground group-hover:text-foreground transition-colors duration-150">
                Sync All
              </span>
              {/* Thinner underline for secondary */}
              <span className="block h-px bg-muted-foreground/50 mt-3 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-150" />
            </div>
            <p className="text-xs text-muted-foreground/60 mt-4 max-w-xs leading-relaxed">
              Backfill your entire Garmin history. May take several minutes.
            </p>
          </button>
        </div>
      </section>

      {/* ── Status metadata ────────────────────────────────────────── */}
      <section className="border-t border-border pt-6 text-sm" role="status">
        {readiness ? readiness.score === null ? `Today's readiness (${readiness.day}) is unavailable.` : `Readiness ${readiness.score} (${readiness.band}) for ${readiness.day}; fetched ${readiness.reading_fetched_at ?? "at an unknown time"}.` : "Loading current readiness…"}
        {status?.last_sync_at && <p className="text-xs text-muted-foreground mt-2">Last sync attempt: {status.last_sync_at} · {status.last_sync_ok ? "complete" : "failed"}</p>}
      </section>
      <section className="border-t border-border pt-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-lg">
          <div>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-2">
              Last synced
            </span>
            {status ? (
              <span className="text-lg font-mono font-medium tracking-tight">
                {status.last_fetch ?? "Never"}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground/50 font-mono">Loading...</span>
            )}
          </div>
          <div>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground block mb-2">
              Rows synced
            </span>
            {status ? (
              <span className="text-lg font-mono font-medium tracking-tight">
                {status.metric_rows.toLocaleString()}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground/50 font-mono">Loading...</span>
            )}
          </div>
        </div>
      </section>

      {/* ── Loading indicator ──────────────────────────────────────── */}
      {historyBusy && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-mono uppercase tracking-wider">
            Syncing full history...
          </span>
        </div>
      )}

      {/* ── Data coverage ──────────────────────────────────────────── */}
      <section className="border-t border-border pt-12">
        <DataCoveragePanel revision={coverageRevision} />
      </section>
    </div>
  );
}
