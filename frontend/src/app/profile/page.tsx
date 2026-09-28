"use client";

import { PageHeading } from "@/components/page-heading";

import { ErrorNotice, UnsavedChangesGuard } from "@/components/mobile-ui";
import { Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api, Profile } from "@/lib/api";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
} from "react";

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
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useToast();

  function loadProfile() {
    setErr(null);
    api.profile
      .get()
      .then((p) => {
        setProfile(p);
        const saved = sessionStorage.getItem("profileDraft");
        try {
          setForm(saved ? { ...p, ...JSON.parse(saved) } : p);
        } catch {
          setForm(p);
        }
      })
      .catch((e) => setErr(e?.message ?? String(e)));
  }
  useEffect(loadProfile, []);

  const dirty =
    profile !== null && JSON.stringify(form) !== JSON.stringify(profile);

  useEffect(() => {
    if (dirty) sessionStorage.setItem("profileDraft", JSON.stringify(form));
    else if (profile) sessionStorage.removeItem("profileDraft");
  }, [dirty, form, profile]);

  function update(field: string, value: string | number | null) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const updated = await api.profile.update(form);
      setProfile(updated);
      setForm(updated);
      sessionStorage.removeItem("profileDraft");
      toast({
        title: "Profile saved",
        description: "Your changes have been saved.",
        variant: "success",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Header */}
      <PageHeading title="Profile" eyebrow="Athlete identity" />

      <UnsavedChangesGuard dirty={dirty} />
      {err && (
        <ErrorNotice message={err} retry={!profile ? loadProfile : undefined} />
      )}
      {dirty && (
        <div className="fixed inset-x-4 bottom-[calc(var(--dock-space)+var(--keyboard-inset,0px))] lg:left-auto lg:right-8 lg:max-w-lg z-40 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setForm(profile!);
                sessionStorage.removeItem("profileDraft");
              }}
            >
              Discard changes
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
          {err && (
            <p role="alert" className="w-full text-sm text-destructive">
              {err}
            </p>
          )}
        </div>
      )}
      {!profile && !err ? (
        <Card>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </Card>
      ) : profile ? (
        <div className="space-y-3 pb-32">
          {/* Basic info */}
          <details
            open
            className="rounded-2xl border border-border bg-card p-4"
          >
            <summary className="font-semibold text-lg">Athlete basics</summary>
            <div className="space-y-4">
              <Field label="Name">
                <Input
                  autoComplete="name"
                  value={form.name ?? ""}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Field label="Age">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.age ?? ""}
                  onChange={(e) =>
                    update(
                      "age",
                      e.target.value ? parseInt(e.target.value) : null,
                    )
                  }
                  placeholder="e.g. 28"
                />
              </Field>
              <Field label="Height (cm)">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  step="0.1"
                  value={form.height_cm ?? ""}
                  onChange={(e) =>
                    update(
                      "height_cm",
                      e.target.value ? parseFloat(e.target.value) : null,
                    )
                  }
                  placeholder="e.g. 180"
                />
                <FieldNote>
                  Saved in your profile and shown in coach context. It does not
                  currently drive calculations.
                </FieldNote>
              </Field>
              <Field label="Weight (kg)">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  step="0.1"
                  value={form.weight_kg ?? ""}
                  onChange={(e) =>
                    update(
                      "weight_kg",
                      e.target.value ? parseFloat(e.target.value) : null,
                    )
                  }
                  placeholder="e.g. 75"
                />
                <FieldNote>
                  Directly affects daily calorie and macro targets through the
                  nutrition target engine.
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
            </div>
          </details>
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="font-semibold text-lg">Training goals</summary>
            <div className="space-y-4 pt-3">
              <Field label="Fencing style">
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
                  Stored in your profile and included in coach context for
                  training and tactical advice.
                </FieldNote>
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
                  Saved to your profile and injected into coach context. It does
                  not directly change targets by code.
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
                  Saved to your profile and injected into coach context. It does
                  not directly change targets by code.
                </FieldNote>
              </Field>
            </div>
          </details>

          {/* Goals & Nutrition */}
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="font-semibold text-lg">
              Nutrition preferences
            </summary>
            <div className="space-y-4">
              <Field label="Body composition goal">
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
                  Performance and maintain use maintenance energy; cutting
                  requests 5% less, lean bulk 5% more, and recomposition uses
                  maintenance with higher protein. Macro bounds can take
                  priority when they conflict with the energy request.
                </FieldNote>
              </Field>
              <Field label="Food budget">
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
                  Used to shape meal-plan choices; no verified price estimate is
                  made.
                </FieldNote>
              </Field>
              <Field label="Dietary restrictions and hard exclusions">
                <Textarea
                  value={form.dietary_restrictions ?? ""}
                  onChange={(e) =>
                    update("dietary_restrictions", e.target.value)
                  }
                  placeholder="e.g. lactose intolerant, no pork"
                  rows={2}
                />
                <FieldNote>
                  Supported examples: no peanuts, dairy-free, gluten-free,
                  vegetarian, vegan, no pork. Unknown wording will require
                  clarification before a new plan can be saved. Ingredient-name
                  checks cannot guarantee packaged-product allergen safety or
                  cross-contact.
                </FieldNote>
              </Field>
              <Field label="Food preferences (soft)">
                <Textarea
                  value={form.food_preferences ?? ""}
                  onChange={(event) =>
                    update("food_preferences", event.target.value)
                  }
                  placeholder="e.g. quick meals, dislike mushrooms"
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
            </div>
          </details>
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="font-semibold text-lg">
              Additional notes
            </summary>
            <div className="space-y-4 pt-3">
              <Field label="Notes">
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="Any additional notes for your coach AI"
                  rows={2}
                />
              </Field>
            </div>
          </details>
        </div>
      ) : null}
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
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {Children.map(children, (child) => {
        if (!isValidElement<{ id?: string; children?: React.ReactNode }>(child))
          return child;
        if (child.type === Input || child.type === Textarea)
          return cloneElement(child, { id });
        if (child.type === Select)
          return cloneElement(child, {
            children: Children.map(child.props.children, (nested) =>
              isValidElement<{ id?: string }>(nested) &&
              nested.type === SelectTrigger
                ? cloneElement(nested, { id })
                : nested,
            ),
          });
        return child;
      })}
    </div>
  );
}

function FieldNote({ children }: { children: React.ReactNode }) {
  return (
    <details className="text-sm text-muted-foreground">
      <summary>How this is used</summary>
      <p className="leading-relaxed">{children}</p>
    </details>
  );
}
