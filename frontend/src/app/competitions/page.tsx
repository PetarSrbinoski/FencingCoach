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
      } else {
        await api.competitions.create(body);
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
    if (!confirm("Delete this competition?")) return;
    try {
      await api.competitions.delete(id);
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
    <div className="space-y-6 md:space-y-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b-4 border-foreground pb-4">
        <div className="flex items-center justify-center h-10 w-10 border-2 border-foreground bg-bauhaus-yellow shadow-hard-sm">
          <Trophy className="h-5 w-5 text-foreground" />
        </div>
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Competitions</h1>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1 font-mono">Manage your competition calendar</p>
        </div>
      </div>

      {/* Add / Edit form */}
      <Card
        title={editingId ? "Edit Competition" : "Add Competition"}
        icon={editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name (e.g. Budapest GP)"
          />
          <Input
            value={form.location ?? ""}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Location"
          />
          <div className="space-y-1">
            <label className="text-2xs font-bold text-foreground uppercase tracking-wider">Start Date</label>
            <Input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-2xs font-bold text-foreground uppercase tracking-wider">End Date</label>
            <Input
              type="date"
              value={form.end_date ?? ""}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              placeholder="End date"
            />
          </div>
          <Select
            value={form.level ?? ""}
            onValueChange={(v) => setForm({ ...form, level: v || null })}
          >
            <SelectTrigger>
              <SelectValue placeholder="— level —" />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (goals, format, travel)"
            rows={2}
            className="sm:col-span-2"
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t-2 border-foreground/10">
          <Button onClick={submit} disabled={busy || !form.name.trim()}>
            {busy ? "..." : editingId ? "UPDATE" : "ADD COMPETITION"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={reset}>
              CANCEL
            </Button>
          )}
        </div>
        {err && (
          <div className="border-2 border-bauhaus-red bg-bauhaus-red/5 px-3 py-2 mt-3">
            <p className="text-bauhaus-red text-sm font-bold">{err}</p>
          </div>
        )}
      </Card>

      {/* Upcoming */}
      <Card
        title={`Upcoming (${upcoming.length})`}
        icon={<CalendarDays className="h-4 w-4" />}
      >
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
              <Swords className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No upcoming competitions</p>
            <p className="text-muted-foreground text-xs mt-1 font-mono">Add one above to start planning</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((c) => {
              const dOut = Math.round(
                (new Date(c.event_date).getTime() - new Date(today).getTime()) / 86400000
              );
              return (
                <li
                  key={c.id}
                  className="flex items-start justify-between border-2 border-foreground bg-card p-4 shadow-hard-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hard"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground text-xs font-bold">
                        {c.event_date}
                      </span>
                      <Badge variant="outline" className="text-2xs font-bold">
                        T-{dOut}d
                      </Badge>
                      <BandPill band={c.priority === "A" ? "red" : c.priority === "B" ? "amber" : "green"} />
                    </div>
                    <div className="text-foreground font-bold text-lg">{c.name}</div>
                    {(c.location || c.level) && (
                      <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-mono">
                        {c.location && (
                          <>
                            <MapPin className="h-3 w-3" />
                            <span>{c.location}</span>
                          </>
                        )}
                        {c.location && c.level && <span className="text-foreground/20">|</span>}
                        {c.level && <span className="uppercase font-bold">{c.level}</span>}
                      </div>
                    )}
                    {c.notes && (
                      <p className="text-muted-foreground text-xs leading-relaxed">{c.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 ml-3">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c.id)} className="hover:text-bauhaus-red hover:bg-bauhaus-red/10">
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
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
              <Trophy className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No past competitions</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <Table>
            <TableHeader>
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
                    <TableCell className="font-mono text-muted-foreground text-sm font-bold">
                      {c.event_date}
                    </TableCell>
                    <TableCell className="font-bold">{c.name}</TableCell>
                    <TableCell>{priorityBadge(c.priority)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.result ? JSON.stringify(c.result) : (
                        <span className="text-muted-foreground">no result</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(c.id)} className="hover:text-bauhaus-red hover:bg-bauhaus-red/10">
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
    </div>
  );
}
