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
export type ReadinessAdvisory = { detail: string; value: number | null };
export type Readiness = {
  day: string;
  score: number | null; // null when Garmin has no training_readiness reading
  band: "red" | "amber" | "green" | "unknown";
  source: "garmin" | "neutral";
  advisories: Record<string, ReadinessAdvisory>;
  inputs: Record<string, number | null>;
  reading_fetched_at: string | null;
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
  version: number;
};

export type NutritionLogEdit = Pick<NutritionLog, "day" | "meal" | "raw_text" | "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g"> & { expected_version: number };
export type NutritionLogRepeat = { day: string; meal: string | null; multiplier: number; request_id: string };

export type FoodNutrient = { name: string; amount: number; unit: "g" | "mg" | "mcg" | "IU" };
export type SavedFoodInput = {
  name: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micros: FoodNutrient[];
  serving_name: string | null;
  serving_size_g: number | null;
  prep_time_min?: number | null;
};
export type SavedFood = SavedFoodInput & { id: number };
export type FoodPortion = { food_id: number; grams?: number; servings?: number };
export type NutritionEstimateItem = {
  name: string; qty_g: number; source?: string; food_id?: number | null;
  nutrients?: Record<string, number>;
};

export type NutritionEstimateStatus = "pending" | "done" | "error";

/** Returned immediately by `POST /nutrition/estimate` — poll
 * `api.nutrition.pollEstimate` for the actual result. */
export type NutritionEstimateAccepted = {
  id: number;
  status: NutritionEstimateStatus;
};

export type NutritionEstimate = {
  id: number;
  status: NutritionEstimateStatus;
  error: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micros: Record<string, number>;
  items: NutritionEstimateItem[];
  confidence: "low" | "medium" | "high" | string | null;
  notes: string;
  incomplete_micros?: string[];
  estimated_by?: string;
};

export type NutritionLogInput = {
  raw_text: string;
  meal?: string;
  day?: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  micros?: Record<string, unknown>;
  items?: NutritionEstimateItem[];
  confidence?: string;
  notes?: string;
  estimated_by?: string;
  incomplete_micros?: string[];
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
  incomplete_micros?: string[];
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
  goal: string;
  baseline_kcal: number;
  requested_kcal: number;
  baseline_source: string;
  data_cutoff: string;
  policy_version: string;
  energy_conflict: string | null;
  target_source: "ordinary" | "accepted";
  plan_id: number | null;
  plan_version: number | null;
  needs_review: boolean;
};

export type CompetitionNutritionInputs = {
  expected_demand: "low" | "moderate" | "high";
  event_format: "single_day" | "multi_day";
  start_time: string | null;
  resolve_overlaps: boolean;
};
export type CompetitionNutritionDay = {
  day: string; context: string; training_type: string; training_source: string;
  session_name: string | null; countdown_days: number;
  kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  ordinary_kcal: number; ordinary_carbs_g: number;
  baseline_source: string; data_cutoff: string; goal: string;
  energy_conflict: string | null; provisional: boolean; explanation: string;
  existing_plan_id: number | null; existing_targets: Record<string, unknown> | null;
};
export type CompetitionNutritionPreview = {
  event: Pick<Competition, "id" | "name" | "event_date" | "end_date" | "priority" | "location">;
  inputs: CompetitionNutritionInputs;
  days: CompetitionNutritionDay[];
  policy_version: string; competing_events: { id: number; name: string; event_date: string; end_date: string }[];
  assumptions: string[]; token: string;
};
export type CompetitionNutritionPlan = {
  id: number; event_id: number; event: CompetitionNutritionPreview["event"];
  inputs: CompetitionNutritionInputs; days: CompetitionNutritionDay[];
  version: number; policy_version: string; active: boolean; created_at: string;
};

export type CompetitionMealInputs = {
  start: string; end: string; start_time: string | null; break_times: string[]; replace_slot: string | null;
  prep_limit_minutes: number | null;
};
export type CompetitionMeal = {
  slot: string; time: string | null; name: string; notes: string;
  ingredients: Array<{ name: string; qty_g: number; source: string; source_id: number; nutrients: Record<string, number | null> }>;
  totals: Record<string, number | null>;
};
export type CompetitionMealDay = {
  day: string; context: string; target_plan_id: number; target_version: number;
  target: Record<string, number>; meals: CompetitionMeal[];
  totals: Record<string, number | null>; deviations: Record<string, number | null>;
  warnings: string[]; replaces_meal_plan_id: number | null;
};
export type CompetitionMealDraft = {
  plan_id: number; plan_version: number; inputs: CompetitionMealInputs;
  days: CompetitionMealDay[]; token: string;
};
export type CompetitionMealPlan = {
  id: number; day: string; target_plan_id: number; target_version: number;
  version: number; meals: CompetitionMeal[]; totals: Record<string, number | null>;
  warnings: string[]; inputs: CompetitionMealInputs; active: boolean; created_at: string;
  needs_review: boolean;
};

export type MealPlan = {
  day: string;
  targets: Record<string, unknown>;
  plan: Record<string, unknown>;
  generated_at: string;
};

export type ShoppingItem = {
  name: string;
  qty_g: number;
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
  session: { name: string; exercises: ExerciseRx[]; rationale?: string } | null;
  phase: Record<string, unknown>;
  readiness: Record<string, unknown>;
  reason?: string | null;
  source: "auto" | "manual";
  activity_type: "competition" | "gym" | "fencing" | "rest";
  competitions: Pick<Competition, "id" | "name" | "location" | "event_date" | "end_date" | "priority">[];
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

export type FencingSession = {
  activity_id: number;
  day: string;
  duration_min: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_hr_zone: string | null;
  max_hr_zone: string | null;
  training_load: number | null;
  calories: number | null;
};

export type FencingAnalysis = {
  window_days: number;
  session_count: number;
  max_hr_estimate: number | null;
  max_hr_source: string;
  sessions: FencingSession[];
  avg_duration_min: number | null;
  avg_training_load: number | null;
  weekly_session_counts: Record<string, number>;
  training_load_trend: "increasing" | "decreasing" | "stable" | "insufficient_data";
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

export type MetricDiagnostic = {
  kind: string;
  last_ok_day: string | null;
  last_ok_value: number | null;
  last_fetched_at: string | null;
  coverage_days: number;
  window_days: number;
  days_since_ok: number | null;
  stale: boolean;
};

export type Diagnostics = {
  generated_at: string;
  window_days: number;
  metrics: MetricDiagnostic[];
};

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
  food_preferences: string | null;
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

export type ChatMessageStatusValue = "pending" | "done" | "error";

export type CoachMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status: ChatMessageStatusValue;
  nutrition_refs?: NutritionAnswerReference[];
};

export type NutritionAnswerReference = {
  start: string;
  end: string;
  plan_versions: string[];
  days?: Array<{ day: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; training_type: string; context: string; explanation: string; target_source: string; plan_url: string | null; diary_url: string; plan_version: number | null }>;
};

export type AgentAction = {
  id: number;
  kind: string;
  status: string;
  resource_id: string | number;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  conversation_id: number | null;
  conversation_available: boolean;
  message_id: number | null;
  error: string | null;
  created_at: string;
  undone_at: string | null;
};
export type CoachPlanProposal = {
  id: number; event_id: number; inputs: CompetitionNutritionInputs;
  preview: CompetitionNutritionPreview; token: string;
  status: "pending" | "applied" | "cancelled";
  conversation_id: number | null; message_id: number | null;
  applied_plan_id: number | null; action_id: number | null; created_at: string;
};

/** Returned immediately by `POST /chat` — poll `api.chatMessages.poll`
 * for the actual reply. */
export type ChatAccepted = {
  conversation_id: number;
  message_id: number;
  status: ChatMessageStatusValue;
};

/** Poll response for a chat message (see `api.chatMessages.poll`). */
export type ChatMessagePoll = {
  id: number;
  status: ChatMessageStatusValue;
  content: string;
  model: string | null;
  context_snapshot: string | null;
  ungrounded_claims: string[];
  nutrition_refs: NutritionAnswerReference[];
  error: string | null;
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

  /** Stores the athlete's turn and returns immediately (202) — the reply
   * generates in the background on the server (see backend/app/api/chat.py)
   * and keeps going even if the page is navigated away from. Poll
   * `api.chatMessages.poll(message_id)` for the result. */
  chat: (message: string, conversation_id?: number, include_context = true) =>
    request<ChatAccepted>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversation_id, include_context }),
    }),
  chatMessages: {
    poll: (messageId: number) => request<ChatMessagePoll>(`/chat/messages/${messageId}`),
  },
  chatConversations: {
    list: () => request<CoachConversationSummary[]>("/chat/conversations"),
    get: (id: number) => request<CoachConversation>(`/chat/conversations/${id}`),
    delete: (id: number) => request<void>(`/chat/conversations/${id}`, { method: "DELETE" }),
  },
  agentActions: {
    list: (params: { page?: number; kind?: string; status?: string; start?: string; end?: string } = {}) =>
      request<{ items: AgentAction[]; total: number; page: number; page_size: number }>(`/agent-actions?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])).toString()}`),
    undo: (id: number, requestId: string) => request<AgentAction>(`/agent-actions/${id}/undo`, { method: "POST", body: JSON.stringify({ request_id: requestId }) }),
  },
  coachPlanProposals: {
    list: (conversationId?: number) => request<CoachPlanProposal[]>(`/coach-plan-proposals${conversationId ? `?conversation_id=${conversationId}` : ""}`),
    apply: (id: number) => request<CoachPlanProposal>(`/coach-plan-proposals/${id}/apply`, { method: "POST" }),
    cancel: (id: number) => request<CoachPlanProposal>(`/coach-plan-proposals/${id}/cancel`, { method: "POST" }),
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
      request<{ last_fetch: string | null; metric_rows: number; last_sync_at: string | null; last_sync_ok: boolean | null }>("/garmin/status"),
  },

  diagnostics: {
    get: (windowDays = 30) =>
      request<Diagnostics>(`/diagnostics?window_days=${windowDays}`),
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
    /** Kicks off macro estimation and returns immediately (202) — the
     * LLM call runs in the background on the server and keeps going
     * even if the page is navigated away from. Poll
     * `api.nutrition.pollEstimate(id)` for the result. */
    estimate: (text: string) =>
      request<NutritionEstimateAccepted>("/nutrition/estimate", {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    pollEstimate: (id: number) => request<NutritionEstimate>(`/nutrition/estimate/${id}`),
    log: (entry: NutritionLogInput) =>
      request<NutritionLog>("/nutrition/log", {
        method: "POST",
        body: JSON.stringify(entry),
      }),
    list: (days = 7) => request<NutritionLog[]>(`/nutrition/log?days=${days}`),
    forDay: (day: string) => request<NutritionLog[]>(`/nutrition/log?day=${day}`),
    edit: (id: number, entry: NutritionLogEdit) => request<NutritionLog>(`/nutrition/log/${id}`, {
      method: "PUT", body: JSON.stringify(entry),
    }),
    repeat: (id: number, entry: NutritionLogRepeat) => request<NutritionLog>(`/nutrition/log/${id}/repeat`, {
      method: "POST", body: JSON.stringify(entry),
    }),
    totals: (day: string) => request<NutritionDayTotals>(`/nutrition/totals/${day}`),
    delete: (id: number) =>
      request<void>(`/nutrition/log/${id}`, { method: "DELETE" }),
  },

  foods: {
    list: (q = "") => request<SavedFood[]>(`/nutrition/foods?q=${encodeURIComponent(q)}`),
    create: (food: SavedFoodInput) => request<SavedFood>("/nutrition/foods", {
      method: "POST", body: JSON.stringify(food),
    }),
    update: (id: number, food: SavedFoodInput) => request<SavedFood>(`/nutrition/foods/${id}`, {
      method: "PUT", body: JSON.stringify(food),
    }),
    delete: (id: number) => request<void>(`/nutrition/foods/${id}`, { method: "DELETE" }),
    log: (portions: FoodPortion[], meal?: string, day?: string) => request<NutritionLog>("/nutrition/foods/log", {
      method: "POST", body: JSON.stringify({ portions, meal, day }),
    }),
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

  settings: {
    getLlmProvider: () => request<{ provider: string }>("/settings/llm-provider"),
    setLlmProvider: (provider: "local" | "cloud") =>
      request<{ provider: string }>("/settings/llm-provider", {
        method: "PUT",
        body: JSON.stringify({ provider }),
      }),
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

  competitionNutrition: {
    preview: (eventId: number, inputs: CompetitionNutritionInputs) => request<CompetitionNutritionPreview>(`/competition-nutrition/preview/${eventId}`, {
      method: "POST", body: JSON.stringify(inputs),
    }),
    accept: (eventId: number, inputs: CompetitionNutritionInputs, token: string, acceptanceId: string) => request<CompetitionNutritionPlan>("/competition-nutrition/accept", {
      method: "POST", body: JSON.stringify({ event_id: eventId, inputs, token, acceptance_id: acceptanceId }),
    }),
    plans: () => request<CompetitionNutritionPlan[]>("/competition-nutrition/plans"),
    deactivationPreview: (id: number) => request<{ plan_id: number; version: number; days: { day: string; old_targets: Record<string, unknown> }[]; token: string }>(`/competition-nutrition/plans/${id}/deactivation-preview`),
    deactivate: (id: number, token: string) => request<CompetitionNutritionPlan>(`/competition-nutrition/plans/${id}/deactivate`, {
      method: "POST", body: JSON.stringify({ token }),
    }),
  },
  competitionMeals: {
    history: (planId: number) => request<CompetitionMealPlan[]>(`/competition-nutrition/plans/${planId}/meals`),
    preview: (planId: number, inputs: CompetitionMealInputs) => request<CompetitionMealDraft>(`/competition-nutrition/plans/${planId}/meals/preview`, { method: "POST", body: JSON.stringify(inputs) }),
    accept: (planId: number, draft: CompetitionMealDraft, acceptanceId: string) => request<CompetitionMealPlan[]>(`/competition-nutrition/plans/${planId}/meals/accept`, { method: "POST", body: JSON.stringify({ inputs: draft.inputs, token: draft.token, acceptance_id: acceptanceId }) }),
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
    clearOverride: (day: string) =>
      request<TrainingSession>(`/training/session/${day}/override`, {
        method: "DELETE",
      }),
  },

  fencing: {
    analysis: (windowDays = 90) =>
      request<FencingAnalysis>(`/fencing/analysis?window_days=${windowDays}`),
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
    clearResult: (id: number) => request<void>(`/competitions/${id}/result`, { method: "DELETE" }),
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
