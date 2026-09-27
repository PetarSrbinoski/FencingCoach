"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AgentAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { open: boolean; onOpenChange: (value: boolean) => void; onOpenConversation: (id: number) => void };
const kindLabels: Record<string, string> = {
  workout: "Workout", competition: "Competition", food_create: "Food added",
  food_update: "Food updated", meal: "Meal logged", reversal: "Undo",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function resourceUrl(action: AgentAction): string | null {
  if (action.status === "failed") return null;
  if (action.kind === "workout") return `/training?day=${action.resource_id}`;
  if (action.kind === "competition") return `/competitions#competition-${action.resource_id}`;
  if (action.kind === "food_create" || action.kind === "food_update") return `/nutrition?food=${action.resource_id}`;
  if (action.kind === "meal") return `/nutrition?day=${action.after?.day}&entry=${action.resource_id}`;
  if (action.kind === "nutrition_plan") return `/nutrition?competition=${action.after?.event_id}&plan=${action.resource_id}`;
  return null;
}

function stateSummary(state: Record<string, unknown> | null, kind: string): string {
  if (!state) return kind === "workout" ? "Automatic workout (no manual override)" : "No entry";
  if (kind === "workout") {
    const exercises = Array.isArray(state.exercises) ? state.exercises : [];
    return `${state.session_name || "Custom workout"}: ${exercises.map((item: any) => `${item.exercise} ${item.sets} × ${item.reps}${item.load_kg == null ? "" : ` at ${item.load_kg} kg`}`).join(", ") || "No exercises"}`;
  }
  if (kind === "competition") return `${state.name} · ${state.event_date}${state.end_date ? `–${state.end_date}` : ""} · priority ${state.priority}${state.result ? " · result recorded" : ""}`;
  if (kind === "meal") return `${state.day} · ${state.meal || "meal"} · ${state.raw_text} · ${state.kcal ?? "unknown"} kcal, ${state.protein_g ?? "unknown"} g protein, ${state.carbs_g ?? "unknown"} g carbs, ${state.fat_g ?? "unknown"} g fat`;
  if (kind.startsWith("food")) return `${state.name} · per 100 g: ${state.kcal ?? "unknown"} kcal, ${state.protein_g ?? "unknown"} g protein, ${state.carbs_g ?? "unknown"} g carbs, ${state.fat_g ?? "unknown"} g fat, ${state.fiber_g ?? "unknown"} g fiber${state.serving_size_g ? ` · ${state.serving_name || "serving"} ${state.serving_size_g} g` : ""}`;
  if (kind === "nutrition_plan") return `${state.plan_id ? `Plan #${state.plan_id}` : "Prior targets"} · ${Array.isArray(state.assignments) ? state.assignments.length : 0} dated assignments`;
  return "Recorded reversal";
}

export function AgentLogs({ open, onOpenChange, onOpenConversation }: Props) {
  const [items, setItems] = useState<AgentAction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (confirmId !== null) document.getElementById(`agent-undo-confirm-${confirmId}`)?.focus();
  }, [confirmId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.agentActions.list({ page, kind, status, start, end });
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }, [page, kind, status, start, end]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function confirmUndo(action: AgentAction) {
    setBusyId(action.id);
    setConfirmId(null);
    setError(null);
    try {
      const result = await api.agentActions.undo(action.id, `undo-${action.id}`);
      setNotice(result.status === "undone" ? `Undid ${action.summary}. Affected views will refresh when opened.` : result.status);
      window.dispatchEvent(new Event("agent-action-changed"));
    } catch (error) { setError(errorText(error)); }
    finally { setBusyId(null); await refresh(); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90svh] w-[96vw] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Agent logs</DialogTitle>
        <DialogDescription>Coach changes from this rollout. Earlier unaudited edits have no undo receipt. History stays here if a conversation is deleted.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs">Action
          <select aria-label="Action filter" className="mt-1 block h-10 w-full border border-input bg-background px-2" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}>
            <option value="">All actions</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs">Status
          <select aria-label="Status filter" className="mt-1 block h-10 w-full border border-input bg-background px-2" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>{["committed", "undone", "conflict", "missing", "failed"].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs">From date<Input type="date" value={start} onChange={event => { setStart(event.target.value); setPage(1); }} /></label>
        <label className="text-xs">Through date<Input type="date" value={end} onChange={event => { setEnd(event.target.value); setPage(1); }} /></label>
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="outline" onClick={() => void refresh()}>Retry</Button></p>}
      {loading && <p role="status" className="text-sm">Loading Agent logs…</p>}
      {!loading && items.length === 0 && !error && <p className="text-sm text-muted-foreground">No coach actions match these filters.</p>}
      <div className="space-y-3">
        {items.map(action => <article key={action.id} className="border border-border p-3 sm:p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="font-medium">{kindLabels[action.kind] || action.kind}: {action.summary}</h3><p className="text-xs text-muted-foreground">{new Date(action.created_at).toLocaleString()} · Status: {action.status}</p></div>
            <div className="flex flex-wrap gap-2">
              {resourceUrl(action) && <a className="text-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" href={resourceUrl(action)!}>Open {action.kind === "meal" ? "diary entry" : action.kind.startsWith("food") ? "food" : action.kind === "workout" ? "workout" : "competition"}</a>}
              {action.conversation_available && action.conversation_id && <button className="text-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { onOpenChange(false); onOpenConversation(action.conversation_id!); }}>Open conversation</button>}
            </div>
          </div>
          {action.conversation_id && !action.conversation_available && <p className="text-xs text-muted-foreground">Originating conversation is no longer available.</p>}
          {action.error && <p role="status" className="text-xs text-amber-500">{action.error}</p>}
          {action.kind !== "reversal" && <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="bg-muted/30 p-2"><strong>Before</strong><p className="mt-1">{stateSummary(action.before, action.kind)}</p></div>
            <div className="bg-muted/30 p-2"><strong>After</strong><p className="mt-1">{stateSummary(action.after, action.kind)}</p></div>
          </div>}
          {action.kind.startsWith("food") && <p className="text-xs text-muted-foreground">Undo changes the library entry. Historical diary snapshots stay unchanged.</p>}
          {action.kind === "meal" && <p className="text-xs text-muted-foreground">Undo removes only this entry; repeated copies stay in the diary.</p>}
              {action.kind === "nutrition_plan" && <p className="text-xs text-muted-foreground">Undo restores previous effective target assignments only when affected dates have not changed. Meal plans may need review; consumed entries remain unchanged.</p>}
              {!["undone", "failed", "reversal"].includes(action.status) && (confirmId === action.id ?
            <div className="border border-border p-3 text-sm space-y-2" role="group" aria-label={`Confirm undo of ${action.summary}`}>
              <p>Undo {action.summary}? {action.kind === "competition" ? "This removes the event if it has not changed or gained dependent plans." : "Later edits are protected."}</p>
              <div className="flex gap-2"><Button id={`agent-undo-confirm-${action.id}`} size="sm" variant="destructive" disabled={busyId !== null} onClick={() => void confirmUndo(action)}>Confirm Undo</Button><Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button></div>
            </div> : <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => setConfirmId(action.id)}>{busyId === action.id ? "Undoing…" : "Preview Undo"}</Button>)}
        </article>)}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{total} actions · Page {page} of {Math.max(1, Math.ceil(total / 20))}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * 20 >= total || loading} onClick={() => setPage(page + 1)}>Next</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
