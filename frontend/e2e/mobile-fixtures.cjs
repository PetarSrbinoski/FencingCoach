const day = "2026-09-28",
  now = day + "T10:00:00Z";
const event = {
  id: 1,
  name: "Warsaw International Epee Cup",
  event_date: "2026-10-05",
  end_date: "2026-10-06",
  location: "Warsaw, Poland",
  priority: "A",
  level: "FIE world cup",
  notes: "Arrive the evening before. Equipment check opens at 08:00.",
  result: null,
};
const events = [
  event,
  {
    ...event,
    id: 2,
    name: "Autumn National Championships",
    event_date: "2026-09-20",
    end_date: null,
    result: {
      placing: 12,
      field_size: 96,
      pool_wins: 4,
      pool_losses: 2,
      elimination_outcome: "Round of 16",
      reflection:
        "Good distance control in pools. Work on finishing actions late in bouts.",
    },
  },
];
const profile = {
  id: 1,
  name: "Alex",
  sport: "fencing-epee",
  level: "elite",
  age: 28,
  height_cm: 180,
  weight_kg: 75,
  fencing_style: "distance_control",
  goals: "competition_peak",
  weaknesses: "late_bout_fatigue",
  body_comp_goal: "performance",
  dietary_restrictions: "no peanuts",
  food_preferences: "rice",
  food_budget: "moderate",
  supplements: "Creatine 5 g",
  notes: "Two competitions this autumn.",
};
const readiness = {
  day,
  score: 72,
  band: "green",
  source: "garmin",
  reading_fetched_at: now,
  advisories: {
    sleep: {
      detail: "Good sleep supports your planned training today.",
      value: 85,
    },
    hrv: {
      detail: "Within your usual range; maintain planned intensity.",
      value: 62,
    },
  },
  inputs: {},
};
const logs = [
  {
    id: 1,
    day,
    meal: "breakfast",
    raw_text: "Greek yogurt with oats, banana and honey",
    kcal: 540,
    protein_g: 30,
    carbs_g: 75,
    fat_g: 13,
    fiber_g: 7,
    micros: {},
    estimated_by: "saved",
    logged_at: now,
    version: 1,
  },
  {
    id: 2,
    day,
    meal: "lunch",
    raw_text: "Chicken breast with rice and broccoli",
    kcal: 680,
    protein_g: 45,
    carbs_g: 85,
    fat_g: 18,
    fiber_g: 9,
    micros: {},
    estimated_by: "manual",
    logged_at: now,
    version: 1,
  },
];
const targets = {
  day,
  day_type: "gym",
  phase: "base",
  weight_kg: 75,
  kcal: 2600,
  protein_g: 150,
  carbs_g: 320,
  fat_g: 80,
  fiber_g: 30,
  micros: {},
  notes: "Fuel training with carbohydrate and distribute protein across meals.",
  override_source: "auto",
  goal: "performance",
  baseline_kcal: 2600,
  requested_kcal: 2600,
  baseline_source: "estimated",
  data_cutoff: day,
  policy_version: "v1",
  energy_conflict: null,
  target_source: "ordinary",
  plan_id: null,
  plan_version: null,
  needs_review: false,
};
const activities = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  activity_type: i % 2 ? "strength_training" : "fencing",
  name: i % 2 ? "Strength and power" : "Club fencing session",
  start_time: `2026-09-${String(28 - i).padStart(2, "0")}T18:00:00Z`,
  duration_s: 7200,
  distance_m: null,
  calories: 800,
  avg_hr: 142,
  max_hr: 185,
  training_load: 120,
}));
const foods = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: [
    "Greek yogurt",
    "Cooked white rice",
    "Chicken breast",
    "Rolled oats",
    "Banana",
    "Wholemeal bread",
    "Cottage cheese",
    "Homemade vegetable soup",
  ][i],
  kcal: 120,
  protein_g: 10,
  carbs_g: 15,
  fat_g: 2,
  fiber_g: 1,
  micros: [{ name: "calcium", amount: 125, unit: "mg" }],
  serving_name: "one pot",
  serving_size_g: 150,
  prep_time_min: 5,
}));
const meals = ["breakfast", "lunch", "dinner", "snack"].map((slot, i) => ({
  slot,
  time: ["08:00", "12:00", "19:00", "15:00"][i],
  name: [
    "Greek yogurt with oats and fresh berries",
    "Chicken rice bowl with broccoli",
    "Salmon potatoes and green vegetables",
    "Banana and yogurt",
  ][i],
  ingredients: [
    { name: "Cooked rice", qty_g: 150 },
    { name: "Chicken breast", qty_g: 180 },
  ],
  kcal: 600,
  protein_g: 35,
  carbs_g: 80,
  fat_g: 15,
  notes: "Adjust timing around your training session.",
}));
const planDay = {
  ...targets,
  context: "event",
  training_type: "competition",
  training_source: "auto",
  session_name: null,
  countdown_days: 0,
  ordinary_kcal: 2600,
  ordinary_carbs_g: 320,
  provisional: true,
  explanation: "Competition day demand",
  existing_plan_id: null,
  existing_targets: null,
};
const plan = {
  id: 1,
  event_id: 1,
  event,
  inputs: {
    expected_demand: "high",
    event_format: "multi_day",
    start_time: "09:00",
    resolve_overlaps: false,
  },
  days: Array.from({ length: 10 }, (_, i) => ({
    ...planDay,
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
  })),
  version: 1,
  policy_version: "v1",
  active: true,
  created_at: now,
};
const reference = {
  start: day,
  end: day,
  plan_versions: ["1:v1"],
  days: [
    {
      ...targets,
      training_type: "gym",
      context: "base",
      explanation: "Fuel the scheduled session.",
      diary_url: "/nutrition?day=" + day,
      plan_url: "/nutrition?competition=1",
    },
  ],
};
function data(path, url) {
  if (path === "/settings/llm-provider") return { provider: "local" };
  if (path === "/profile") return profile;
  if (path === "/readiness/today") return readiness;
  if (path === "/brief/today")
    return {
      day,
      summary:
        "## Today\nYour recovery supports the planned session. Keep the warm-up gradual and adjust intensity if you feel unusually tired.\n\n## Training\nFollow the scheduled strength workout, leaving two repetitions in reserve.\n\n## Nutrition\nEat before training and spread your protein across meals.",
      payload: { model: "coach-model" },
      generated_at: now,
    };
  if (path === "/phase/today") return { name: "base" };
  if (path.startsWith("/metrics/"))
    return {
      kind: path.split("/").pop(),
      points: Array.from({ length: 28 }, (_, i) => ({
        day: `2026-09-${String(i + 1).padStart(2, "0")}`,
        value: path.includes("calories")
          ? 2600 + i
          : path.includes("/sleep") && !path.includes("score")
            ? 7.5
            : 60 + (i % 12),
      })),
    };
  if (path === "/activities/recent") return activities;
  if (path === "/diagnostics")
    return {
      generated_at: now,
      window_days: 30,
      metrics: ["sleep", "hrv", "training_readiness"].map((kind) => ({
        kind,
        stale: false,
        last_ok_day: day,
        last_ok_value: 72,
        days_since_ok: 0,
        coverage_days: 28,
        window_days: 30,
      })),
    };
  if (path === "/garmin/status")
    return {
      last_fetch: now,
      metric_rows: 4821,
      last_sync_at: now,
      last_sync_ok: true,
      last_sync_outcome: "complete",
    };
  if (path === "/competitions")
    return url.searchParams.get("upcoming_only") === "true" ? [event] : events;
  if (path === "/nutrition/log") return logs;
  if (path.startsWith("/nutrition/totals/"))
    return {
      day,
      kcal: 1220,
      protein_g: 75,
      carbs_g: 160,
      fat_g: 31,
      fiber_g: 16,
      micros: { calcium_mg: 250, iron_mg: 3 },
      incomplete_micros: ["iron_mg"],
      entry_count: 2,
    };
  if (path.startsWith("/targets/")) return targets;
  if (path === "/nutrition/foods") return foods;
  if (path.startsWith("/mealplan/"))
    return {
      day,
      plan: {
        meals,
        totals: { kcal: 2400, protein_g: 140, carbs_g: 320, fat_g: 60 },
        profile_context: {
          restrictions: "no peanuts",
          preferences: "rice",
          budget: "moderate",
        },
      },
      generated_at: now,
    };
  if (path === "/competition-nutrition/plans") return [plan];
  if (path.includes("/meals")) return [];
  if (path === "/training/week")
    return Array.from({ length: 7 }, (_, i) => ({
      day: `2026-${i < 3 ? "09" : "10"}-${String(i < 3 ? 28 + i : i - 2).padStart(2, "0")}`,
      weekday: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ][i],
      activity_type: i % 3 === 0 ? "gym" : i % 3 === 1 ? "fencing" : "rest",
      source: i === 0 ? "manual" : "auto",
      competitions: [],
      session:
        i % 3 === 0
          ? {
              name: "Strength and power",
              rationale: "Reduced volume for competition preparation",
              exercises: [
                {
                  exercise: "Rear-foot elevated split squat",
                  sets: 3,
                  reps: 8,
                  load_kg: 25,
                },
                {
                  exercise: "Romanian deadlift",
                  sets: 3,
                  reps: 6,
                  load_kg: 80,
                },
                {
                  exercise: "Standing single-arm cable row",
                  sets: 3,
                  reps: 10,
                  load_kg: 20,
                },
              ],
            }
          : null,
      phase: { name: "base" },
      readiness: { band: "green" },
    }));
  if (path === "/fencing/analysis")
    return {
      training_load_trend: "stable",
      session_count: 12,
      window_days: 90,
      avg_duration_min: 120,
      avg_training_load: 110,
      max_hr_estimate: 190,
      max_hr_source: "observed",
      sessions: activities.map((a) => ({
        activity_id: a.id,
        day: a.start_time.slice(0, 10),
        duration_min: 120,
        avg_hr: 142,
        max_hr: 185,
        avg_hr_zone: "Z3",
        max_hr_zone: "Z5",
        training_load: 120,
      })),
    };
  if (path === "/mental/entries")
    return [
      {
        id: 1,
        day,
        entry_type: "check_in",
        mood_score: 7,
        energy_score: 8,
        focus_score: 7,
        confidence_score: 6,
        content:
          "Felt good during training. Need to focus on distance control and staying composed during the final minute. The last exercise was especially useful and I want to repeat it next week.",
      },
    ];
  if (path === "/mental/insight")
    return {
      entry_count: 4,
      period_days: 14,
      avg_mood: 7,
      avg_energy: 7,
      avg_focus: 6,
      avg_confidence: 7,
      trend: "stable",
      insight:
        "Your confidence is stable. Pick one tactical goal for the next session.",
    };
  if (path === "/chat/conversations")
    return [
      {
        id: 1,
        title: "Preparing for the next competition",
        created_at: now,
        updated_at: now,
        message_count: 2,
        last_message_preview: "Here is your plan.",
      },
    ];
  if (path === "/chat/conversations/1")
    return {
      id: 1,
      title: "Preparing for the next competition",
      created_at: now,
      updated_at: now,
      messages: [
        {
          id: 1,
          role: "user",
          content: "What should I eat before my competition?",
          status: "done",
          created_at: now,
        },
        {
          id: 2,
          role: "assistant",
          content:
            "Keep familiar foods before your competition. Here are your recorded nutrition targets.\n\n- Eat your usual breakfast before traveling.\n- Bring your planned snacks and water.\n- Review the dated plan below.",
          status: "done",
          created_at: now,
          nutrition_refs: [reference],
        },
      ],
    };
  if (path === "/agent-actions")
    return {
      items: [
        {
          id: 1,
          kind: "workout",
          status: "committed",
          resource_id: day,
          summary: "Adjusted strength workout for Monday",
          before: null,
          after: {
            session_name: "Strength and power",
            exercises: [{ exercise: "Split squat", sets: 3, reps: 8 }],
          },
          conversation_id: 1,
          conversation_available: true,
          message_id: 2,
          error: null,
          created_at: now,
          undone_at: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    };
  if (path === "/coach-plan-proposals") return [];
  return {};
}

module.exports = { data };
