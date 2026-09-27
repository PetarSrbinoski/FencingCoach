"use client";

import { useEffect, useState } from "react";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import { api, Competition, CompetitionInput } from "@/lib/api";
import { Card, BandPill } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Trophy, MapPin, CalendarDays, Pencil, Trash2, Plus, Swords } from "lucide-react";

const PRIORITIES = ["A", "B", "C"];
const LEVELS = ["local", "national", "FIE world cup", "FIE grand prix", "satellite"];

const empty: CompetitionInput = {
  name: "",
  location: null,
  event_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  level: null,
  priority: "A",
  notes: null,
};

type ResultDraft = { placing: string; field_size: string; pool_wins: string; pool_losses: string; elimination_outcome: string; reflection: string };
const resultKeys = ["placing", "field_size", "pool_wins", "pool_losses", "elimination_outcome", "reflection"];
function resultSummary(result: Record<string, unknown> | null) {
  if (!result) return <span className="text-muted-foreground">No result yet</span>;
  const number = (key: string) => typeof result[key] === "number" ? result[key] : null;
  const text = (key: string) => typeof result[key] === "string" ? result[key] : null;
  const legacy = Object.entries(result).filter(([key]) => !resultKeys.includes(key));
  return <div className="space-y-1 text-sm">
    <p>{number("placing") !== null ? `Place ${number("placing")}` : "Placing unknown"}{number("field_size") !== null ? ` of ${number("field_size")}` : ""}</p>
    {(number("pool_wins") !== null || number("pool_losses") !== null) && <p>Pool: {number("pool_wins") ?? "?"} wins, {number("pool_losses") ?? "?"} losses</p>}
    {text("elimination_outcome") && <p>Elimination: {text("elimination_outcome")}</p>}
    {text("reflection") && <details><summary className="cursor-pointer">Reflection</summary><p className="mt-1 whitespace-pre-wrap">{text("reflection")}</p></details>}
    {legacy.length > 0 && <details><summary className="cursor-pointer">Other saved result details</summary><dl>{legacy.map(([key, value]) => <div key={key}><dt className="font-medium">{key.replace(/_/g, " ")}</dt><dd>{String(value)}</dd></div>)}</dl></details>}
  </div>;
}

export default function CompetitionsPage() {
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  const [list, setList] = useState<Competition[]>([]);
  const [form, setForm] = useState<CompetitionInput>(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);
  const [resultTarget, setResultTarget] = useState<Competition | null>(null);
  const [clearTarget, setClearTarget] = useState<Competition | null>(null);
  const [resultDraft, setResultDraft] = useState<ResultDraft>({ placing: "", field_size: "", pool_wins: "", pool_losses: "", elimination_outcome: "", reflection: "" });
  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const { toast } = useToast();

  function refresh() {
    api.competitions.list(false).then(setList).catch((e) => setErr(e?.message));
  }
  useEffect(() => { refresh(); api.readiness.today().then(t => setToday(t.day)).catch(() => {}); }, []);
  useWorkflowRefresh(refresh);
  useEffect(() => { if (list.length && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView(); }, [list]);

  function reset() {
    setForm(empty);
    setEditingId(null);
  }

  async function submit() {
    if (!form.name.trim() || !form.event_date) return;
    if (form.end_date && form.end_date < form.event_date) { setErr("End date must be on or after the start date."); return; }
    setBusy(true);
    setErr(null);
    try {
      const body: CompetitionInput = {
        ...form,
        location: form.location || null,
        end_date: form.end_date || null,
        level: form.level || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await api.competitions.update(editingId, body);
        toast({ title: "Competition updated", variant: "success" });
      } else {
        await api.competitions.create(body);
        toast({ title: "Competition added", variant: "success" });
      }
      reset();
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: Competition) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      location: c.location,
      event_date: c.event_date,
      end_date: c.end_date,
      level: c.level,
      priority: c.priority,
      notes: c.notes,
    });
  }

  async function remove(id: number) {
    const target = list.find((c) => c.id === id) ?? null;
    setDeleteTarget(target);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.competitions.delete(deleteTarget.id);
      toast({ title: "Competition deleted", variant: "success" });
      refresh();
    } catch (e: any) {
      setErr(e?.message);
    }
  }

  function openResult(c: Competition) {
    const result = c.result || {};
    setResultTarget(c); setResultError(null);
    setResultDraft({
      placing: String(result.placing ?? ""), field_size: String(result.field_size ?? ""),
      pool_wins: String(result.pool_wins ?? ""), pool_losses: String(result.pool_losses ?? ""),
      elimination_outcome: String(result.elimination_outcome ?? ""), reflection: String(result.reflection ?? ""),
    });
  }

  async function saveResult() {
    if (!resultTarget || resultBusy) return;
    const numeric = ["placing", "field_size", "pool_wins", "pool_losses"] as const;
    const values = numeric.map(key => resultDraft[key].trim() === "" ? null : Number(resultDraft[key]));
    if (values.some((value, index) => value !== null && (!Number.isInteger(value) || value < (index < 2 ? 1 : 0))) ||
        (values[0] !== null && values[1] !== null && values[0] > values[1])) {
      setResultError("Use valid whole numbers; placing cannot exceed field size."); return;
    }
    setResultBusy(true); setResultError(null);
    try {
      await api.competitions.setResult(resultTarget.id, {
        placing: values[0], field_size: values[1], pool_wins: values[2], pool_losses: values[3],
        elimination_outcome: resultDraft.elimination_outcome.trim() || null,
        reflection: resultDraft.reflection.trim() || null,
      });
      setResultTarget(null); refresh();
      toast({ title: "Result saved", variant: "success" });
    } catch (error) { setResultError(error instanceof Error ? error.message : String(error)); }
    finally { setResultBusy(false); }
  }

  async function clearResult() {
    if (!clearTarget) return;
    try { await api.competitions.clearResult(clearTarget.id); refresh(); toast({ title: "Result cleared", variant: "success" }); }
    catch (error) { setErr(error instanceof Error ? error.message : String(error)); }
    finally { setClearTarget(null); }
  }

  const upcoming = list.filter((c) => (c.end_date || c.event_date) >= today);
  const past = list.filter((c) => (c.end_date || c.event_date) < today);

  const priorityBadge = (p: string) => {
    const variant = p === "A" ? "destructive" : p === "B" ? "secondary" : "outline";
    return <Badge variant={variant}>Priority {p}</Badge>;
  };

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          Competition calendar
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Competitions
        </h1>
        <p className="mt-4 text-sm text-muted-foreground font-mono">
          Plan events, set priorities, and track results
        </p>
        <div className="h-1 w-16 bg-accent mt-6" />
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* Add / Edit form */}
      <Card
        title={editingId ? "Edit competition" : "Add competition"}
        icon={editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Budapest GP"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Location</label>
            <Input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="City, country"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Start date</label>
            <Input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">End date</label>
            <Input
              type="date"
              value={form.end_date ?? ""}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              placeholder="End date"
            />
            {form.end_date && form.end_date < form.event_date && <p role="alert" className="text-xs text-destructive">End date must be on or after the start date.</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Level</label>
            <Select
              value={form.level ?? ""}
              onValueChange={(v) => setForm({ ...form, level: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Priority</label>
            <Select
              value={form.priority}
              onValueChange={(v) => setForm({ ...form, priority: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    Priority {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Goals, format, travel"
              rows={2}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-border">
          <Button onClick={submit} disabled={busy || !form.name.trim() || Boolean(form.end_date && form.end_date < form.event_date)}>
            {busy ? "Saving…" : editingId ? "Update" : "Add competition"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

      {resultTarget && <Card title={`${resultTarget.result ? "Edit" : "Add"} result · ${resultTarget.name}`}>
        <div className="space-y-4">
          {resultError && <p role="alert" className="text-sm text-destructive">{resultError}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([ ["placing", "Placing"], ["field_size", "Field size"], ["pool_wins", "Pool wins"], ["pool_losses", "Pool losses"] ] as const).map(([key, label]) => <label key={key} className="text-xs">{label}
              <Input type="number" min={key === "placing" || key === "field_size" ? 1 : 0} step={1} value={resultDraft[key]} onChange={event => setResultDraft({ ...resultDraft, [key]: event.target.value })} />
            </label>)}
          </div>
          <label className="text-xs block">Elimination outcome
            <Input value={resultDraft.elimination_outcome} onChange={event => setResultDraft({ ...resultDraft, elimination_outcome: event.target.value })} placeholder="e.g. Round of 32" />
          </label>
          <label className="text-xs block">Reflection
            <Textarea value={resultDraft.reflection} onChange={event => setResultDraft({ ...resultDraft, reflection: event.target.value })} placeholder="What went well? What would you change?" />
          </label>
          {resultTarget.result && Object.keys(resultTarget.result).some(key => !resultKeys.includes(key)) && <p className="text-xs text-muted-foreground">Other saved result details will be preserved.</p>}
          <div className="flex gap-2"><Button size="sm" disabled={resultBusy} onClick={saveResult}>{resultBusy ? "Saving…" : "Save result"}</Button><Button size="sm" variant="outline" disabled={resultBusy} onClick={() => setResultTarget(null)}>Cancel</Button></div>
        </div>
      </Card>}

      {/* Upcoming */}
      <Card
        title={`Upcoming (${upcoming.length})`}
        icon={<CalendarDays className="h-4 w-4" />}
      >
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
              <Swords className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">No upcoming competitions</p>
            <p className="text-muted-foreground/60 text-xs mt-1 font-mono">Add one above to start planning</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((c) => {
              const dOut = Math.round(
                (new Date(c.event_date).getTime() - new Date(today).getTime()) / 86400000
              );
              return (
                <li
                  key={c.id}
                  id={`competition-${c.id}`}
                  className="flex items-start justify-between py-4 first:pt-0 last:pb-0 gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground text-xs">
                        {c.event_date}
                      </span>
                      <Badge variant="outline">{c.event_date <= today ? "Ongoing" : `T-${dOut}d`}</Badge>
                      <BandPill band={c.priority === "A" ? "red" : c.priority === "B" ? "amber" : "green"} />
                    </div>
                    <div className="text-foreground font-semibold text-lg leading-snug">{c.name}</div>
                    {(c.location || c.level) && (
                      <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-mono">
                        {c.location && (
                          <>
                            <MapPin className="h-3 w-3" />
                            <span>{c.location}</span>
                          </>
                        )}
                        {c.location && c.level && <span className="text-border">·</span>}
                        {c.level && <span className="uppercase">{c.level}</span>}
                      </div>
                    )}
                    {c.notes && (
                      <p className="text-muted-foreground text-xs leading-relaxed">{c.notes}</p>
                    )}
                    {resultSummary(c.result)}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <a href={`/nutrition?competition=${c.id}`} className="inline-flex items-center text-xs underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Plan nutrition</a>
                    <Button size="sm" variant="outline" onClick={() => openResult(c)}>{c.result ? "Edit result" : "Add result"}</Button>
                    <Button variant="ghost" size="icon" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(c.id)}
                      className="hover:text-accent hover:bg-accent/10"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Past */}
      <Card title={`Past (${past.length})`} icon={<Trophy className="h-4 w-4" />}>
        {past.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-12 w-12 border border-dashed border-border flex items-center justify-center mb-3">
              <Trophy className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">No past competitions yet</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {past
                .slice()
                .reverse()
                .map((c) => (
                  <TableRow key={c.id} id={`competition-${c.id}`}>
                    <TableCell className="font-mono text-muted-foreground text-sm">
                      {c.event_date}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{priorityBadge(c.priority)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {resultSummary(c.result)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <a href={`/nutrition?competition=${c.id}`} className="inline-flex items-center text-xs underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Plan nutrition</a>
                        <Button size="sm" variant="outline" onClick={() => openResult(c)}>{c.result ? "Edit result" : "Add result"}</Button>
                        {c.result && <Button size="sm" variant="ghost" onClick={() => setClearTarget(c)}>Clear result</Button>}
                        <Button variant="ghost" size="icon" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(c.id)}
                          className="hover:text-accent hover:bg-accent/10"
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete competition?"
        description={
          deleteTarget
            ? `This will permanently remove "${deleteTarget.name}". This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog open={clearTarget !== null} onOpenChange={open => { if (!open) setClearTarget(null); }} title="Clear competition result?" description="The event will remain on your calendar." confirmLabel="Clear result" onConfirm={() => { void clearResult(); }} />
    </div>
  );
}
