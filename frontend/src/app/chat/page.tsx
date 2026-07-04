"use client";

import { useEffect, useRef, useState } from "react";
import { api, type CoachConversationSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  ChevronDown,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Send,
  Square,
  Sword,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";

type Msg = {
  role: "user" | "assistant";
  content: string;
  contextSnapshot?: string | null;
  ungroundedClaims?: string[];
};

function conversationLabel(conversation: CoachConversationSummary) {
  return conversation.title?.trim() || conversation.last_message_preview?.trim() || "Untitled chat";
}

function relativeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const diffHours = Math.abs(now.getTime() - date.getTime()) / 36e5;
  if (diffHours < 24) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [conversations, setConversations] = useState<CoachConversationSummary[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    const pending = sessionStorage.getItem("pendingChatMessage");
    if (pending) sessionStorage.removeItem("pendingChatMessage");
    (async () => {
      await loadConversations();
      if (pending) {
        startNewConversation();
        send(pending);
      }
    })();
  }, []);

  async function loadConversations(selectId?: number) {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await api.chatConversations.list();
      setConversations(list);

      const targetId = selectId ?? conversationId;
      if (targetId && list.some((conversation) => conversation.id === targetId)) {
        await openConversation(targetId, list);
      } else if (!targetId && list.length > 0) {
        await openConversation(list[0].id, list);
      } else if (list.length === 0) {
        startNewConversation();
      }
    } catch (e: any) {
      setHistoryError(e?.message ?? "Failed to load chat history");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function openConversation(id: number, nextList = conversations) {
    setErr(null);
    const conversation = await api.chatConversations.get(id);
    setConversationId(conversation.id);
    setMessages(conversation.messages.map((message) => ({ role: message.role, content: message.content })));
    if (!nextList.some((entry) => entry.id === id)) {
      setConversations((current) => current);
    }
  }

  function startNewConversation() {
    setConversationId(undefined);
    setMessages([]);
    setInput("");
    setErr(null);
    setHistoryOpen(false);
  }

  async function send(overrideText?: string) {
    const content = (overrideText ?? input).trim();
    if (!content || busy) return;

    setMessages((current) => [
      ...current,
      { role: "user", content },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);
    setErr(null);

    const controller = new AbortController();
    abortRef.current = controller;

    let finalConversationId: number | undefined = conversationId;

    try {
      await api.chatStream(
        content,
        conversationId,
        true,
        {
          onStart: (convId) => {
            finalConversationId = convId;
            setConversationId(convId);
          },
          onDelta: (delta) => {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + delta };
              return next;
            });
          },
          onDone: (frame) => {
            finalConversationId = frame.conversation_id;
            setConversationId(frame.conversation_id);
            setMessages((current) => {
              const next = [...current];
              next[next.length - 1] = {
                role: "assistant",
                content: frame.reply,
                contextSnapshot: frame.context_snapshot,
                ungroundedClaims: frame.ungrounded_claims,
              };
              return next;
            });
          },
          onError: (message) => {
            setErr(message);
            setMessages((current) => current.slice(0, -1));
          },
        },
        controller.signal
      );
      if (finalConversationId) await loadConversations(finalConversationId);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // User-initiated cancel — keep whatever partial reply had
        // already streamed in instead of rolling it back like a real
        // error, and drop the empty placeholder if nothing arrived yet.
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.role === "assistant" && !last.content) return current.slice(0, -1);
          return current;
        });
      } else {
        setMessages((current) => current.slice(0, -2));
        setInput(content);
        setErr(e?.message ?? "Chat failed");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function cancelSend() {
    abortRef.current?.abort();
  }

  async function removeConversation(id: number) {
    const isActive = conversationId === id;
    setErr(null);
    try {
      await api.chatConversations.delete(id);
      const nextList = conversations.filter((conversation) => conversation.id !== id);
      setConversations(nextList);

      if (isActive) {
        if (nextList.length > 0) {
          await openConversation(nextList[0].id, nextList);
        } else {
          startNewConversation();
        }
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete conversation");
    }
  }

  function selectConversation(id: number) {
    setHistoryOpen(false);
    void openConversation(id);
  }

  function renderConversationList() {
    return (
      <div className="p-2">
        {loadingHistory && (
          <div className="px-3 py-4 text-xs font-mono text-muted-foreground">Loading history…</div>
        )}

        {!loadingHistory && historyError && (
          <div className="border border-accent/30 bg-accent/5 px-3 py-3 m-2">
            <p className="text-xs text-accent">{historyError}</p>
          </div>
        )}

        {!loadingHistory && !historyError && conversations.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No saved chats</p>
            <p className="text-[11px] text-muted-foreground mt-2">Your coach history will appear here.</p>
          </div>
        )}

        {!loadingHistory && !historyError && conversations.map((conversation) => {
          const active = conversation.id === conversationId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group border border-transparent px-3 py-3 transition-colors duration-150",
                active ? "border-border bg-muted/40" : "hover:bg-muted/20"
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-sm font-medium leading-tight text-foreground truncate">
                    {conversationLabel(conversation)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                    <span>{conversation.message_count} msgs</span>
                    <span>·</span>
                    <span>{relativeDate(conversation.updated_at)}</span>
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="Conversation actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => removeConversation(conversation.id)} className="text-accent focus:text-accent">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100svh-8rem)] flex-col gap-5 overflow-hidden md:gap-6">
      <header className="border-b border-border pb-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2 font-mono">
              Coach chat
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter leading-none">Coach</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Continue a saved conversation or start a fresh one
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="lg:hidden">
                  <MessageCircle className="h-4 w-4" />
                  History
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85svh] max-w-[95vw] overflow-hidden p-0 sm:max-w-[560px]">
                <DialogHeader className="border-b border-border px-4 py-4 text-left">
                  <DialogTitle>Chat history</DialogTitle>
                  <DialogDescription>Saved coach conversations</DialogDescription>
                </DialogHeader>
                <div className="max-h-[calc(85svh-5rem)] overflow-y-auto">
                  {renderConversationList()}
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={startNewConversation}>
              <PencilLine className="h-4 w-4" />
              New chat
            </Button>
          </div>
        </div>
      </header>

      <div className="grid flex-1 min-h-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border border-border bg-card min-h-[220px] lg:flex lg:flex-col lg:h-full lg:min-h-0">
          <div className="border-b border-border px-4 py-3.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-foreground">Chat history</p>
            <p className="text-[11px] text-muted-foreground mt-1">Saved coach conversations</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {renderConversationList()}
          </div>
        </aside>

        <div className="flex h-full min-h-0 flex-col border border-border bg-card overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 overscroll-contain">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="h-14 w-14 border border-border flex items-center justify-center mb-4">
                  <MessageCircle className="h-6 w-6 text-accent" strokeWidth={1.5} />
                </div>
                <p className="text-lg font-semibold tracking-tight text-foreground">Your AI fencing coach</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
                  Ask about training, nutrition, peaking, technique, recovery, or competition prep.
                </p>
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              if (!isUser && m.content === "" && i === messages.length - 1 && busy) {
                // The typing-dots indicator below covers this case.
                return null;
              }
              return (
                <div key={`${m.role}-${i}-${m.content.slice(0, 24)}`} className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
                  <div className={cn("flex items-end gap-2.5", isUser && "flex-row-reverse")}>
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center border border-border",
                        isUser ? "bg-foreground text-background" : "bg-accent/10 text-accent"
                      )}
                    >
                      {isUser ? <User className="h-4 w-4" /> : <Sword className="h-4 w-4" />}
                    </div>
                    <div
                      className={cn(
                        "max-w-[85%] sm:max-w-[75%] px-4 py-3 text-sm leading-relaxed border",
                        isUser
                          ? "whitespace-pre-wrap bg-foreground text-background border-foreground"
                          : "bg-transparent border-border text-foreground"
                      )}
                    >
                      {isUser ? m.content : <Markdown>{m.content}</Markdown>}
                    </div>
                  </div>

                  {!isUser && (m.ungroundedClaims?.length || m.contextSnapshot) && (
                    <div className="max-w-[85%] sm:max-w-[75%] ml-[42px] space-y-1.5">
                      {m.ungroundedClaims && m.ungroundedClaims.length > 0 && (
                        <div className="flex items-start gap-1.5 border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                          <p className="text-[11px] text-amber-400 leading-snug">
                            Double-check: this reply cites a number that doesn&rsquo;t
                            appear in your recent data — {m.ungroundedClaims[0]}
                          </p>
                        </div>
                      )}
                      {m.contextSnapshot && (
                        <details className="group">
                          <summary className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground cursor-pointer select-none">
                            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                            What the coach saw
                          </summary>
                          <pre className="mt-1.5 whitespace-pre-wrap text-[10px] font-mono text-muted-foreground bg-muted/40 border border-border p-2.5 max-h-64 overflow-auto">
                            {m.contextSnapshot}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {busy && !messages[messages.length - 1]?.content && (
              <div className="flex items-end gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-accent/10 text-accent">
                  <Sword className="h-4 w-4" />
                </div>
                <div className="border border-border px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            {err && (
              <div className="flex justify-center">
                <div className="border border-accent/30 bg-accent/5 px-4 py-2.5">
                  <p className="text-sm text-accent">{err}</p>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-3 sm:p-4 bg-muted/20 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Should I skip gym today?"
                disabled={busy}
                aria-label="Message the coach"
                className="flex-1 h-11 sm:h-10 text-base sm:text-sm"
              />
              <Button
                type={busy ? "button" : "submit"}
                size="icon"
                disabled={!busy && !input.trim()}
                onClick={busy ? cancelSend : undefined}
                className="shrink-0 h-11 w-11 sm:h-10 sm:w-10"
                aria-label={busy ? "Stop generating" : "Send message"}
              >
                {busy ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
