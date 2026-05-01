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
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-500/10">
            <Watch className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Garmin Connect</h1>
            <p className="text-xs text-muted-foreground">Sync your wearable data</p>
          </div>
        </div>
      </div>

      {/* Status */}
      <Card title="Connection Status" icon={<Activity className="h-4 w-4 text-blue-400" />}>
        {status ? (
          <div className="space-y-2">
            <StatRow
              label="Last fetch"
              value={
                status.last_fetch ? (
                  <span className="font-mono text-sm">{status.last_fetch}</span>
                ) : (
                  <Badge variant="outline">never</Badge>
                )
              }
            />
            <StatRow label="Metric rows stored" value={
              <span className="font-mono text-sm">{status.metric_rows.toLocaleString()}</span>
            } />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading status...</span>
          </div>
        )}
      </Card>

      {/* Login & Sync */}
      <Card title="Authentication" icon={<LogIn className="h-4 w-4 text-muted-foreground" />}>
        <p className="text-xs text-muted-foreground/80 mb-4 leading-relaxed">
          Uses the unofficial garminconnect library. Credentials are sent once; the
          backend persists OAuth tokens to <code className="text-foreground/70 bg-surface-2 px-1 py-0.5 rounded text-2xs">/app/garmin_tokens</code>.
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
          <div className="flex gap-2 pt-1">
            <Button onClick={login} disabled={busy}>
              <LogIn className="h-4 w-4 mr-2" />
              Login
            </Button>
            <Button variant="secondary" onClick={syncRecent} disabled={busy}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync recent (2 days)
            </Button>
          </div>
        </div>
        {msg && (
          <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-emerald-400 text-sm whitespace-pre-wrap">{msg}</p>
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-400 text-sm">{err}</p>
          </div>
        )}
      </Card>

      {/* Full History Sync */}
      <Card title="Full History Sync" icon={<History className="h-4 w-4 text-amber-400" />}>
        <p className="text-xs text-muted-foreground/80 mb-4 leading-relaxed">
          Pull your entire Garmin history. This may take several minutes depending on how
          far back you go. The backend will upsert all metrics so existing data is not
          duplicated.
        </p>
        <div className="flex items-center gap-3">
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
            {historyBusy ? "Syncing..." : "Sync Full History"}
          </Button>
        </div>
        {historyBusy && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
            <p className="text-xs text-amber-400/80">
              Syncing {historyDays} days of data. This may take a while...
            </p>
          </div>
        )}
        {historyMsg && (
          <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-emerald-400 text-sm whitespace-pre-wrap">{historyMsg}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
