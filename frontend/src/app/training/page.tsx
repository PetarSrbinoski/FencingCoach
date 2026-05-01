"use client";

import { useEffect, useState } from "react";
import { api, ExerciseProgress, ExerciseRx, TrainingSession, WorkoutLog } from "@/lib/api";
import { Card, StatRow, BandPill } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dumbbell, Trash2, Play, TrendingUp, Swords, BedDouble, ChevronLeft, ChevronRight } from "lucide-react";

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

const DAY_ACCENT: Record<string, { border: string; bg: string; text: string; color: string }> = {
  fencing: { border: "border-l-bauhaus-blue", bg: "bg-bauhaus-blue/10", text: "text-bauhaus-blue", color: "bauhaus-blue" },
  gym: { border: "border-l-bauhaus-red", bg: "bg-bauhaus-red/10", text: "text-bauhaus-red", color: "bauhaus-red" },
  rest: { border: "border-l-foreground/20", bg: "bg-muted", text: "text-muted-foreground", color: "muted" },
};

// ── main ─────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState<Date>(mondayOf(new Date()));
  const [week, setWeek] = useState<TrainingSession[] | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [exercise, setExercise] = useState("");
  const [setNumber, setSetNumber] = useState(1);
  const [reps, setReps] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [rpe, setRpe] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [progressEx, setProgressEx] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  function fetchWeek() {
    api.training.week(isoDate(weekStart)).then(setWeek).catch((e) => setErr(e?.message));
  }

  function refresh() {
    fetchWeek();
    api.training.listLog(14).then(setLogs).catch(() => {});
  }

  useEffect(refresh, [weekStart]);

  useEffect(() => {
    if (!progressEx) { setProgress(null); return; }
    api.training.progress(progressEx, 180).then(setProgress).catch(() => {});
  }, [progressEx]);

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

  async function submitLog() {
    if (!exercise || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.training.log({
        exercise,
        set_number: setNumber,
        reps: reps ? Number(reps) : undefined,
        weight_kg: weight ? Number(weight) : undefined,
        rpe: rpe ? Number(rpe) : undefined,
        notes: notes || undefined,
      });
      setSetNumber(setNumber + 1);
      setReps("");
      setNotes("");
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteLog(id: number) {
    try {
      await api.training.deleteLog(id);
      refresh();
    } catch (e: any) {
      setErr(e?.message);
    }
  }

  function fillFromRx(rx: ExerciseRx) {
    setExercise(rx.exercise);
    if (rx.load_kg != null) setWeight(String(rx.load_kg));
    setReps(String(rx.reps));
    setSetNumber(1);
  }

  const todayLogs = logs.filter((l) => l.day === today);
  const earlier = logs.filter((l) => l.day !== today);
  const loading = week === null;

  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b-4 border-foreground pb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter leading-[0.9]">Training</h1>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1.5 font-mono">Weekly split & workout log</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button variant="outline" size="icon" onClick={prevWeek} className="h-9 w-9">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs sm:text-sm font-bold uppercase tracking-wider min-w-[130px] sm:min-w-[160px] text-center font-mono border-2 border-foreground px-2 sm:px-3 py-1.5">
            {formatDate(isoDate(weekStart))} — {formatDate(isoDate(weekEndDate))}
          </span>
          <Button variant="outline" size="icon" onClick={nextWeek} className="h-9 w-9">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Weekly Pin Board ───────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="border-2 border-foreground bg-card p-4 md:p-5 space-y-3 shadow-hard">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {week.map((session) => {
            const dayType = classifyDay(session);
            const isToday = session.day === today;
            const accent = DAY_ACCENT[dayType];

            return (
              <div
                key={session.day}
                className={`
                  relative border-2 border-foreground border-l-[6px] ${accent.border}
                  bg-card p-4 md:p-5 shadow-hard transition-all duration-200
                  hover:-translate-y-0.5 hover:shadow-hard-md
                  ${isToday ? "ring-2 ring-bauhaus-yellow ring-offset-2" : ""}
                `}
              >
                {/* Geometric corner decoration */}
                <div className={`absolute top-0 right-0 w-3 h-3 ${dayType === "fencing" ? "bg-bauhaus-blue" : dayType === "gym" ? "bg-bauhaus-red" : "bg-foreground/20"}`} />

                {/* Day header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {dayType === "fencing" && <Swords className={`h-4 w-4 ${accent.text}`} />}
                    {dayType === "gym" && <Dumbbell className={`h-4 w-4 ${accent.text}`} />}
                    {dayType === "rest" && <BedDouble className={`h-4 w-4 ${accent.text}`} />}
                    <span className="font-bold text-sm uppercase tracking-wider">{session.weekday}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isToday && (
                      <Badge variant="default" className="text-2xs bg-bauhaus-yellow text-foreground border-foreground">
                        TODAY
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {formatDate(session.day)}
                    </span>
                  </div>
                </div>

                {/* Fencing day */}
                {dayType === "fencing" && (
                  <div className="space-y-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-bauhaus-blue text-bauhaus-blue">
                      Fencing
                    </Badge>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Club session — conditioning + sparring (~2h)
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono font-bold">
                      {session.weekday === "Saturday" ? "11:00" : "20:00"}
                    </p>
                  </div>
                )}

                {/* Rest day */}
                {dayType === "rest" && (
                  <div className="space-y-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      Rest
                    </Badge>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Recovery day — no structured training.
                    </p>
                  </div>
                )}

                {/* Gym day */}
                {dayType === "gym" && session.session && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-bauhaus-red text-bauhaus-red">
                        Gym
                      </Badge>
                      <span className="text-[10px] text-muted-foreground capitalize font-mono font-bold">
                        {session.session.name.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="space-y-1 border-t-2 border-foreground/10 pt-2">
                      {session.session.exercises.map((rx) => (
                        <div
                          key={rx.exercise}
                          className="flex items-center justify-between text-xs py-0.5"
                        >
                          <span className="text-foreground/80 truncate mr-2 text-[12px] font-medium">
                            {rx.exercise}
                          </span>
                          <span className="font-mono text-muted-foreground text-[10px] whitespace-nowrap font-bold">
                            {rx.sets}x{rx.reps}
                            {rx.load_kg != null ? ` @${rx.load_kg}kg` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {isToday && (
                      <div className="pt-2 border-t-2 border-foreground/10 mt-2">
                        <div className="flex flex-wrap gap-1">
                          {session.session.exercises.map((rx) => (
                            <Button
                              key={rx.exercise}
                              variant="outline"
                              size="sm"
                              onClick={() => fillFromRx(rx)}
                              className="h-6 text-[10px] text-bauhaus-red hover:bg-bauhaus-red/10 px-2"
                            >
                              <Play className="h-2.5 w-2.5 mr-0.5" />
                              {rx.exercise.split(" ").slice(0, 2).join(" ")}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Phase & readiness (today only) */}
                {isToday && (
                  <div className="flex items-center gap-2 mt-3 pt-2.5 border-t-2 border-foreground/10">
                    <Badge variant="outline" className="font-mono text-2xs font-bold">
                      {(session.phase as any)?.name ?? "\u2014"}
                    </Badge>
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

      {/* ── Set Logger ───────────────────────────────────────────── */}
      <Card title="Log a set" icon={<Dumbbell className="h-4 w-4" />}>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
          <Input
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            placeholder="Exercise"
            className="col-span-2"
          />
          <Input
            type="number"
            value={setNumber}
            onChange={(e) => setSetNumber(Number(e.target.value))}
            placeholder="Set #"
          />
          <Input
            type="number"
            step="0.5"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="kg"
          />
          <Input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="Reps"
          />
          <Input
            type="number"
            step="0.5"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder="RPE"
          />
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="col-span-2 sm:col-span-5"
          />
          <Button onClick={submitLog} disabled={busy || !exercise} className="gap-2">
            <Dumbbell className="h-4 w-4" />
            {busy ? "LOGGING..." : "LOG SET"}
          </Button>
        </div>
        {err && (
          <div className="border-2 border-bauhaus-red bg-bauhaus-red/5 px-3 py-2 mt-3">
            <p className="text-bauhaus-red text-sm font-bold">{err}</p>
          </div>
        )}
      </Card>

      {/* ── Today's Sets & Recent ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card title={`Today's sets${todayLogs.length > 0 ? ` (${todayLogs.length})` : ""}`}>
          {loading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          )}
          {!loading && todayLogs.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
                <Dumbbell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Nothing logged yet</p>
            </div>
          )}
          {!loading && todayLogs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exercise</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Reps</TableHead>
                  <TableHead className="text-right">RPE</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="font-bold">{l.exercise}</span>
                      <span className="text-muted-foreground text-xs ml-1 font-mono">#{l.set_number}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {l.weight_kg != null ? `${l.weight_kg} kg` : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">{l.reps ?? "\u2014"}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {l.rpe != null ? `@${l.rpe}` : ""}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-bauhaus-red hover:bg-bauhaus-red/10"
                        onClick={() => deleteLog(l.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card title="Recent (14 d)">
          {loading && (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          )}
          {!loading && earlier.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No earlier sets</p>
            </div>
          )}
          {!loading && earlier.length > 0 && (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Exercise</TableHead>
                    <TableHead className="text-right">Load x Reps</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {earlier.slice(0, 30).map((l) => (
                    <TableRow key={l.id} className="text-xs">
                      <TableCell className="text-muted-foreground font-mono font-bold">{l.day}</TableCell>
                      <TableCell>
                        {l.exercise}
                        <span className="text-muted-foreground ml-1 font-mono">#{l.set_number}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {l.weight_kg ?? "\u2014"} kg x {l.reps ?? "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* ── 1RM Progress ─────────────────────────────────────────── */}
      <Card
        title="1RM Progress"
        icon={<TrendingUp className="h-4 w-4" />}
        action={
          <Input
            value={progressEx}
            onChange={(e) => setProgressEx(e.target.value)}
            placeholder="Exercise name..."
            className="h-8 w-48 text-xs"
          />
        }
      >
        {!progressEx && (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="h-12 w-12 border-2 border-foreground flex items-center justify-center mb-3 shadow-hard-sm">
              <TrendingUp className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">
              Enter an exercise name to see estimated 1RM history
            </p>
          </div>
        )}
        {progressEx && !progress && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        )}
        {progressEx && progress && progress.points.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-muted-foreground text-sm font-bold uppercase tracking-wider">No data for &ldquo;{progressEx}&rdquo;</p>
          </div>
        )}
        {progressEx && progress && progress.points.length > 0 && (
          <>
            <Sparkline
              points={progress.points.map((p) => ({ day: p.day, value: p.est_1rm }))}
              height={80}
              unit="kg"
            />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t-2 border-foreground/10 pt-4">
              <StatRow
                label="Latest est. 1RM"
                value={`${progress.points[progress.points.length - 1].est_1rm.toFixed(1)} kg`}
              />
              <StatRow label="Sessions" value={progress.points.length} />
              <StatRow
                label="Plateau?"
                value={progress.plateau.plateau ? "yes" : "no"}
                hint={progress.plateau.detail as string | undefined}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
