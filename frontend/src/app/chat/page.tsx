"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-5">
        <h1 className="text-3xl font-bold tracking-tight">Coach</h1>
        <p className="text-sm text-muted-foreground mt-1">Ask anything about training, nutrition, or recovery</p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="h-16 w-16 rounded-2xl bg-primary/8 flex items-center justify-center mb-4">
                <MessageCircle className="h-8 w-8 text-primary/40" />
              </div>
              <p className="text-lg font-semibold tracking-tight text-foreground/80">Your AI fencing coach</p>
              <p className="text-sm text-muted-foreground/60 mt-1 max-w-xs">
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
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isUser ? <User className="h-4 w-4" /> : <Sword className="h-4 w-4" />}
                </div>
                <div
                  className={cn(
                    "max-w-[75%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                    isUser
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                      : "bg-muted/60 rounded-2xl rounded-bl-md"
                  )}
                >
                  {m.content}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex items-end gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Sword className="h-4 w-4" />
              </div>
              <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse-soft" />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse-soft [animation-delay:150ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse-soft [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          {err && (
            <div className="flex justify-center">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2">
                <p className="text-sm text-destructive">{err}</p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </CardContent>

        <div className="border-t border-border/50 p-4 bg-card/50">
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
            <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
