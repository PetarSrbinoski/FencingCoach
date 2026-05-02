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
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Send,
  Sword,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    loadConversations();
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

  async function send() {
    if (!input.trim() || busy) return;

    const content = input.trim();
    const userMsg: Msg = { role: "user", content };
    setMessages((current) => [...current, userMsg]);
    setInput("");
    setBusy(true);
    setErr(null);

    try {
      const res = await api.chat(content, conversationId);
      setConversationId(res.conversation_id);
      setMessages((current) => [...current, { role: "assistant", content: res.reply }]);
      await loadConversations(res.conversation_id);
    } catch (e: any) {
      setMessages((current) => current.slice(0, -1));
      setInput(content);
      setErr(e?.message ?? "Chat failed");
    } finally {
      setBusy(false);
    }
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
          <div className="px-2 py-4 text-xs font-mono text-muted-foreground">Loading history...</div>
        )}

        {!loadingHistory && historyError && (
          <div className="border-2 border-bauhaus-red bg-bauhaus-red/5 px-3 py-3 m-2">
            <p className="text-xs font-bold text-bauhaus-red">{historyError}</p>
          </div>
        )}

        {!loadingHistory && !historyError && conversations.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-black uppercase tracking-wider">No saved chats</p>
            <p className="text-[11px] font-mono text-muted-foreground mt-2">Your coach history will appear here.</p>
          </div>
        )}

        {!loadingHistory && !historyError && conversations.map((conversation) => {
          const active = conversation.id === conversationId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group border-2 border-transparent px-3 py-3 transition-colors",
                active && "border-foreground bg-muted/40 shadow-hard-sm"
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className="flex-1 text-left"
                >
                  <p className="text-sm font-bold leading-tight uppercase tracking-wide">
                    {conversationLabel(conversation)}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    <span>{conversation.message_count} msgs</span>
                    <span>{relativeDate(conversation.updated_at)}</span>
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:border-foreground hover:text-foreground"
                      aria-label="Conversation actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => removeConversation(conversation.id)} className="text-bauhaus-red focus:text-bauhaus-red">
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
    <div className="flex min-h-[calc(100svh-8rem)] flex-col gap-4 md:gap-5">
      <div className="border-b-4 border-foreground pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Coach</h1>
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1.5 font-mono">
              Continue saved conversations or start a fresh one
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="px-4 lg:hidden">
                  <MessageCircle className="h-4 w-4" />
                  History
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85svh] max-w-[95vw] overflow-hidden p-0 sm:max-w-[560px]">
                <DialogHeader className="border-b-2 border-foreground px-4 py-4 text-left">
                  <DialogTitle>Chat history</DialogTitle>
                  <DialogDescription>Saved coach conversations</DialogDescription>
                </DialogHeader>
                <div className="max-h-[calc(85svh-5rem)] overflow-y-auto">
                  {renderConversationList()}
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={startNewConversation} className="px-4">
              <PencilLine className="h-4 w-4" />
              New chat
            </Button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden border-2 border-foreground shadow-hard bg-card min-h-[220px] lg:flex lg:flex-col lg:h-[calc(100svh-13rem)]">
          <div className="border-b-2 border-foreground px-4 py-3">
            <p className="text-xs font-black uppercase tracking-widest">Chat history</p>
            <p className="text-[11px] font-mono text-muted-foreground mt-1">Saved coach conversations</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {renderConversationList()}
          </div>
        </aside>

        <div className="flex min-h-[calc(100svh-13rem)] flex-col border-2 border-foreground shadow-hard bg-card overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 overscroll-contain">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="h-16 w-16 border-2 border-foreground flex items-center justify-center mb-4 shadow-hard-sm">
                  <MessageCircle className="h-8 w-8 text-bauhaus-blue" />
                </div>
                <p className="text-lg font-black uppercase tracking-tighter text-foreground">Your AI fencing coach</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs font-mono">
                  Ask about training, nutrition, peaking, technique, recovery, or competition prep.
                </p>
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={`${m.role}-${i}-${m.content.slice(0, 24)}`} className={cn("flex items-end gap-2.5", isUser && "flex-row-reverse")}>
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground",
                      isUser ? "bg-bauhaus-blue text-white" : "bg-bauhaus-yellow text-foreground"
                    )}
                  >
                    {isUser ? <User className="h-4 w-4" /> : <Sword className="h-4 w-4" />}
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed whitespace-pre-wrap border-2 border-foreground",
                      isUser ? "bg-bauhaus-blue text-white shadow-hard-sm" : "bg-card shadow-hard-sm"
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="flex items-end gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground bg-bauhaus-yellow text-foreground">
                  <Sword className="h-4 w-4" />
                </div>
                <div className="bg-card border-2 border-foreground shadow-hard-sm px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-foreground animate-pulse" />
                    <div className="w-2 h-2 bg-foreground animate-pulse [animation-delay:150ms]" />
                    <div className="w-2 h-2 bg-foreground animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            {err && (
              <div className="flex justify-center">
                <div className="border-2 border-bauhaus-red bg-bauhaus-red/5 px-4 py-2">
                  <p className="text-sm text-bauhaus-red font-bold">{err}</p>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="border-t-2 border-foreground p-3 sm:p-4 bg-muted/30 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
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
                className="flex-1 h-11 sm:h-10 text-base sm:text-sm"
              />
              <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 h-11 w-11 sm:h-10 sm:w-10">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
