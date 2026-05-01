"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, User, Sword, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg: Msg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const res = await api.chat(userMsg.content, conversationId);
      setConversationId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      setErr(e?.message ?? "Chat failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="mb-4 md:mb-5 border-b-4 border-foreground pb-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Coach</h1>
        <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1.5 font-mono">Ask anything about training, nutrition, or recovery</p>
      </div>

      {/* Chat container */}
      <div className="flex-1 flex flex-col overflow-hidden border-2 border-foreground shadow-hard bg-card">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
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
              <div
                key={i}
                className={cn("flex items-end gap-2.5", isUser && "flex-row-reverse")}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground",
                    isUser
                      ? "bg-bauhaus-blue text-white"
                      : "bg-bauhaus-yellow text-foreground"
                  )}
                >
                  {isUser ? <User className="h-4 w-4" /> : <Sword className="h-4 w-4" />}
                </div>
                <div
                  className={cn(
                    "max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed whitespace-pre-wrap border-2 border-foreground",
                    isUser
                      ? "bg-bauhaus-blue text-white shadow-hard-sm"
                      : "bg-card shadow-hard-sm"
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

        {/* Input area */}
        <div className="border-t-2 border-foreground p-3 sm:p-4 bg-muted/30">
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Should I skip gym today?"
              disabled={busy}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 h-10 w-10">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
