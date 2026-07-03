"use client";

import { useEffect, useState } from "react";
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

export default function CompetitionsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [list, setList] = useState<Competition[]>([]);
  const [form, setForm] = useState<CompetitionInput>(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);
  const { toast } = useToast();

  function refresh() {
    api.competitions.list(false).then(setList).catch((e) => setErr(e?.message));
  }
  useEffect(refresh, []);

  function reset() {
    setForm(empty);
    setEditingId(null);
  }

  async function submit() {
    if (!form.name.trim() || !form.event_date) return;
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

  const upcoming = list.filter((c) => c.event_date >= today);
  const past = list.filter((c) => c.event_date < today);

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
          <Button onClick={submit} disabled={busy || !form.name.trim()}>
            {busy ? "Saving…" : editingId ? "Update" : "Add competition"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

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
                  className="flex items-start justify-between py-4 first:pt-0 last:pb-0 gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground text-xs">
                        {c.event_date}
                      </span>
                      <Badge variant="outline">T-{dOut}d</Badge>
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
                  </div>
                  <div className="flex gap-1 shrink-0">
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
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-muted-foreground text-sm">
                      {c.event_date}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{priorityBadge(c.priority)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.result ? JSON.stringify(c.result) : (
                        <span className="text-muted-foreground">no result</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
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
    </div>
  );
}
