"use client";

import { PageHeading } from "@/components/page-heading";

import { DataCoveragePanel } from "@/components/data-coverage-panel";
import { ErrorNotice } from "@/components/mobile-ui";
import { useToast } from "@/components/ui/toast";
import { api, type Readiness } from "@/lib/api";
import {
  announceGarminSync,
  useGarminSyncObserver,
} from "@/lib/garmin-refresh";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function GarminPage() {
  const [status, setStatus] = useState<{
    last_fetch: string | null;
    metric_rows: number;
    last_sync_at: string | null;
    last_sync_ok: boolean | null;
    last_sync_outcome: string | null;
  } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [syncState, setSyncState] = useState<string | null>(null);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const { toast } = useToast();

  async function refresh() {
    setErr(null);
    try {
      const [nextStatus, nextReadiness] = await Promise.all([
        api.garmin.status(),
        api.readiness.today(),
      ]);
      setStatus(nextStatus);
      setReadiness(nextReadiness);
      setCoverageRevision((value) => value + 1);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);
  useGarminSyncObserver(refresh);

  async function syncRecent() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.garmin.syncRecent(2);
      announceGarminSync();
      if (res.outcome === "partial") {
        setSyncState(
          "Sync partially completed. Usable readings are shown; some endpoints are unavailable. Retry is available.",
        );
        toast({
          title: "Partial sync",
          description: "Some Garmin endpoints could not be fetched.",
        });
      } else if (res.ok) {
        const current = await api.readiness.today();
        setSyncState(
          current.score === null
            ? "Sync complete; today's readiness is unavailable."
            : `Sync complete; readiness is ${current.score} (${current.band}).`,
        );
        toast({
          title: "Synced last 2 days",
          description: Object.entries(res.fetched)
            .map(([kind, count]) => `${count} ${kind.replaceAll("_", " ")}`)
            .join(", "),
          variant: "success",
        });
      } else {
        setSyncState("Recent sync failed. Retry is available.");
        toast({
          title: "Sync failed",
          description: res.error,
          variant: "destructive",
        });
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
      if (res.outcome === "partial") {
        setSyncState(
          "Full sync partially completed. Usable readings are shown; some endpoints are unavailable. Retry is available.",
        );
        toast({
          title: "Partial sync",
          description: "Some Garmin endpoints could not be fetched.",
        });
      } else if (res.ok) {
        const current = await api.readiness.today();
        setSyncState(
          current.score === null
            ? "Full sync complete; today's readiness is unavailable."
            : `Full sync complete; readiness is ${current.score} (${current.band}).`,
        );
        toast({
          title: "Full sync complete",
          description: Object.entries(res.fetched)
            .map(([kind, count]) => `${count} ${kind.replaceAll("_", " ")}`)
            .join(", "),
          variant: "success",
        });
      } else {
        setSyncState("Full sync failed. Retry is available.");
        toast({
          title: "Sync failed",
          description: res.error,
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setHistoryBusy(false);
    }
  }

  return (
    <div className="space-y-10 md:space-y-16">
      <PageHeading title="Garmin" eyebrow="Wearable data" />
      {err && <ErrorNotice message={err} retry={refresh} />}
      <section className="relative" aria-label="Garmin sync actions">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 left-0 hidden select-none text-[16rem] font-bold leading-none tracking-tighter text-border/30 md:block"
        >
          S
        </span>
        <div className="relative grid grid-cols-1 items-start gap-10 md:grid-cols-[3fr_2fr] md:gap-16">
          <button
            type="button"
            onClick={syncRecent}
            disabled={busy || historyBusy}
            aria-busy={busy}
            aria-label="Sync recent data"
            className="group min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            <span className="eyebrow mb-2 flex items-center gap-3 text-muted-foreground">
              Last 2 days{" "}
              {busy && (
                <Loader2
                  className="h-4 w-4 animate-spin text-accent"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="block text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold leading-none tracking-tighter transition-colors group-hover:text-accent">
              Sync
            </span>
            <span className="mt-3 block h-0.5 bg-accent" aria-hidden="true" />
            <span className="mt-4 block max-w-xs text-sm leading-relaxed text-muted-foreground">
              Pull the latest metrics, sleep, and activity data from Garmin
              Connect.
            </span>
          </button>
          <button
            type="button"
            onClick={syncFullHistory}
            disabled={busy || historyBusy}
            aria-busy={historyBusy}
            aria-label="Sync all history"
            className="group min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-50 md:pt-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            <span className="eyebrow mb-2 flex items-center gap-3 text-muted-foreground">
              Full history — 1 year{" "}
              {historyBusy && (
                <Loader2
                  className="h-4 w-4 animate-spin text-accent"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="block text-4xl sm:text-5xl md:text-6xl font-bold leading-none tracking-tighter text-muted-foreground transition-colors group-hover:text-foreground">
              Sync All
            </span>
            <span
              className="mt-3 block h-px bg-muted-foreground/50"
              aria-hidden="true"
            />
            <span className="mt-4 block max-w-xs text-sm leading-relaxed text-muted-foreground">
              Backfill your entire Garmin history. May take several minutes.
            </span>
          </button>
        </div>
      </section>
      <section
        aria-label="Sync status"
        className="space-y-3 border-t border-border pt-6"
      >
        {status ? (
          <>
            <p className="text-lg font-medium">
              {status.last_fetch
                ? `Data last fetched ${new Date(status.last_fetch).toLocaleString()}`
                : "No data synced yet"}
            </p>
            {status.last_sync_at && (
              <p className="text-sm text-muted-foreground">
                Last sync attempt:{" "}
                {new Date(status.last_sync_at).toLocaleString()} ·{" "}
                {status.last_sync_outcome ||
                  (status.last_sync_ok ? "complete" : "failed")}
              </p>
            )}
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {err ? "Status unavailable" : "Loading sync status…"}
          </p>
        )}
        <p className="text-sm">
          {readiness
            ? readiness.score === null
              ? `Today's readiness (${readiness.day}) is unavailable.`
              : `Readiness ${readiness.score} (${readiness.band}) for ${readiness.day}.`
            : err
              ? "Readiness unavailable"
              : "Loading current readiness…"}
        </p>
        {syncState && (
          <p role="status" className="rounded-xl bg-muted p-3 text-sm">
            {syncState}
          </p>
        )}
        {(busy || historyBusy) && (
          <p role="status" className="text-sm text-muted-foreground">
            {historyBusy
              ? "Importing up to one year of history. This may take several minutes."
              : "Checking Garmin for new readings…"}
          </p>
        )}
      </section>
      <section>
        <DataCoveragePanel revision={coverageRevision} />
      </section>
      <details className="rounded-2xl border border-border bg-card p-4 text-sm">
        <summary className="font-semibold">Technical details</summary>
        <p>
          Rows synced: {status?.metric_rows.toLocaleString() ?? "Unavailable"}
        </p>
        <p>Latest data timestamp: {status?.last_fetch ?? "Unavailable"}</p>
        <p>
          Readiness fetched: {readiness?.reading_fetched_at ?? "Unavailable"}
        </p>
      </details>
    </div>
  );
}
