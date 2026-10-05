"use client";

import { AgentLogs } from "@/components/agent-logs";
import { Editor } from "@/components/mobile-ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type CoachMemory, type CoachMemoryList } from "@/lib/api";
import { randomUUID } from "@/lib/uuid";
import { announceWorkflowChange, useWorkflowRefresh } from "@/lib/workflow-refresh";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet confirmed";

export default function CoachMemoryPage() {
  const router = useRouter();
  const [data, setData] = useState<CoachMemoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const loadSequence = useRef(0);
  const [editor, setEditor] = useState(false);
  const [editing, setEditing] = useState<CoachMemory | null>(null);
  const [content, setContent] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<CoachMemory | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const requests = useRef(new Map<string, string>());
  function requestId(key: string) {
    if (!requests.current.has(key)) requests.current.set(key, randomUUID());
    return requests.current.get(key)!;
  }

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const result = await api.coachMemory.list();
      if (sequence !== loadSequence.current) return false;
      setData(result);
      setError("");
      return true;
    } catch (failure) {
      if (sequence === loadSequence.current) setError(errorText(failure));
      return false;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useWorkflowRefresh(() => void refresh());

  function openEditor(memory: CoachMemory | null) {
    setEditing(memory);
    setContent(memory?.content || "");
    setExpiresOn(memory?.expires_on || "");
    setFormError("");
    setEditor(true);
  }

  async function save() {
    if (busy) return;
    if (!content.trim()) { setFormError("Enter a memory before saving."); return; }
    setBusy(true);
    setFormError("");
    const body = { content: content.trim(), expires_on: expiresOn || null };
    const key = JSON.stringify(["save", editing?.id, editing?.revision, body]);
    try {
      if (editing) await api.coachMemory.edit(editing.id, {
        ...body, expected_revision: editing.revision, request_id: requestId(key),
      });
      else await api.coachMemory.create({ ...body, request_id: requestId(key) });
      requests.current.delete(key);
      setEditor(false);
      setNotice("Memory saved. You can review or undo this change in Agent logs.");
      announceWorkflowChange();
    } catch (failure) { setFormError(errorText(failure)); }
    finally { setBusy(false); }
  }

  async function confirm(memory: CoachMemory) {
    setBusy(true);
    try {
      await api.coachMemory.confirm(memory.id, {
        expected_revision: memory.revision,
        request_id: requestId(`confirm:${memory.id}:${memory.revision}`),
      });
      setNotice("Memory confirmed.");
      announceWorkflowChange();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  async function toggle(enabled: boolean) {
    setBusy(true);
    setPendingEnabled(enabled);
    ++loadSequence.current;
    try {
      const result = await api.coachMemory.setEnabled(enabled);
      ++loadSequence.current;
      setData(result);
      setNotice(enabled ? "Coach memory enabled." : "Coach memory disabled.");
      announceWorkflowChange();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); setPendingEnabled(null); }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-8">
      <header className="space-y-3">
        <Link href="/chat" className="text-sm underline underline-offset-4">Back to Coach</Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What my coach knows</h1>
        <p className="text-sm text-muted-foreground">Preferences, equipment, time limits and guidance you want your coach to remember.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openEditor(null)} disabled={!data || busy}>Add memory</Button>
          <Button variant="outline" onClick={() => setLogsOpen(true)}>Agent logs</Button>
        </div>
      </header>
      {data && <section className="border border-border bg-card p-4 space-y-2">
        <label className="flex min-h-11 items-center gap-3 font-medium">
          <input type="checkbox" className="h-5 w-5 accent-accent" checked={pendingEnabled ?? data.enabled}
            disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
          Use coach memory
        </label>
        <p className="text-sm text-muted-foreground">{data.enabled
          ? "Current memories personalize coaching. Expired memories stay visible here."
          : "Stored memories are excluded from coaching and automatic memory updates are paused. You can still manage entries here."}</p>
        <p className="text-sm text-muted-foreground">Profile dietary restrictions always apply. Conflicting information needs clarification.</p>
      </section>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <div role="alert" className="text-sm text-destructive space-y-2">
        <p>{error}</p><Button variant="outline" onClick={() => void refresh()}>Reload memories</Button>
      </div>}
      {loading && <p role="status">Loading memories…</p>}
      {!loading && data?.items.length === 0 && <p className="text-muted-foreground">No memories yet.</p>}
      <div className="space-y-3">
        {data?.items.map((memory) => <article key={memory.id} id={`memory-${memory.id}`} className="border border-border bg-card p-4 space-y-3 break-words">
          <p className="whitespace-pre-wrap font-medium">{memory.content}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{memory.provenance === "inferred" ? "Inferred" : "Explicit"}</span>
            <span>{memory.last_confirmed_at ? "Confirmed by you" : "Unconfirmed"}</span>
            <span>{memory.expired ? "Expired · inactive" : memory.active ? "Active" : "Memory use disabled · inactive"}</span>
          </div>
          <p className="text-sm">{memory.expires_on ? `Last active date: ${memory.expires_on} (${data.timezone})` : "No expiration"}</p>
          <details className="text-sm space-y-2">
            <summary className="cursor-pointer py-2">Source and history</summary>
            <p>{memory.source.label}</p>
            {memory.source.excerpt && <blockquote className="border-l-2 border-border pl-3">{memory.source.excerpt}</blockquote>}
            {memory.source.conversation_id && <p className="text-xs text-muted-foreground">Conversation #{memory.source.conversation_id} · Athlete message #{memory.source.message_id}. Source details are retained if the conversation is removed.</p>}
            {memory.source.last_update && <p>Latest correction: {memory.source.last_update.label}{memory.source.last_update.excerpt ? ` — ${memory.source.last_update.excerpt}` : ""}</p>}
            <dl className="grid gap-1 text-xs text-muted-foreground">
              <div><dt className="inline font-medium">Created: </dt><dd className="inline">{timestamp(memory.created_at)}</dd></div>
              <div><dt className="inline font-medium">Updated: </dt><dd className="inline">{timestamp(memory.updated_at)}</dd></div>
              <div><dt className="inline font-medium">Last confirmed: </dt><dd className="inline">{timestamp(memory.last_confirmed_at)}</dd></div>
              <div><dt className="inline font-medium">Revision: </dt><dd className="inline break-all">{memory.revision}</dd></div>
            </dl>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => openEditor(memory)}>Edit</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void confirm(memory)}>Confirm</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(memory)}>Delete</Button>
          </div>
        </article>)}
      </div>
      <Editor open={editor} onOpenChange={(open) => { if (!busy) setEditor(open); }} title={editing ? "Edit memory" : "Add memory"}
        description="Your edits confirm the current content. Original provenance remains visible.">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="space-y-2">
            <label htmlFor="memory-content" className="text-sm font-medium">Memory content</label>
            <Textarea id="memory-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={1000} required rows={4} disabled={busy} />
          </div>
          <div className="space-y-2">
            <label htmlFor="memory-expiry" className="text-sm font-medium">Last active date</label>
            <Input id="memory-expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} disabled={busy} />
            <p className="text-xs text-muted-foreground">Optional. Active through this date in {data?.timezone}; inactive from the next day.</p>
          </div>
          {formError && <div role="alert" className="text-sm text-destructive space-y-2"><p>{formError}</p>
            {formError.startsWith("409:") && <Button type="button" variant="outline" onClick={async () => {
              if (await refresh()) {
                setEditor(false);
                setNotice("Memories reloaded. Open the current entry to review and edit it.");
              } else {
                setFormError("409: Reload failed. Your edit is preserved. Try Reload and review again.");
              }
            }}>Reload and review</Button>}
          </div>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save memory"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(false)}>Cancel</Button>
          </div>
        </form>
      </Editor>
      <ConfirmDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Delete memory?" confirmLabel="Delete memory"
        description="This removes the memory from coaching. Existing conversations and Agent log receipts remain separate records. You can undo this deletion from Agent logs."
        onConfirm={async () => {
          if (!deleting) return;
          await api.coachMemory.delete(deleting.id, { expected_revision: deleting.revision,
            request_id: requestId(`delete:${deleting.id}:${deleting.revision}`) });
          setNotice("Memory deleted."); announceWorkflowChange();
        }} />
      <AgentLogs open={logsOpen} onOpenChange={setLogsOpen} onOpenConversation={(id) => router.push(`/chat?conversation=${id}`)} />
    </div>
  );
}
