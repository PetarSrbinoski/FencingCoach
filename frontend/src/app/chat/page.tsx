"use client";

import { PageTitle } from "@/components/page-heading";

import { AgentLogs } from "@/components/agent-logs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  type AgentAction,
  type ChatMessageStatusValue,
  type ChatMessagePoll,
  type CoachConversationSummary,
  type CoachPlanProposal,
  type NutritionAnswerReference,
} from "@/lib/api";
import { createJobObserver, type JobObservation } from "@/lib/job-observer";
import { cn } from "@/lib/utils";
import { announceWorkflowChange } from "@/lib/workflow-refresh";
import {
  AlertTriangle,
  ChevronDown,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Send,
  Sword,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Msg = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  status?: ChatMessageStatusValue;
  contextSnapshot?: string | null;
  ungroundedClaims?: string[];
  nutritionRefs?: NutritionAnswerReference[];
};

function conversationLabel(conversation: CoachConversationSummary) {
  return (
    conversation.title?.trim() ||
    conversation.last_message_preview?.trim() ||
    "Untitled chat"
  );
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
  const [conversations, setConversations] = useState<
    CoachConversationSummary[]
  >([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [agentLogsOpen, setAgentLogsOpen] = useState(false);
  const [actionReceipts, setActionReceipts] = useState<AgentAction[]>([]);
  const [planProposals, setPlanProposals] = useState<CoachPlanProposal[]>([]);
  const [proposalBusy, setProposalBusy] = useState<number | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [newReply, setNewReply] = useState(false);
  const [deleteConversationId, setDeleteConversationId] = useState<
    number | null
  >(null);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(null);
  const observer = useRef(createJobObserver());
  const activeRequest = useRef<{ id: Promise<number>; observation: JobObservation }>();

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (nearBottom.current) {
      scroller.scrollTop = scroller.scrollHeight;
      setNewReply(false);
    } else setNewReply(true);
  }, [messages, busy]);

  useEffect(() => {
    let active = true;
    const pending = sessionStorage.getItem("pendingChatMessage");
    if (pending) sessionStorage.removeItem("pendingChatMessage");
    (async () => {
      const requested = Number(new URLSearchParams(window.location.search).get("conversation"));
      await loadConversations(Number.isSafeInteger(requested) && requested > 0 ? requested : undefined);
      if (active && pending) {
        startNewConversation();
        send(pending);
      }
    })();
    return () => {
      active = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    observer.current.stop();
    activeRequest.current = undefined;
    setCancelling(false);
  }

  function refreshConversationSummaries() {
    api.chatConversations
      .list()
      .then(setConversations)
      .catch(() => {});
  }

  function refreshActionReceipts() {
    api.agentActions
      .list({ page: 1 })
      .then((result) => setActionReceipts(result.items))
      .catch(() => {});
  }

  function refreshPlanProposals() {
    api.coachPlanProposals
      .list()
      .then(setPlanProposals)
      .catch(() => {});
  }

  async function decideProposal(
    proposal: CoachPlanProposal,
    decision: "apply" | "cancel",
  ) {
    setProposalBusy(proposal.id);
    setProposalError(null);
    try {
      if (decision === "apply") await api.coachPlanProposals.apply(proposal.id);
      else await api.coachPlanProposals.cancel(proposal.id);
      refreshPlanProposals();
      refreshActionReceipts();
      announceWorkflowChange();
    } catch (error) {
      setProposalError(
        `${error instanceof Error ? error.message : String(error)} Request a fresh comparison from the coach if inputs changed.`,
      );
      refreshPlanProposals();
    } finally {
      setProposalBusy(null);
    }
  }

  function receiveReply(messageId: number, poll: ChatMessagePoll) {
    setBusy(false);
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: poll.content,
              status: poll.status,
              contextSnapshot: poll.context_snapshot,
              ungroundedClaims: poll.ungrounded_claims,
              nutritionRefs: poll.nutrition_refs,
            }
          : message,
      ),
    );
    refreshActionReceipts();
    refreshPlanProposals();
    announceWorkflowChange();
    if (poll.status === "error") setErr(poll.error ?? "Chat failed");
  }

  function pollReply(messageId: number, observation: JobObservation) {
    activeRequest.current = { id: Promise.resolve(messageId), observation };
    setBusy(true);
    observation.poll(
      () => api.chatMessages.poll(messageId),
      (poll) => receiveReply(messageId, poll),
      (error) => {
        setBusy(false);
        setErr(error instanceof Error ? error.message : "Chat failed");
      },
    );
  }

  async function loadConversations(selectId?: number) {
    const observation = observer.current.begin();
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await api.chatConversations.list();
      if (!observation.isCurrent()) return;
      setConversations(list);

      const targetId = selectId ?? conversationId;
      if (
        targetId &&
        list.some((conversation) => conversation.id === targetId)
      ) {
        await openConversation(targetId, list, observation);
      } else if (!targetId && list.length > 0) {
        await openConversation(list[0].id, list, observation);
      } else if (list.length === 0) {
        startNewConversation();
      }
    } catch (e: any) {
      if (observation.isCurrent())
        setHistoryError(e?.message ?? "Failed to load chat history");
    } finally {
      if (observation.isCurrent()) setLoadingHistory(false);
    }
  }

  async function openConversation(
    id: number,
    nextList = conversations,
    observation = observer.current.begin(),
  ) {
    activeRequest.current = undefined;
    setCancelling(false);
    setErr(null);
    nearBottom.current = true;
    setBusy(true);
    let conversation;
    try {
      conversation = await api.chatConversations.get(id);
    } catch (error) {
      if (observation.isCurrent()) {
        setBusy(false);
        setLoadingHistory(false);
        setErr(
          error instanceof Error
            ? error.message
            : "Failed to load conversation",
        );
      }
      return;
    }
    if (!observation.isCurrent()) return;
    setLoadingHistory(false);
    setConversationId(conversation.id);
    refreshActionReceipts();
    refreshPlanProposals();
    setMessages(
      conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        nutritionRefs: message.nutrition_refs,
      })),
    );
    if (!nextList.some((entry) => entry.id === id)) {
      setConversations((current) => current);
    }

    const last = conversation.messages[conversation.messages.length - 1];
    if (last?.role === "assistant" && last.status === "pending") {
      pollReply(last.id, observation);
    } else {
      setBusy(false);
    }
  }

  function startNewConversation() {
    stopPolling();
    setLoadingHistory(false);
    setConversationId(undefined);
    setMessages([]);
    setInput("");
    setErr(null);
    setBusy(false);
    setHistoryOpen(false);
  }

  async function send(overrideText?: string) {
    const content = (overrideText ?? input).trim();
    if (!content || busy || cancelling || messages.at(-1)?.status === "pending") return;

    const observation = observer.current.begin();
    const placeholder: Msg = {
      role: "assistant",
      content: "",
      status: "pending",
    };
    setMessages((current) => [
      ...current,
      { role: "user", content },
      placeholder,
    ]);
    setInput("");
    setBusy(true);
    setErr(null);

    try {
      const submission = api.chat(content, conversationId, true);
      const id = submission.then((accepted) => accepted.message_id);
      activeRequest.current = { id, observation };
      void id.catch(() => {}); // The submission error is handled below.
      const accepted = await submission;
      if (!observation.isCurrent()) return;
      setConversationId(accepted.conversation_id);
      setMessages((current) =>
        current.map((message) =>
          message === placeholder
            ? { ...message, id: accepted.message_id }
            : message,
        ),
      );
      pollReply(accepted.message_id, observation);
      refreshConversationSummaries();
    } catch (e: any) {
      if (!observation.isCurrent()) return;
      setMessages((current) => current.slice(0, -2));
      setInput(content);
      setErr(e?.message ?? "Chat failed");
      setBusy(false);
    }
  }

  async function cancelReply() {
    const request = activeRequest.current;
    if (!request || cancelling) return;
    setCancelling(true);
    setErr(null);
    try {
      const id = await request.id;
      const result = await api.chatMessages.cancel(id);
      if (!request.observation.isCurrent()) return;
      stopPolling();
      receiveReply(id, result);
    } catch (error) {
      if (request.observation.isCurrent()) {
        setErr(error instanceof Error ? error.message : "Could not cancel reply");
      }
    } finally {
      if (request.observation.isCurrent()) setCancelling(false);
    }
  }

  async function removeConversation(id: number) {
    const isActive = conversationId === id;
    setErr(null);
    try {
      await api.chatConversations.delete(id);
      const nextList = conversations.filter(
        (conversation) => conversation.id !== id,
      );
      setConversations(nextList);

      if (isActive) {
        if (nextList.length > 0) {
          await openConversation(nextList[0].id, nextList);
        } else {
          startNewConversation();
        }
      }
    } catch (e: any) {
      throw e;
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
          <div className="px-3 py-4 text-xs font-sans text-muted-foreground">
            Loading history…
          </div>
        )}

        {!loadingHistory && historyError && (
          <div className="border border-accent/30 bg-accent/5 px-3 py-3 m-2">
            <p role="alert" className="text-sm text-destructive">
              {historyError}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadConversations()}
            >
              Retry history
            </Button>
          </div>
        )}

        {!loadingHistory && !historyError && conversations.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No saved chats
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Your coach history will appear here.
            </p>
          </div>
        )}

        {!loadingHistory &&
          !historyError &&
          conversations.map((conversation) => {
            const active = conversation.id === conversationId;
            return (
              <div
                key={conversation.id}
                className={cn(
                  "group border border-transparent px-3 py-3 transition-colors duration-150",
                  active ? "border-border bg-muted/40" : "hover:bg-muted/20",
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                    className="min-h-11 flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-medium leading-tight text-foreground truncate">
                      {conversationLabel(conversation)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-sm font-sans text-muted-foreground">
                      <span>{conversation.message_count} msgs</span>
                      <span>·</span>
                      <span>{relativeDate(conversation.updated_at)}</span>
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="h-11 w-11 shrink-0 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label="Conversation actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setDeleteConversationId(conversation.id)}
                        className="text-accent focus:text-accent"
                      >
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
    <div className="flex h-[calc(var(--app-height,100dvh)-var(--dock-space)-env(safe-area-inset-top)-0.75rem)] min-h-0 flex-col gap-3">
      <header className="flex flex-wrap shrink-0 items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 flex-1 basis-40">
          <PageTitle title="Coach" />
          <p className="truncate text-sm text-muted-foreground">
            {conversations.find((item) => item.id === conversationId)?.title ||
              "New conversation"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="xl:hidden"
                aria-label="Chat history"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] max-w-full overflow-hidden p-0 sm:max-w-[560px]">
              <DialogHeader className="border-b border-border px-4 py-4 text-left">
                <DialogTitle>Chat history</DialogTitle>
                <DialogDescription>Saved coach conversations</DialogDescription>
              </DialogHeader>
              <div className="max-h-[calc(90dvh-7rem)] overflow-y-auto">
                {renderConversationList()}
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="icon"
            onClick={startNewConversation}
            aria-label="New chat"
          >
            <PencilLine />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Coach options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/chat/memory">What my coach knows</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSelectedActionId(null);
                  setAgentLogsOpen(true);
                }}
              >
                Coach actions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="grid flex-1 min-h-0 gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border border-border bg-card min-h-[220px] xl:flex xl:flex-col xl:h-full xl:min-h-0">
          <div className="border-b border-border px-4 py-3.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-foreground">
              Chat history
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Saved coach conversations
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {renderConversationList()}
          </div>
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-border bg-card overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              if (nearBottom.current) setNewReply(false);
            }}
            className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-5 overscroll-contain"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="h-14 w-14 border border-border flex items-center justify-center mb-4">
                  <MessageCircle
                    className="h-6 w-6 text-accent"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-lg font-semibold tracking-tight text-foreground">
                  Your AI fencing coach
                </p>
                <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
                  Ask about training, nutrition, peaking, technique, recovery,
                  or competition prep.
                </p>
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              if (
                !isUser &&
                m.content === "" &&
                i === messages.length - 1 &&
                busy
              ) {
                return null;
              }
              return (
                <div
                  key={`${m.role}-${i}-${m.content.slice(0, 24)}`}
                  className={cn(
                    "flex flex-col gap-1.5",
                    isUser ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "flex w-full min-w-0 items-end gap-2",
                      isUser && "flex-row-reverse",
                    )}
                  >
                    <div
                      className={cn(
                        "hidden sm:flex h-8 w-8 shrink-0 items-center justify-center border border-border",
                        isUser
                          ? "bg-foreground text-background"
                          : "bg-accent/10 text-accent",
                      )}
                    >
                      {isUser ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <Sword className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "min-w-0 max-w-full rounded-xl px-3 py-3 text-base leading-relaxed border [overflow-wrap:anywhere]",
                        isUser
                          ? "whitespace-pre-wrap bg-foreground text-background border-foreground"
                          : "bg-transparent border-border text-foreground",
                      )}
                    >
                      {isUser ? (
                        m.content
                      ) : m.status === "cancelled" ? (
                        <p role="status" className="text-muted-foreground">
                          Reply cancelled. Any actions already saved are kept.
                        </p>
                      ) : m.status === "error" ? (
                        <p role="status" className="text-muted-foreground">
                          Reply failed or was interrupted. Send a new message to
                          try again.
                        </p>
                      ) : (
                        <Markdown>{m.content}</Markdown>
                      )}
                    </div>
                  </div>

                  {!isUser &&
                    (m.ungroundedClaims?.length || m.contextSnapshot) && (
                      <div className="w-full min-w-0 space-y-1.5">
                        {m.ungroundedClaims &&
                          m.ungroundedClaims.length > 0 && (
                            <div className="flex items-start gap-1.5 border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
                              <p className="text-sm text-warning leading-snug">
                                Double-check: this reply cites a number that
                                doesn&rsquo;t appear in your recent data —{" "}
                                {m.ungroundedClaims[0]}
                              </p>
                            </div>
                          )}
                        {m.contextSnapshot && (
                          <details className="group">
                            <summary className="flex items-center gap-1 text-sm font-sans uppercase tracking-wider text-muted-foreground cursor-pointer select-none">
                              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                              What the coach saw
                            </summary>
                            <pre className="mt-1.5 whitespace-pre-wrap text-xs font-sans text-muted-foreground bg-muted/40 border border-border p-2.5 max-h-64 overflow-auto">
                              {m.contextSnapshot}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  {!isUser &&
                    m.nutritionRefs?.map((reference, referenceIndex) => (
                      <div
                        key={referenceIndex}
                        className="w-full min-w-0 border border-border p-3 text-xs space-y-2"
                      >
                        <p className="font-medium">
                          Nutrition targets · {reference.start} through{" "}
                          {reference.end} · read only
                        </p>
                        {reference.plan_versions.length > 0 && (
                          <p className="text-muted-foreground">
                            Referenced accepted plan versions:{" "}
                            {reference.plan_versions.join(", ")}. This answer
                            may describe an older version.
                          </p>
                        )}
                        <div className="space-y-2">
                          {reference.days?.map((day) => (
                            <details
                              key={day.day}
                              className="rounded-xl border border-border p-3"
                            >
                              <summary className="font-medium">
                                {day.day} · {day.kcal} kcal
                              </summary>
                              <p>
                                Protein {day.protein_g} g · Carbs {day.carbs_g}{" "}
                                g · Fat {day.fat_g} g
                              </p>
                              <p className="mt-2 text-muted-foreground">
                                {day.training_type} · {day.context} ·{" "}
                                {day.explanation}
                              </p>
                              <p className="text-muted-foreground">
                                Source: {day.target_source}
                                {day.plan_version
                                  ? ` v${day.plan_version}`
                                  : ""}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" asChild>
                                  <a href={day.diary_url}>Diary</a>
                                </Button>
                                {day.plan_url && (
                                  <Button size="sm" variant="outline" asChild>
                                    <a href={day.plan_url}>Plan</a>
                                  </Button>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    ))}
                  {!isUser &&
                    m.id &&
                    actionReceipts
                      .filter(
                        (action) =>
                          action.message_id === m.id &&
                          action.kind !== "reversal",
                      )
                      .map((action) => (
                        <div
                          key={action.id}
                          role="status"
                          className="w-full min-w-0 border border-border px-3 py-2 text-xs"
                        >
                          Coach action #{action.id}: {action.summary} ·{" "}
                          {action.status}.{" "}
                          <button
                            className="inline-flex min-h-11 items-center text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                            onClick={() => {
                              setSelectedActionId(action.id);
                              setAgentLogsOpen(true);
                            }}
                          >
                            Review coach action
                          </button>
                        </div>
                      ))}
                  {!isUser &&
                    m.id &&
                    planProposals
                      .filter((proposal) => proposal.message_id === m.id)
                      .map((proposal) => (
                        <section
                          key={proposal.id}
                          className="w-full min-w-0 border border-border p-3 text-xs space-y-2"
                          aria-label={`Coach plan proposal ${proposal.id}`}
                        >
                          <h3 className="font-medium text-sm">
                            Nutrition plan proposal #{proposal.id} ·{" "}
                            {proposal.preview.event.name}
                          </h3>
                          <p>
                            Status: {proposal.status}.{" "}
                            {proposal.status === "pending"
                              ? "No targets have changed. Review each date before applying."
                              : proposal.status === "applied"
                                ? "Accepted targets are active; review the action receipt in Coach actions."
                                : "Cancelled without changing targets."}
                          </p>
                          {proposal.preview.assumptions.map((assumption) => (
                            <p
                              key={assumption}
                              className="text-muted-foreground"
                            >
                              Assumption: {assumption}
                            </p>
                          ))}
                          <div className="space-y-2">
                            {proposal.preview.days.map((day) => (
                              <article
                                key={day.day}
                                className="rounded-xl border border-border p-3 space-y-2"
                              >
                                <h4 className="font-medium">
                                  {day.day} · {day.context}
                                </h4>
                                <p>
                                  <strong>Current:</strong>{" "}
                                  {day.existing_targets
                                    ? `${day.existing_targets.kcal} kcal · P ${day.existing_targets.protein_g} g · C ${day.existing_targets.carbs_g} g · F ${day.existing_targets.fat_g} g`
                                    : "Ordinary target"}
                                </p>
                                <p>
                                  <strong>Proposed:</strong> {day.kcal} kcal · P{" "}
                                  {day.protein_g} g · C {day.carbs_g} g · F{" "}
                                  {day.fat_g} g
                                </p>
                                <p className="text-muted-foreground">
                                  {day.training_type}
                                </p>
                              </article>
                            ))}
                          </div>
                          <p className="text-muted-foreground">
                            Accepted meal plans on affected dates may need
                            review. Diary entries stay unchanged.
                          </p>
                          {proposalError && (
                            <p role="alert" className="text-destructive">
                              {proposalError}
                            </p>
                          )}
                          {proposal.status === "pending" && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                disabled={proposalBusy !== null}
                                onClick={() =>
                                  void decideProposal(proposal, "apply")
                                }
                              >
                                {proposalBusy === proposal.id
                                  ? "Applying…"
                                  : "Apply plan"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={proposalBusy !== null}
                                onClick={() =>
                                  void decideProposal(proposal, "cancel")
                                }
                              >
                                Cancel proposal
                              </Button>
                            </div>
                          )}
                          {proposal.status === "applied" && (
                            <div className="flex flex-wrap gap-2">
                              <a
                                href={`/nutrition?competition=${proposal.event_id}&plan=${proposal.applied_plan_id}`}
                                className="underline"
                              >
                                Open accepted plan
                              </a>
                              <button
                                className="underline"
                                onClick={() => setAgentLogsOpen(true)}
                              >
                                Open action receipt #{proposal.action_id}
                              </button>
                            </div>
                          )}
                        </section>
                      ))}
                </div>
              );
            })}

            {busy && !messages[messages.length - 1]?.content && (
              <div className="flex w-full min-w-0 items-end gap-2">
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

          {newReply && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (scrollRef.current)
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                nearBottom.current = true;
                setNewReply(false);
              }}
            >
              Jump to latest reply
            </Button>
          )}
          <div className="shrink-0 border-t border-border p-3 bg-card">
            <p role="status" aria-live="polite" className="sr-only">
              {busy
                ? "Coach is working"
                : messages.at(-1)?.role === "assistant" &&
                    messages.at(-1)?.status === "done"
                  ? "Coach reply ready"
                  : ""}
            </p>
            {(busy || messages.at(-1)?.status === "pending") && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 text-muted-foreground">
                  Coach is working. You can leave and return.
                </span>
                {activeRequest.current && (
                  <Button size="sm" variant="ghost" onClick={cancelReply} disabled={cancelling}>
                    {cancelling ? "Cancelling…" : "Cancel reply"}
                  </Button>
                )}
              </div>
            )}
            {!busy && messages.at(-1)?.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                className="mb-2"
                disabled={cancelling}
                onClick={() => {
                  const id = messages.at(-1)?.id;
                  if (id) pollReply(id, observer.current.begin());
                }}
              >
                Resume reply
              </Button>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                nearBottom.current = true;
                void send();
              }}
              className="flex items-end gap-2"
            >
              <Textarea
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  event.target.style.height = "48px";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (!busy) {
                      nearBottom.current = true;
                      void send();
                    }
                  }
                }}
                placeholder="Ask your coach…"
                aria-label="Message the coach"
                rows={1}
                className="min-h-12 max-h-36 flex-1 resize-none text-base"
              />
              <Button
                type="submit"
                size="icon"
                className="h-12 w-12 shrink-0"
                disabled={busy || cancelling || messages.at(-1)?.status === "pending" || !input.trim()}
                aria-label="Send message"
              >
                <Send />
              </Button>
            </form>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleteConversationId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConversationId(null);
        }}
        title="Delete conversation?"
        description="This removes the chat history. Coach action receipts remain available."
        confirmLabel="Delete conversation"
        onConfirm={async () => {
          if (deleteConversationId !== null)
            await removeConversation(deleteConversationId);
        }}
      />
      <AgentLogs
        selectedActionId={selectedActionId}
        open={agentLogsOpen}
        onOpenChange={setAgentLogsOpen}
        onOpenConversation={selectConversation}
      />
    </div>
  );
}
