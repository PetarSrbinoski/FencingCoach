// Tiny typed API client for the FastAPI backend.
// No auth — single-user app, reachable only via Tailscale.

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── shared types ─────────────────────────────────────────────────────
export type ReadinessComponent = { score: number; weight: number; detail: string };
export type Readiness = {
  day: string;
  score: number;
  band: "red" | "amber" | "green";
  components: Record<string, ReadinessComponent>;
  inputs: Record<string, number | null>;
};

export type MetricSeries = {
  kind: string;
  points: { day: string; value: number | null }[];
};

export type Activity = {
  id: number;
  activity_type: string | null;
  name: string | null;
  start_time: string;
  duration_s: number | null;
  distance_m: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
};

export type NutritionLog = {
  id: number;
  day: string;
  meal: string | null;
  raw_text: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micros: Record<string, unknown> | null;
  estimated_by: string | null;
  logged_at: string;
};

export type NutritionDayTotals = {
  day: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  micros: Record<string, number>;
  entry_count: number;
};

export type Brief = {
  day: string;
  readiness_score: number | null;
  summary: string;
  payload: { readiness?: Readiness; model?: string } | null;
  generated_at: string;
};

export type Phase = {
  name: string;
  days_to_event: number | null;
  next_event_id: number | null;
  next_event_name: string | null;
  next_event_date: string | null;
  notes: string;
};

export type Targets = {
  day: string;
  day_type: string;
  phase: string;
  weight_kg: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  micros: Record<string, number>;
  notes: string;
  override_source: string;
};

export type MealPlan = {
  day: string;
  targets: Record<string, unknown>;
  plan: Record<string, unknown>;
  generated_at: string;
};

export type ShoppingItem = {
  name: string;
  amount?: number | string;
  unit?: string;
  category?: string;
  [k: string]: unknown;
};

export type ShoppingList = {
  start: string;
  end: string;
  days_covered: string[];
  missing_days: string[];
  items: ShoppingItem[];
  item_count: number;
};

export type ExerciseRx = {
  exercise: string;
  sets: number;
  reps: number;
  load_kg: number | null;
  target_rpe: number;
  intent: string;
  notes: string;
};

export type TrainingSession = {
  day: string;
  weekday: string;
  session: { name: string; exercises: ExerciseRx[] } | null;
  phase: Record<string, unknown>;
  readiness: Record<string, unknown>;
  reason?: string | null;
};

export type WorkoutLog = {
  id: number;
  day: string;
  exercise: string;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  notes: string | null;
  logged_at: string;
};

export type ExerciseProgress = {
  exercise: string;
  points: { day: string; est_1rm: number; weight_kg: number; reps: number }[];
  plateau: { plateau: boolean; detail?: string; [k: string]: unknown };
};

export type Competition = {
  id: number;
  name: string;
  location: string | null;
  event_date: string;
  end_date: string | null;
  level: string | null;
  priority: string;
  notes: string | null;
  result: Record<string, unknown> | null;
};
export type CompetitionInput = Omit<Competition, "id" | "result">;

export type Profile = {
  id: number;
  name: string | null;
  sport: string;
  level: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  fencing_style: string | null;
  goals: string | null;
  weaknesses: string | null;
  body_comp_goal: string | null;
  dietary_restrictions: string | null;
  food_budget: string | null;
  supplements: string | null;
  notes: string | null;
};
export type ProfileInput = Omit<Profile, "id">;

export type MentalEntry = {
  id: number;
  day: string;
  entry_type: "check_in" | "pre_comp" | "reflection";
  mood_score: number | null;
  energy_score: number | null;
  focus_score: number | null;
  confidence_score: number | null;
  content: string | null;
  tags: Record<string, unknown> | null;
  created_at: string;
};

export type MentalEntryInput = {
  entry_type: "check_in" | "pre_comp" | "reflection";
  mood_score?: number;
  energy_score?: number;
  focus_score?: number;
  confidence_score?: number;
  content?: string;
  tags?: string[];
  day?: string;
};

export type MentalInsight = {
  period_days: number;
  entry_count: number;
  avg_mood: number | null;
  avg_energy: number | null;
  avg_focus: number | null;
  avg_confidence: number | null;
  trend: "improving" | "stable" | "declining";
  insight: string;
};

export type CoachMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type CoachConversation = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: CoachMessage[];
};

export type CoachConversationSummary = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
};

// ── api ──────────────────────────────────────────────────────────────
export const api = {
  health: () =>
    request<{ status: string; db: boolean; llm: boolean; version: string }>("/health"),

  chat: (message: string, conversation_id?: number, include_context = true) =>
    request<{
      conversation_id: number;
      reply: string;
      model: string;
      prompt_tokens?: number;
      completion_tokens?: number;
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversation_id, include_context }),
    }),
  chatConversations: {
    list: () => request<CoachConversationSummary[]>("/chat/conversations"),
    get: (id: number) => request<CoachConversation>(`/chat/conversations/${id}`),
    delete: (id: number) => request<void>(`/chat/conversations/${id}`, { method: "DELETE" }),
  },

  garmin: {
    login: (email: string, password: string) =>
      request<{ status: string }>("/garmin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    syncRecent: (days = 2) =>
      request<{ ok: boolean; fetched: Record<string, unknown>; error?: string }>(
        `/garmin/sync/recent?days=${days}`,
        { method: "POST" }
      ),
    // Default (30) matches the backend's nightly maintenance full-sync
    // window (GARMIN_FULL_SYNC_DAYS). Callers doing a one-time deep
    // historical backfill should pass an explicit larger value (e.g. 365).
    syncFull: (days = 30) =>
      request<{ ok: boolean; fetched: Record<string, unknown>; error?: string }>(
        `/garmin/sync/full?days=${days}`,
        { method: "POST" }
      ),
    status: () =>
      request<{ last_fetch: string | null; metric_rows: number }>("/garmin/status"),
  },

  readiness: {
    today: () => request<Readiness>("/readiness/today"),
    forDay: (day: string) => request<Readiness>(`/readiness/${day}`),
  },

  metrics: {
    series: (kind: string, days = 30) =>
      request<MetricSeries>(`/metrics/${kind}?days=${days}`),
  },

  activities: {
    recent: (days = 14) => request<Activity[]>(`/activities/recent?days=${days}`),
  },

  nutrition: {
    log: (text: string, meal?: string, day?: string) =>
      request<NutritionLog>("/nutrition/log", {
        method: "POST",
        body: JSON.stringify({ text, meal, day }),
      }),
    list: (days = 7) => request<NutritionLog[]>(`/nutrition/log?days=${days}`),
    totals: (day: string) => request<NutritionDayTotals>(`/nutrition/totals/${day}`),
    delete: (id: number) =>
      request<void>(`/nutrition/log/${id}`, { method: "DELETE" }),
  },

  brief: {
    today: () => request<Brief | null>("/brief/today"),
    generate: () => request<Brief>("/brief/today", { method: "POST" }),
    forDay: (day: string) => request<Brief | null>(`/brief/${day}`),
  },

  phase: {
    today: () => request<Phase>("/phase/today"),
  },

  targets: {
    today: () => request<Targets>("/targets/today"),
    forDay: (day: string) => request<Targets>(`/targets/${day}`),
    setDayType: (day: string, dayType: string) =>
      request<{ day: string; day_type: string; source: string }>(`/targets/day-type/${day}`, {
        method: "PUT",
        body: JSON.stringify({ day_type: dayType }),
      }),
    clearDayType: (day: string) =>
      request<{ day: string; source: string }>(`/targets/day-type/${day}`, { method: "DELETE" }),
  },

  mealplan: {
    get: (day: string) => request<MealPlan | null>(`/mealplan/${day}`),
    generateToday: () => request<MealPlan>("/mealplan/today", { method: "POST" }),
    generateDay: (day: string) =>
      request<MealPlan>(`/mealplan/${day}`, { method: "POST" }),
    generateWeek: (start?: string) =>
      request<MealPlan[]>(
        `/mealplan/week${start ? `?start=${start}` : ""}`,
        { method: "POST" }
      ),
  },

  shopping: {
    week: (start?: string) =>
      request<ShoppingList>(`/shopping/week${start ? `?start=${start}` : ""}`),
    range: (start: string, end: string) =>
      request<ShoppingList>(`/shopping/range?start=${start}&end=${end}`),
  },

  training: {
    today: () => request<TrainingSession>("/training/today"),
    forDay: (day: string) => request<TrainingSession>(`/training/session/${day}`),
    week: (start?: string) =>
      request<TrainingSession[]>(
        `/training/week${start ? `?start=${start}` : ""}`
      ),
    exercises: () => request<string[]>("/training/exercises"),
    log: (entry: {
      exercise: string;
      set_number: number;
      reps?: number;
      weight_kg?: number;
      rpe?: number;
      notes?: string;
      day?: string;
    }) =>
      request<WorkoutLog>("/training/log", {
        method: "POST",
        body: JSON.stringify(entry),
      }),
    listLog: (days = 14, exercise?: string) =>
      request<WorkoutLog[]>(
        `/training/log?days=${days}${exercise ? `&exercise=${encodeURIComponent(exercise)}` : ""}`
      ),
    deleteLog: (id: number) =>
      request<void>(`/training/log/${id}`, { method: "DELETE" }),
    progress: (exercise: string, days = 180) =>
      request<ExerciseProgress>(
        `/training/progress/${encodeURIComponent(exercise)}?days=${days}`
      ),
  },

  competitions: {
    list: (upcomingOnly = false) =>
      request<Competition[]>(
        `/competitions${upcomingOnly ? "?upcoming_only=true" : ""}`
      ),
    get: (id: number) => request<Competition>(`/competitions/${id}`),
    create: (body: CompetitionInput) =>
      request<Competition>("/competitions", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: number, body: CompetitionInput) =>
      request<Competition>(`/competitions/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    setResult: (id: number, result: Record<string, unknown>) =>
      request<Competition>(`/competitions/${id}/result`, {
        method: "PATCH",
        body: JSON.stringify(result),
      }),
    delete: (id: number) =>
      request<void>(`/competitions/${id}`, { method: "DELETE" }),
  },

  profile: {
    get: () => request<Profile>("/profile"),
    update: (body: Partial<ProfileInput>) =>
      request<Profile>("/profile", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
  },

  mental: {
    create: (entry: MentalEntryInput) =>
      request<MentalEntry>("/mental/entry", {
        method: "POST",
        body: JSON.stringify(entry),
      }),
    list: (days = 14, entryType?: string) =>
      request<MentalEntry[]>(
        `/mental/entries?days=${days}${entryType ? `&entry_type=${entryType}` : ""}`
      ),
    insight: (days = 14) =>
      request<MentalInsight>(`/mental/insight?days=${days}`),
    delete: (id: number) =>
      request<void>(`/mental/entry/${id}`, { method: "DELETE" }),
  },
};
