"use client";

import { useEffect, useState } from "react";
import { api, Profile } from "@/lib/api";
import { Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Save, Loader2, Dumbbell, Target, CheckCircle2, AlertCircle } from "lucide-react";

const BODY_COMP_GOALS = [
  { value: "performance", label: "Performance" },
  { value: "cutting", label: "Cutting (fat loss)" },
  { value: "lean_bulk", label: "Lean Bulk" },
  { value: "maintain", label: "Maintain" },
  { value: "recomp", label: "Recomposition" },
];

const LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "elite", label: "Elite" },
  { value: "professional", label: "Professional" },
];

const FENCING_STYLES = [
  { value: "distance_control", label: "Distance control" },
  { value: "counter_attack", label: "Counter-attack" },
  { value: "first_intention", label: "First intention / initiative" },
  { value: "second_intention", label: "Second intention" },
  { value: "tempo_disruption", label: "Tempo disruption" },
  { value: "athletic_pressure", label: "Athletic pressure" },
  { value: "defensive_tactical", label: "Defensive / tactical" },
];

const ATHLETE_GOALS = [
  { value: "fie_qualification", label: "FIE qualification" },
  { value: "competition_peak", label: "Peak for next competition" },
  { value: "build_aerobic_base", label: "Build aerobic base" },
  { value: "improve_explosiveness", label: "Improve explosiveness" },
  { value: "increase_strength", label: "Increase maximal strength" },
  { value: "improve_recovery", label: "Improve recovery consistency" },
];

const WEAKNESSES = [
  { value: "explosive_speed", label: "Explosive speed" },
  { value: "leg_strength", label: "Leg strength" },
  { value: "leg_endurance", label: "Leg endurance" },
  { value: "cardio_endurance", label: "Cardio endurance" },
  { value: "distance_management", label: "Distance management" },
  { value: "late_bout_fatigue", label: "Late-bout fatigue" },
  { value: "hand_speed", label: "Hand speed" },
  { value: "confidence_under_pressure", label: "Confidence under pressure" },
];

const FOOD_BUDGETS = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "performance_first", label: "Performance first" },
];

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.profile
      .get()
      .then((p) => {
        setProfile(p);
        setForm(p);
      })
      .catch((e) => setErr(e?.message ?? String(e)));
  }, []);

  function update(field: string, value: string | number | null) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const updated = await api.profile.update(form);
      setProfile(updated);
      setForm(updated);
      setMsg("Profile saved successfully.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
            <p className="text-xs text-muted-foreground">Your athlete identity and coaching preferences</p>
          </div>
        </div>
        {profile && (
          <Button onClick={save} disabled={saving} size="lg">
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
      </div>

      {/* Messages */}
      {msg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-emerald-400 text-sm">{msg}</p>
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{err}</p>
        </div>
      )}

      {!profile ? (
        <Card>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic info */}
          <Card title="Athlete Info" icon={<Dumbbell className="h-4 w-4 text-blue-400" />}>
            <div className="space-y-4">
              <Field label="Name">
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Field label="Age">
                <Input
                  type="number"
                  value={form.age ?? ""}
                  onChange={(e) =>
                    update("age", e.target.value ? parseInt(e.target.value) : null)
                  }
                  placeholder="e.g. 28"
                />
              </Field>
              <Field label="Height (cm)">
                <Input
                  type="number"
                  step="0.1"
                  value={form.height_cm ?? ""}
                  onChange={(e) =>
                    update("height_cm", e.target.value ? parseFloat(e.target.value) : null)
                  }
                  placeholder="e.g. 180"
                />
                <FieldNote>
                  Saved in your profile and shown in coach context. It does not currently drive calculations.
                </FieldNote>
              </Field>
              <Field label="Weight (kg)">
                <Input
                  type="number"
                  step="0.1"
                  value={form.weight_kg ?? ""}
                  onChange={(e) =>
                    update("weight_kg", e.target.value ? parseFloat(e.target.value) : null)
                  }
                  placeholder="e.g. 75"
                />
                <FieldNote>
                  Directly affects daily calorie and macro targets through the nutrition target engine.
                </FieldNote>
              </Field>
              <Field label="Sport">
                <Input
                  value={form.sport ?? ""}
                  onChange={(e) => update("sport", e.target.value)}
                  placeholder="e.g. fencing-epee"
                />
              </Field>
              <Field label="Level">
                <Select
                  value={form.level ?? "elite"}
                  onValueChange={(v) => update("level", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fencing Style">
                <Select
                  value={form.fencing_style ?? "distance_control"}
                  onValueChange={(v) => update("fencing_style", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FENCING_STYLES.map((style) => (
                      <SelectItem key={style.value} value={style.value}>
                        {style.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote>
                  Stored in your profile and included in coach context for training and tactical advice.
                </FieldNote>
              </Field>
            </div>
          </Card>

          {/* Goals & Nutrition */}
          <Card title="Goals & Nutrition" icon={<Target className="h-4 w-4 text-emerald-400" />}>
            <div className="space-y-4">
              <Field label="Body Composition Goal">
                <Select
                  value={form.body_comp_goal ?? "performance"}
                  onValueChange={(v) => update("body_comp_goal", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BODY_COMP_GOALS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote>
                  Directly affects calorie targets. Cutting/lean lowers calories; maintain keeps them neutral; gain raises them.
                </FieldNote>
              </Field>
              <Field label="Food Budget">
                <Select
                  value={form.food_budget ?? "moderate"}
                  onValueChange={(v) => update("food_budget", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOOD_BUDGETS.map((budget) => (
                      <SelectItem key={budget.value} value={budget.value}>
                        {budget.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote>
                  Currently saved only. It does not yet change meal-plan generation logic.
                </FieldNote>
              </Field>
              <Field label="Dietary Restrictions">
                <Textarea
                  value={form.dietary_restrictions ?? ""}
                  onChange={(e) => update("dietary_restrictions", e.target.value)}
                  placeholder="e.g. lactose intolerant, no pork"
                  rows={2}
                />
              </Field>
              <Field label="Supplements">
                <Textarea
                  value={form.supplements ?? ""}
                  onChange={(e) => update("supplements", e.target.value)}
                  placeholder="e.g. creatine 5g, whey protein"
                  rows={2}
                />
              </Field>
              <Field label="Goals">
                <Select
                  value={form.goals ?? "fie_qualification"}
                  onValueChange={(v) => update("goals", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATHLETE_GOALS.map((goal) => (
                      <SelectItem key={goal.value} value={goal.value}>
                        {goal.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote>
                  Saved to your profile and injected into coach context. It does not directly change targets by code.
                </FieldNote>
              </Field>
              <Field label="Weaknesses">
                <Select
                  value={form.weaknesses ?? "explosive_speed"}
                  onValueChange={(v) => update("weaknesses", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEAKNESSES.map((weakness) => (
                      <SelectItem key={weakness.value} value={weakness.value}>
                        {weakness.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote>
                  Saved to your profile and injected into coach context. It does not directly change targets by code.
                </FieldNote>
              </Field>
              <Field label="Notes">
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="Any additional notes for your coach AI"
                  rows={2}
                />
              </Field>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function FieldNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground/70 mt-1">{children}</p>;
}
