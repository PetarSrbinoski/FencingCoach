"use client";

import { PageHeading } from "@/components/page-heading";

import {
  Editor,
  ErrorNotice,
  ReadMore,
  useView,
  ViewTabs,
} from "@/components/mobile-ui";
import { Card } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api, Competition, CompetitionInput } from "@/lib/api";
import { useWorkflowRefresh } from "@/lib/workflow-refresh";
import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";

const PRIORITIES = ["A", "B", "C"];
const LEVELS = [
  "local",
  "national",
  "FIE world cup",
  "FIE grand prix",
  "satellite",
];

const empty: CompetitionInput = {
  name: "",
  location: null,
  event_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  level: null,
  priority: "A",
  notes: null,
};

type ResultDraft = {
  placing: string;
  field_size: string;
  pool_wins: string;
  pool_losses: string;
  elimination_outcome: string;
  reflection: string;
};
const resultKeys = [
  "placing",
  "field_size",
  "pool_wins",
  "pool_losses",
  "elimination_outcome",
  "reflection",
];
function resultSummary(result: Record<string, unknown> | null) {
  if (!result)
    return <span className="text-muted-foreground">No result yet</span>;
  const number = (key: string) =>
    typeof result[key] === "number" ? result[key] : null;
  const text = (key: string) =>
    typeof result[key] === "string" ? result[key] : null;
  const legacy = Object.entries(result).filter(
    ([key]) => !resultKeys.includes(key),
  );
  return (
    <div className="space-y-1 text-sm">
      <p>
        {number("placing") !== null
          ? `Place ${number("placing")}`
          : "Placing unknown"}
        {number("field_size") !== null ? ` of ${number("field_size")}` : ""}
      </p>
      {(number("pool_wins") !== null || number("pool_losses") !== null) && (
        <p>
          Pool: {number("pool_wins") ?? "?"} wins,{" "}
          {number("pool_losses") ?? "?"} losses
        </p>
      )}
      {text("elimination_outcome") && (
        <p>Elimination: {text("elimination_outcome")}</p>
      )}
      {text("reflection") && (
        <details>
          <summary className="cursor-pointer">Reflection</summary>
          <p className="mt-1 whitespace-pre-wrap">{text("reflection")}</p>
        </details>
      )}
      {legacy.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Other saved result details
          </summary>
          <dl>
            {legacy.map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium">{key.replace(/_/g, " ")}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

export default function CompetitionsPage() {
  const [view, setView] = useView(["upcoming", "past"] as const, "upcoming");
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [list, setList] = useState<Competition[]>([]);
  const [form, setForm] = useState<CompetitionInput>(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);
  const [resultTarget, setResultTarget] = useState<Competition | null>(null);
  const [clearTarget, setClearTarget] = useState<Competition | null>(null);
  const [resultDraft, setResultDraft] = useState<ResultDraft>({
    placing: "",
    field_size: "",
    pool_wins: "",
    pool_losses: "",
    elimination_outcome: "",
    reflection: "",
  });
  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const { toast } = useToast();

  function refresh() {
    setErr(null);
    setLoading(true);
    api.competitions
      .list(false)
      .then(setList)
      .catch((e) => setErr(e?.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    refresh();
    api.readiness
      .today()
      .then((t) => setToday(t.day))
      .catch(() => {});
  }, []);
  useWorkflowRefresh(refresh);
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !list.length) return;
    const event = list.find((item) => `competition-${item.id}` === id);
    if (event)
      setView(
        (event.end_date || event.event_date) < today ? "past" : "upcoming",
      );
    // The selected list must render before resolving its anchor.
    const timer = window.setTimeout(
      () => document.getElementById(id)?.scrollIntoView({ block: "center" }),
      100,
    );
    return () => window.clearTimeout(timer);
    // URL selection runs when the requested records arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, today]);

  function reset() {
    setForm(empty);
    setEditingId(null);
  }

  async function submit() {
    if (!form.name.trim() || !form.event_date) return;
    if (form.end_date && form.end_date < form.event_date) {
      setErr("End date must be on or after the start date.");
      return;
    }
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
      setEditorOpen(false);
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: Competition) {
    setEditorOpen(true);
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
      throw e;
    }
  }

  function openResult(c: Competition) {
    const result = c.result || {};
    setResultTarget(c);
    setResultError(null);
    setResultDraft({
      placing: String(result.placing ?? ""),
      field_size: String(result.field_size ?? ""),
      pool_wins: String(result.pool_wins ?? ""),
      pool_losses: String(result.pool_losses ?? ""),
      elimination_outcome: String(result.elimination_outcome ?? ""),
      reflection: String(result.reflection ?? ""),
    });
  }

  async function saveResult() {
    if (!resultTarget || resultBusy) return;
    const numeric = [
      "placing",
      "field_size",
      "pool_wins",
      "pool_losses",
    ] as const;
    const values = numeric.map((key) =>
      resultDraft[key].trim() === "" ? null : Number(resultDraft[key]),
    );
    if (
      values.some(
        (value, index) =>
          value !== null &&
          (!Number.isInteger(value) || value < (index < 2 ? 1 : 0)),
      ) ||
      (values[0] !== null && values[1] !== null && values[0] > values[1])
    ) {
      setResultError(
        "Use valid whole numbers; placing cannot exceed field size.",
      );
      return;
    }
    setResultBusy(true);
    setResultError(null);
    try {
      await api.competitions.setResult(resultTarget.id, {
        placing: values[0],
        field_size: values[1],
        pool_wins: values[2],
        pool_losses: values[3],
        elimination_outcome: resultDraft.elimination_outcome.trim() || null,
        reflection: resultDraft.reflection.trim() || null,
      });
      setResultTarget(null);
      refresh();
      toast({ title: "Result saved", variant: "success" });
    } catch (error) {
      setResultError(error instanceof Error ? error.message : String(error));
    } finally {
      setResultBusy(false);
    }
  }

  async function clearResult() {
    if (!clearTarget) return;
    try {
      await api.competitions.clearResult(clearTarget.id);
      refresh();
      toast({ title: "Result cleared", variant: "success" });
    } catch (error) {
      throw error;
    }
  }

  const upcoming = list.filter((c) => (c.end_date || c.event_date) >= today);
  const past = list.filter((c) => (c.end_date || c.event_date) < today);

  const priorityBadge = (p: string) => {
    const variant =
      p === "A" ? "destructive" : p === "B" ? "secondary" : "outline";
    return <Badge variant={variant}>Priority {p}</Badge>;
  };

  function eventCard(c: Competition) {
    const dOut = Math.round(
      (new Date(c.event_date).getTime() - new Date(today).getTime()) / 86400000,
    );
    return (
      <article
        key={c.id}
        id={`competition-${c.id}`}
        className="event-card scroll-mt-6 rounded-lg border border-border bg-card p-4 sm:p-5 space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">
              {c.event_date}
              {c.end_date && c.end_date !== c.event_date
                ? ` – ${c.end_date}`
                : ""}
            </p>
            <h2 className="text-lg font-semibold break-words">{c.name}</h2>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Actions for ${c.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => startEdit(c)}>
                Edit competition
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openResult(c)}>
                {c.result ? "Edit result" : "Add result"}
              </DropdownMenuItem>
              {c.result && (
                <DropdownMenuItem onClick={() => setClearTarget(c)}>
                  Clear result
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => void remove(c.id)}
              >
                Delete competition
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap gap-2">
          {priorityBadge(c.priority)}
          {(c.end_date || c.event_date) >= today && (
            <Badge variant="outline">
              {dOut <= 0 ? "Ongoing" : `In ${dOut} days`}
            </Badge>
          )}
        </div>
        {(c.location || c.level) && (
          <p className="text-sm text-muted-foreground break-words">
            {[c.location, c.level].filter(Boolean).join(" · ")}
          </p>
        )}
        {c.notes && (
          <ReadMore
            label="Read event notes"
            className="text-sm text-muted-foreground"
          >
            {c.notes}
          </ReadMore>
        )}
        {view === "past" && resultSummary(c.result)}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/nutrition?view=plans&competition=${c.id}`}>
              {view === "past" ? "Nutrition history" : "Plan nutrition"}
            </a>
          </Button>
          {view === "past" && (
            <Button size="sm" variant="outline" onClick={() => openResult(c)}>
              {c.result ? "Edit result" : "Add result"}
            </Button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <PageHeading title="Competitions" eyebrow="Competition calendar" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          label="Competition views"
          value={view}
          onChange={setView}
          items={[
            { value: "upcoming", label: `Upcoming (${upcoming.length})` },
            { value: "past", label: `Past (${past.length})` },
          ]}
        />
        <Button
          onClick={() => {
            reset();
            setErr(null);
            setEditorOpen(true);
          }}
        >
          <Plus />
          Add competition
        </Button>
      </div>
      {err && !editorOpen && <ErrorNotice message={err} retry={refresh} />}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading competitions…
        </p>
      ) : (view === "upcoming" ? upcoming : past.slice().reverse()).length ===
        0 ? (
        <Card
          title={
            view === "upcoming"
              ? "No upcoming competitions"
              : "No past competitions"
          }
        >
          <p className="text-sm text-muted-foreground">
            {view === "upcoming"
              ? "Add an event to start preparing."
              : "Completed events and results will appear here."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {(view === "upcoming" ? upcoming : past.slice().reverse()).map(
            eventCard,
          )}
        </div>
      )}

      {/* Add / Edit form */}
      <Editor
        open={editorOpen}
        onOpenChange={(open) => {
          if (!busy) setEditorOpen(open);
        }}
        title={editingId ? "Edit competition" : "Add competition"}
        description="Name, dates, and priority define your event. Other details are optional."
      >
        {err && <ErrorNotice message={err} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="event-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="event-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Budapest GP"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-location" className="text-sm font-medium">
              Location
            </label>
            <Input
              id="event-location"
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="City, country"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-date" className="text-sm font-medium">
              Start date
            </label>
            <Input
              id="event-date"
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-end" className="text-sm font-medium">
              End date
            </label>
            <Input
              id="event-end"
              type="date"
              value={form.end_date ?? ""}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              placeholder="End date"
            />
            {form.end_date && form.end_date < form.event_date && (
              <p role="alert" className="text-xs text-destructive">
                End date must be on or after the start date.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-level" className="text-sm font-medium">
              Level
            </label>
            <Select
              value={form.level ?? ""}
              onValueChange={(v) => setForm({ ...form, level: v || null })}
            >
              <SelectTrigger id="event-level">
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
            <label htmlFor="event-priority" className="text-sm font-medium">
              Priority
            </label>
            <Select
              value={form.priority}
              onValueChange={(v) => setForm({ ...form, priority: v })}
            >
              <SelectTrigger id="event-priority">
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
            <label htmlFor="event-notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea
              id="event-notes"
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Goals, format, travel"
              rows={2}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-border">
          <Button
            onClick={submit}
            disabled={
              busy ||
              !form.name.trim() ||
              Boolean(form.end_date && form.end_date < form.event_date)
            }
          >
            {busy ? "Saving…" : editingId ? "Update" : "Add competition"}
          </Button>
          {editingId && (
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setEditorOpen(false);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </Editor>

      {resultTarget && (
        <Editor
          open
          onOpenChange={(open) => {
            if (!open && !resultBusy) setResultTarget(null);
          }}
          title={`${resultTarget.result ? "Edit" : "Add"} result · ${resultTarget.name}`}
        >
          <div className="space-y-4">
            {resultError && (
              <p role="alert" className="text-sm text-destructive">
                {resultError}
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  ["placing", "Placing"],
                  ["field_size", "Field size"],
                  ["pool_wins", "Pool wins"],
                  ["pool_losses", "Pool losses"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs">
                  {label}
                  <Input
                    type="number"
                    min={key === "placing" || key === "field_size" ? 1 : 0}
                    step={1}
                    value={resultDraft[key]}
                    onChange={(event) =>
                      setResultDraft({
                        ...resultDraft,
                        [key]: event.target.value,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="text-xs block">
              Elimination outcome
              <Input
                value={resultDraft.elimination_outcome}
                onChange={(event) =>
                  setResultDraft({
                    ...resultDraft,
                    elimination_outcome: event.target.value,
                  })
                }
                placeholder="e.g. Round of 32"
              />
            </label>
            <label className="text-xs block">
              Reflection
              <Textarea
                value={resultDraft.reflection}
                onChange={(event) =>
                  setResultDraft({
                    ...resultDraft,
                    reflection: event.target.value,
                  })
                }
                placeholder="What went well? What would you change?"
              />
            </label>
            {resultTarget.result &&
              Object.keys(resultTarget.result).some(
                (key) => !resultKeys.includes(key),
              ) && (
                <p className="text-xs text-muted-foreground">
                  Other saved result details will be preserved.
                </p>
              )}
            <div className="flex gap-2">
              <Button size="sm" disabled={resultBusy} onClick={saveResult}>
                {resultBusy ? "Saving…" : "Save result"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={resultBusy}
                onClick={() => setResultTarget(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Editor>
      )}

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
      <ConfirmDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null);
        }}
        title="Clear competition result?"
        description="The event will remain on your calendar."
        confirmLabel="Clear result"
        onConfirm={clearResult}
      />
    </div>
  );
}
