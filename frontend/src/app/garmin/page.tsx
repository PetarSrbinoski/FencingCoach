"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, StatRow } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Watch, RefreshCw, LogIn, Activity, History, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const HISTORY_OPTIONS = [
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
  { value: "1095", label: "3 years (full)" },
];

export default function GarminPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ last_fetch: string | null; metric_rows: number } | null>(
    null
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyDays, setHistoryDays] = useState("365");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      setStatus(await api.garmin.status());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function login() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.garmin.login(email, password);
      setMsg("Logged in to Garmin. Tokens persisted.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  async function syncRecent() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.garmin.syncRecent(2);
      setMsg(res.ok ? `Synced: ${JSON.stringify(res.fetched)}` : `Failed: ${res.error}`);
      await refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  async function syncFullHistory() {
    setHistoryBusy(true);
    setHistoryMsg(null);
    setErr(null);
    try {
      const days = parseInt(historyDays);
      const res = await api.garmin.syncFull(days);
      setHistoryMsg(
        res.ok
          ? `Full sync complete (${days} days): ${JSON.stringify(res.fetched)}`
          : `Sync failed: ${res.error}`
      );
      await refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setHistoryBusy(false);
    }
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b-4 border-foreground pb-4">
        <div className="flex items-center justify-center h-10 w-10 border-2 border-foreground bg-bauhaus-blue shadow-hard-sm">
          <Watch className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Garmin</h1>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1 font-mono">Sync your wearable data</p>
        </div>
      </div>

      {/* Status */}
      <Card title="Connection Status" icon={<Activity className="h-4 w-4" />}>
        {status ? (
          <div className="space-y-2">
            <StatRow
              label="Last fetch"
              value={
                status.last_fetch ? (
                  <span className="font-mono text-sm font-bold">{status.last_fetch}</span>
                ) : (
                  <Badge variant="outline">never</Badge>
                )
              }
            />
            <StatRow label="Metric rows stored" value={
              <span className="font-mono text-sm font-bold">{status.metric_rows.toLocaleString()}</span>
            } />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-mono">Loading status...</span>
          </div>
        )}
      </Card>

      {/* Login & Sync */}
      <Card title="Authentication" icon={<LogIn className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed font-mono">
          Uses the unofficial garminconnect library. Credentials are sent once; the
          backend persists OAuth tokens to <code className="text-foreground bg-muted px-1 py-0.5 border border-foreground/20 text-2xs font-bold">/app/garmin_tokens</code>.
        </p>
        <div className="space-y-3">
          <Input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={login} disabled={busy}>
              <LogIn className="h-4 w-4 mr-2" />
              LOGIN
            </Button>
            <Button variant="secondary" onClick={syncRecent} disabled={busy}>
              <RefreshCw className="h-4 w-4 mr-2" />
              SYNC RECENT (2D)
            </Button>
          </div>
        </div>
        {msg && (
          <div className="flex items-start gap-2 mt-4 p-3 border-2 border-bauhaus-blue bg-bauhaus-blue/5">
            <CheckCircle2 className="h-4 w-4 text-bauhaus-blue mt-0.5 shrink-0" />
            <p className="text-bauhaus-blue text-sm font-bold whitespace-pre-wrap">{msg}</p>
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 mt-4 p-3 border-2 border-bauhaus-red bg-bauhaus-red/5">
            <AlertCircle className="h-4 w-4 text-bauhaus-red mt-0.5 shrink-0" />
            <p className="text-bauhaus-red text-sm font-bold">{err}</p>
          </div>
        )}
      </Card>

      {/* Full History Sync */}
      <Card title="Full History Sync" icon={<History className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed font-mono">
          Pull your entire Garmin history. This may take several minutes depending on how
          far back you go. The backend will upsert all metrics so existing data is not
          duplicated.
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Select value={historyDays} onValueChange={setHistoryDays}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={syncFullHistory}
            disabled={historyBusy || busy}
            variant="default"
          >
            {historyBusy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <History className="h-4 w-4 mr-2" />
            )}
            {historyBusy ? "SYNCING..." : "SYNC FULL HISTORY"}
          </Button>
        </div>
        {historyBusy && (
          <div className="flex items-center gap-2 mt-4 p-3 border-2 border-bauhaus-yellow bg-bauhaus-yellow/10">
            <Loader2 className="h-4 w-4 text-foreground animate-spin shrink-0" />
            <p className="text-xs text-foreground font-bold font-mono">
              Syncing {historyDays} days of data. This may take a while...
            </p>
          </div>
        )}
        {historyMsg && (
          <div className="flex items-start gap-2 mt-4 p-3 border-2 border-bauhaus-blue bg-bauhaus-blue/5">
            <CheckCircle2 className="h-4 w-4 text-bauhaus-blue mt-0.5 shrink-0" />
            <p className="text-bauhaus-blue text-sm font-bold whitespace-pre-wrap">{historyMsg}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
