"use client";

import { useEffect, useState } from "react";
import { api, TrainingSession } from "@/lib/api";
import { BandPill } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dumbbell, Swords, BedDouble, ChevronLeft, ChevronRight } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────
function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function classifyDay(s: TrainingSession): "fencing" | "gym" | "rest" {
  if (s.session) return "gym";
  const reason = (s.reason || "").toLowerCase();
  if (reason.includes("rest")) return "rest";
  const wd = s.weekday;
  if (["Monday", "Wednesday", "Friday", "Saturday"].includes(wd)) return "fencing";
  return "rest";
}

// ── main ─────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState<Date>(mondayOf(new Date()));
  const [week, setWeek] = useState<TrainingSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  function fetchWeek() {
    api.training.week(isoDate(weekStart)).then(setWeek).catch((e) => setErr(e?.message));
  }

  useEffect(() => { fetchWeek(); }, [weekStart]);

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
    setWeek(null);
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
    setWeek(null);
  }

  const loading = week === null;
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  return (
    <div className="space-y-16 md:space-y-20">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 font-mono">
          Weekly split
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none">
          Training
        </h1>
        <div className="h-1 w-16 bg-accent mt-6" />

        {/* Week navigation */}
        <div className="flex items-center gap-4 mt-8">
          <button
            onClick={prevWeek}
            className="h-10 w-10 inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <span className="text-sm font-mono text-muted-foreground tracking-wide">
            {formatDate(isoDate(weekStart))} — {formatDate(isoDate(weekEndDate))}
          </span>
          <button
            onClick={nextWeek}
            className="h-10 w-10 inline-flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors duration-150"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {err && (
        <div className="border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-accent text-sm">{err}</p>
        </div>
      )}

      {/* ── Weekly Schedule Cards ──────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {week.map((session) => {
            const dayType = classifyDay(session);
            const isToday = session.day === today;

            return (
              <div
                key={session.day}
                className={`
                  relative border p-6 transition-all duration-150
                  ${isToday ? "border-accent" : "border-border hover:border-muted-foreground/30"}
                `}
              >
                {/* Top accent bar for today */}
                {isToday && (
                  <div className="absolute top-0 left-0 h-0.5 w-full bg-accent" />
                )}

                {/* Day header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    {dayType === "fencing" && <Swords className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />}
                    {dayType === "gym" && <Dumbbell className="h-4 w-4 text-accent" strokeWidth={1.5} />}
                    {dayType === "rest" && <BedDouble className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />}
                    <span className="font-medium text-sm tracking-wide">{session.weekday}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono tracking-wide">
                    {formatDate(session.day)}
                  </span>
                </div>

                {/* Fencing day */}
                {dayType === "fencing" && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Fencing
                    </span>
                    <p className="text-sm text-foreground/70 leading-relaxed">
                      Club session — conditioning + sparring (~2h)
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 font-mono">
                      {session.weekday === "Saturday" ? "11:00" : "20:00"}
                    </p>
                  </div>
                )}

                {/* Rest day */}
                {dayType === "rest" && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Rest
                    </span>
                    <p className="text-sm text-foreground/50 leading-relaxed">
                      Recovery day — no structured training.
                    </p>
                  </div>
                )}

                {/* Gym day */}
                {dayType === "gym" && session.session && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                        Gym
                      </span>
                      <span className="text-[10px] text-muted-foreground capitalize font-mono">
                        {session.session.name.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="space-y-1.5 border-t border-border pt-3">
                      {session.session.exercises.map((rx) => (
                        <div
                          key={rx.exercise}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-foreground/70 truncate mr-3 text-xs">
                            {rx.exercise}
                          </span>
                          <span className="font-mono text-muted-foreground text-[10px] whitespace-nowrap">
                            {rx.sets}x{rx.reps}
                            {rx.load_kg != null ? ` @${rx.load_kg}kg` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Phase & readiness (today only) */}
                {isToday && (
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {(session.phase as any)?.name ?? "\u2014"}
                    </span>
                    {(session.readiness as any)?.band && (
                      <BandPill band={(session.readiness as any).band} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
