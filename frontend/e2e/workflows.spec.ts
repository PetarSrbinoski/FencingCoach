import { expect, test, type Page, type Route } from "@playwright/test";

const day = "2026-10-05";
const now = "2026-09-28T10:00:00Z";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body),
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}

async function mockApi(page: Page, handler: (route: Route, path: string) => Promise<void>) {
  await page.route("http://localhost:8000/**", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } }); return; }
    await handler(route, new URL(route.request().url()).pathname);
  });
}

test("profile saves separate dietary exclusions and soft preferences across reload", async ({ page }) => {
  let profile = { id: 1, name: "Athlete", sport: "fencing-epee", level: "elite", age: 25,
    height_cm: 180, weight_kg: 75, fencing_style: null, goals: null, weaknesses: null,
    body_comp_goal: "performance", dietary_restrictions: "no peanuts", food_preferences: "rice",
    food_budget: "low", supplements: null, notes: null };
  await mockApi(page, async (route, path) => {
    if (path === "/profile") {
      if (route.request().method() === "PUT") profile = { ...profile, ...route.request().postDataJSON() };
      return json(route, profile);
    }
    if (path === "/readiness/today") return json(route, { day, score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {} });
    return json(route, {});
  });
  await page.goto("/profile");
  await expect(page.getByLabel("Dietary restrictions and hard exclusions")).toHaveValue("no peanuts");
  await page.getByLabel("Dietary restrictions and hard exclusions").fill("no peanuts; no pork");
  await page.getByLabel("Food preferences (soft)").fill("prefer rice; dislike eggs");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Dietary restrictions and hard exclusions")).toHaveValue("no peanuts; no pork");
  await expect(page.getByLabel("Food preferences (soft)")).toHaveValue("prefer rice; dislike eggs");
  await expect(page.getByText("no verified price estimate", { exact: false })).toBeVisible();
});

test("chat shows durable action receipts, guarded Undo, and a read-only target answer", async ({ page }) => {
  let undone = false;
  const action = { id: 7, kind: "workout", status: "committed", resource_id: day,
    summary: `Set workout for ${day}: custom session`, before: null,
    after: { session_name: "custom session", exercises: [{ exercise: "Squat", sets: 3, reps: 5 }], notes: null, revision: "a" },
    conversation_id: 1, conversation_available: true, message_id: 2, error: null, created_at: now, undone_at: null };
  const answer = { start: day, end: day, plan_versions: ["3:v1"], days: [{ day, kcal: 2500, protein_g: 150, carbs_g: 300, fat_g: 80,
    training_type: "gym", context: "preparation", explanation: "Preparation carbohydrate target", target_source: "accepted", plan_version: 1,
    plan_url: "/nutrition?competition=1", diary_url: `/nutrition?day=${day}` }] };
  await mockApi(page, async (route, path) => {
    if (path === "/chat/conversations") return json(route, [{ id: 1, title: "Competition preparation", created_at: now, updated_at: now, message_count: 2, last_message_preview: "Competition preparation" }]);
    if (path === "/chat/conversations/1") return json(route, { id: 1, title: "Competition preparation", created_at: now, updated_at: now,
      messages: [{ id: 1, role: "user", content: "What are my macros?", created_at: now, status: "done" },
        { id: 2, role: "assistant", content: "Here are your saved targets.", created_at: now, status: "done", nutrition_refs: [answer] }] });
    if (path === "/agent-actions") return json(route, { items: [{ ...action, status: undone ? "undone" : "committed", undone_at: undone ? now : null }], total: 1, page: 1, page_size: 20 });
    if (path === "/agent-actions/7/undo") { undone = true; return json(route, { ...action, status: "undone", undone_at: now }); }
    if (path === "/coach-plan-proposals") return json(route, []);
    return json(route, {});
  });
  await page.goto("/chat");
  await expect(page.getByText("Nutrition targets", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Diary" })).toHaveAttribute("href", `/nutrition?day=${day}`);
  await page.getByRole("button", { name: "Agent logs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agent logs" });
  await expect(dialog.getByText(`Set workout for ${day}: custom session`, { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Preview Undo" }).click();
  await expect(dialog.getByText("Later edits are protected.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Preview Undo" }).click();
  await dialog.getByRole("button", { name: "Confirm Undo" }).click();
  await expect(dialog.getByText("Status: undone", { exact: false })).toBeVisible();
});

test("coach nutrition proposal is visibly reviewed before Apply", async ({ page }) => {
  let applied = false;
  const proposal = { id: 5, event_id: 1, inputs: { expected_demand: "high", event_format: "single_day", start_time: "09:00", resolve_overlaps: false },
    preview: { event: { id: 1, name: "Cup", event_date: day, end_date: null, priority: "A", location: null },
      days: [{ day, context: "event", training_type: "competition", kcal: 2800, protein_g: 150, carbs_g: 500, fat_g: 60,
        existing_targets: null }], assumptions: ["Event demand is high"], token: "x" },
    token: "x", status: "pending", conversation_id: 1, message_id: 2, applied_plan_id: null, action_id: null, created_at: now };
  await mockApi(page, async (route, path) => {
    if (path === "/chat/conversations") return json(route, [{ id: 1, title: "Plan", created_at: now, updated_at: now, message_count: 2, last_message_preview: "Plan" }]);
    if (path === "/chat/conversations/1") return json(route, { id: 1, title: "Plan", created_at: now, updated_at: now, messages: [
      { id: 1, role: "user", content: "Prepare my plan", created_at: now, status: "done" },
      { id: 2, role: "assistant", content: "Review the preview below.", created_at: now, status: "done" }] });
    if (path === "/coach-plan-proposals" && route.request().method() === "GET") return json(route, [{ ...proposal, status: applied ? "applied" : "pending", applied_plan_id: applied ? 9 : null, action_id: applied ? 10 : null }]);
    if (path === "/coach-plan-proposals/5/apply") { applied = true; return json(route, { ...proposal, status: "applied", applied_plan_id: 9, action_id: 10 }); }
    if (path === "/agent-actions") return json(route, { items: [], total: 0, page: 1, page_size: 20 });
    return json(route, {});
  });
  await page.goto("/chat");
  await expect(page.getByText("No targets have changed", { exact: false })).toBeVisible();
  await expect(page.getByText("2800 kcal", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Apply plan" }).click();
  await expect(page.getByText("Accepted targets are active", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open accepted plan" })).toHaveAttribute("href", "/nutrition?competition=1&plan=9");
});

test("dated nutrition page shows meal draft and accepts without claiming consumption", async ({ page }) => {
  let accepted = false;
  const event = { id: 1, name: "Cup", event_date: day, end_date: null, location: null, priority: "A", level: null, notes: null, result: null };
  const planDay = { day, context: "event", training_type: "competition", training_source: "auto", kcal: 2800, protein_g: 150, carbs_g: 500, fat_g: 60,
    fiber_g: 25, ordinary_kcal: 2400, ordinary_carbs_g: 300, explanation: "Event demand", existing_plan_id: null };
  const plan = { id: 1, event_id: 1, event, inputs: { expected_demand: "high", event_format: "single_day", start_time: "09:00", resolve_overlaps: false },
    days: [planDay], version: 1, policy_version: "v1", active: true, created_at: now };
  const meal = { slot: "before_event", time: "07:00", name: "Rice and Yogurt", ingredients: [{ name: "Rice", qty_g: 150, source: "saved", source_id: 1 }],
    totals: { kcal: 540, protein_g: 10, carbs_g: 120, fat_g: 2, fiber_g: null }, notes: "Known source" };
  const draft = { plan_id: 1, plan_version: 1, inputs: { start: day, end: day, start_time: "09:00", break_times: [], replace_slot: null }, token: "x",
    days: [{ day, context: "event", target_plan_id: 1, target_version: 1, target: planDay,
      meals: [meal], totals: meal.totals, deviations: { kcal: -2260, protein_g: -140, carbs_g: -380, fat_g: -58 },
      warnings: ["Portions differ from target"], replaces_meal_plan_id: null }] };
  const profile = { id: 1, name: "Athlete", sport: "fencing-epee", level: "elite", age: 25, height_cm: 180, weight_kg: 75,
    fencing_style: null, goals: null, weaknesses: null, body_comp_goal: "performance", dietary_restrictions: "no peanuts",
    food_preferences: "rice", food_budget: "moderate", supplements: null, notes: null };
  await mockApi(page, async (route, path) => {
    if (path === "/profile") return json(route, profile);
    if (path === "/readiness/today") return json(route, { day, score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {}, reading_fetched_at: null });
    if (path === `/mealplan/${day}`) return json(route, null);
    if (path === "/nutrition/log" && route.request().method() === "GET") return json(route, []);
    if (path === `/nutrition/totals/${day}`) return json(route, { day, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, micros: {}, entry_count: 0 });
    if (path === `/targets/${day}`) return json(route, { day, day_type: "competition", phase: "comp", weight_kg: 75,
      kcal: 2800, protein_g: 150, carbs_g: 500, fat_g: 60, fiber_g: 25, micros: {}, notes: "Event demand", override_source: "auto",
      goal: "performance", baseline_kcal: 2400, requested_kcal: 2400, baseline_source: "estimated", data_cutoff: day,
      policy_version: "v1", energy_conflict: null, target_source: "accepted", plan_id: 1, plan_version: 1, needs_review: false });
    if (path === "/competitions") return json(route, [event]);
    if (path === "/competition-nutrition/plans") return json(route, [plan]);
    if (path === "/competition-nutrition/plans/1/meals" && route.request().method() === "GET") return json(route, accepted ? [{ id: 2, day, target_plan_id: 1,
      target_version: 1, version: 1, meals: [meal], totals: meal.totals, warnings: [], inputs: draft.inputs, active: true, needs_review: false, created_at: now }] : []);
    if (path === "/competition-nutrition/plans/1/meals/preview") return json(route, draft);
    if (path === "/competition-nutrition/plans/1/meals/accept") { accepted = true; return json(route, [{ id: 2, day, target_plan_id: 1,
      target_version: 1, version: 1, meals: [meal], totals: meal.totals, warnings: [], inputs: draft.inputs, active: true, needs_review: false, created_at: now }], 201); }
    if (path === "/nutrition/foods") return json(route, []);
    return json(route, {});
  });
  await page.goto(`/nutrition?day=${day}&competition=1`);
  await expect(page.getByLabel("Diary date")).toHaveValue(day);
  await page.getByText("Accepted plan history").click();
  await page.getByRole("button", { name: "Generate meals" }).click();
  await expect(page.getByText("Draft ·", { exact: false })).toBeVisible();
  await expect(page.getByText("150 g Rice", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Accept these meals" }).click();
  await expect(page.getByText("No food was logged as consumed", { exact: false })).toBeVisible();
});

test("competition results validate, save, and clear on the selected event", async ({ page }) => {
  const event = { id: 7, name: "Autumn Cup", event_date: "2026-09-20", end_date: "2026-09-21", location: "Skopje", level: "national", priority: "A", notes: null, result: null as Record<string, unknown> | null };
  await mockApi(page, async (route, path) => {
    if (path === "/competitions" && route.request().method() === "GET") return json(route, [event]);
    if (path === "/competitions/7/result" && route.request().method() === "PATCH") { event.result = route.request().postDataJSON(); return json(route, event); }
    if (path === "/competitions/7/result" && route.request().method() === "DELETE") { event.result = null; return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }); }
    if (path === "/readiness/today") return json(route, { day: "2026-09-28", score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {}, reading_fetched_at: null });
    return json(route, {});
  });
  await page.goto("/competitions#competition-7");
  await page.getByRole("button", { name: "Add result" }).click();
  await page.getByLabel("Placing").fill("65");
  await page.getByLabel("Field size").fill("64");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByRole("alert").getByText("placing cannot exceed field size", { exact: false })).toBeVisible();
  await page.getByLabel("Placing").fill("2");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText("Place 2 of 64")).toBeVisible();
  await page.getByRole("button", { name: "Clear result", exact: true }).click();
  await page.getByRole("dialog", { name: "Clear competition result?" }).getByRole("button", { name: "Clear result" }).click();
  await expect(page.getByText("No result yet")).toBeVisible();
});

test("Garmin page refreshes readiness and persistent sync status after sync", async ({ page }) => {
  let synced = false;
  await mockApi(page, async (route, path) => {
    if (path === "/garmin/status") return json(route, { last_fetch: synced ? now : null, metric_rows: synced ? 8 : 0, last_sync_at: synced ? now : null, last_sync_ok: synced ? true : null });
    if (path === "/readiness/today") return json(route, { day: "2026-09-28", score: synced ? 72 : null,
      band: synced ? "green" : "unknown", source: synced ? "garmin" : "neutral", advisories: {}, inputs: {}, reading_fetched_at: synced ? now : null });
    if (path === "/garmin/sync/recent") { synced = true; return json(route, { ok: true, fetched: { metrics: 8 } }); }
    if (path === "/diagnostics") return json(route, { generated_at: now, window_days: 30, metrics: [] });
    return json(route, {});
  });
  await page.goto("/garmin");
  await expect(page.getByText("Today’s readiness", { exact: false }).or(page.getByText("Today's readiness", { exact: false }))).toBeVisible();
  await page.locator("button").filter({ hasText: "Last 2 days" }).click();
  await expect(page.getByText("Sync complete; readiness is 72", { exact: false })).toBeVisible();
  await expect(page.getByText("Last sync attempt:", { exact: false })).toBeVisible();
});

test("dated diary edit conflict and repeat keep the selected day", async ({ page }) => {
  let conflict = true;
  const entry = { id: 1, day, meal: "lunch", raw_text: "Rice bowl", kcal: 500, protein_g: 20, carbs_g: 80, fat_g: 10,
    fiber_g: null, micros: {}, estimated_by: "manual", logged_at: now, version: 1 };
  const logs = [entry];
  await mockApi(page, async (route, path) => {
    if (path === "/profile") return json(route, { id: 1, weight_kg: 75, dietary_restrictions: null, food_preferences: null, food_budget: "moderate", body_comp_goal: "performance" });
    if (path === "/readiness/today") return json(route, { day, score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {}, reading_fetched_at: null });
    if (path === `/mealplan/${day}`) return json(route, null);
    if (path === "/nutrition/log" && route.request().method() === "GET") return json(route, logs);
    if (path === "/nutrition/log/1" && route.request().method() === "PUT") {
      if (conflict) { conflict = false; return json(route, { detail: "entry changed since editing began" }, 409); }
      Object.assign(entry, route.request().postDataJSON(), { version: 2 }); return json(route, entry);
    }
    if (path === "/nutrition/log/1/repeat") { const body = route.request().postDataJSON(); logs.push({ ...entry, id: 2, day: body.day, meal: body.meal, kcal: entry.kcal * body.multiplier, version: 1 }); return json(route, logs[1], 201); }
    if (path === `/nutrition/totals/${day}`) return json(route, { day, kcal: logs.reduce((sum, item) => sum + item.kcal, 0), protein_g: 20,
      carbs_g: 80, fat_g: 10, fiber_g: 0, micros: {}, entry_count: logs.length });
    if (path === `/targets/${day}`) return json(route, { day, day_type: "gym", phase: "base", weight_kg: 75, kcal: 2500,
      protein_g: 150, carbs_g: 300, fat_g: 80, fiber_g: 25, micros: {}, notes: "Ordinary", override_source: "auto", goal: "performance",
      baseline_kcal: 2400, requested_kcal: 2400, baseline_source: "formula", data_cutoff: day, policy_version: "v1", energy_conflict: null,
      target_source: "ordinary", plan_id: null, plan_version: null, needs_review: false });
    if (path === "/competitions" || path === "/competition-nutrition/plans" || path === "/nutrition/foods") return json(route, []);
    return json(route, {});
  });
  await page.goto(`/nutrition?day=${day}`);
  await expect(page.getByLabel("Diary date")).toHaveValue(day);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Calories (kcal)").last().fill("550");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("entry changed since editing began", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`Updated meal for ${day}`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByLabel("Portion multiplier").fill("2");
  await page.getByRole("button", { name: "Save copy" }).click();
  await expect(page.getByText(`Repeated meal for ${day}`, { exact: false })).toBeVisible();
  await expect(page.getByText("Recorded intake reflects 2 entries", { exact: false })).toBeVisible();
});

test("competition training stays visible beside a manual override", async ({ page }) => {
  let manual = true;
  const event = { id: 4, name: "City Cup", location: "Skopje", event_date: "2026-10-06", end_date: "2026-10-07", priority: "B" };
  const dates = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const week = () => dates.map((date, index) => ({ day: date, weekday: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index],
    activity_type: index === 1 || index === 2 ? "competition" : "rest", competitions: index === 1 || index === 2 ? [event] : [],
    source: index === 1 && manual ? "manual" : "auto", session: index === 1 && manual ? { name: "Easy mobility", rationale: "Coach edit",
      exercises: [{ exercise: "Mobility", sets: 1, reps: 10, load_kg: null }] } : null,
    phase: { name: "comp" }, readiness: { band: "unknown" } }));
  await mockApi(page, async (route, path) => {
    if (path === "/training/week") return json(route, week());
    if (path === "/training/session/2026-10-06/override" && route.request().method() === "DELETE") { manual = false; return json(route, week()[1]); }
    if (path === "/readiness/today") return json(route, { day: "2026-10-05", score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {}, reading_fetched_at: null });
    if (path === "/mental/entries") return json(route, []);
    if (path === "/mental/insight") return json(route, { period_days: 14, entry_count: 0, avg_mood: null, avg_energy: null, avg_focus: null,
      avg_confidence: null, trend: "stable", insight: "No entries" });
    if (path === "/fencing/analysis") return json(route, { training_load_trend: "insufficient_data", session_count: 0, sessions: [],
      window_days: 90, avg_duration_min: null, avg_training_load: null, max_hr_estimate: null });
    return json(route, {});
  });
  await page.goto("/training?day=2026-10-06");
  await expect(page.getByRole("link", { name: "City Cup" })).toHaveCount(2);
  await expect(page.getByText("Additional planned work")).toBeVisible();
  await page.getByRole("button", { name: "Reset to auto plan" }).click();
  await expect(page.getByText("Additional planned work")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "City Cup" })).toHaveCount(2);
});

test("nested meal plan, partial shopping coverage, and explicit target acceptance render", async ({ page }) => {
  let accepted = false;
  const event = { id: 1, name: "Cup", event_date: day, end_date: null, location: null, priority: "A", level: null, notes: null, result: null };
  const planDay = { day, context: "event", training_type: "competition", training_source: "auto", session_name: null, countdown_days: 0,
    kcal: 2800, protein_g: 150, carbs_g: 500, fat_g: 60, fiber_g: 25, ordinary_kcal: 2400, ordinary_carbs_g: 300,
    baseline_source: "formula", data_cutoff: "2026-09-28", goal: "performance", energy_conflict: null, provisional: true,
    existing_plan_id: null, existing_targets: null, explanation: "Event demand", day_type: "competition", phase: "comp", override_source: "auto", weight_kg: 75,
    micros: {}, baseline_kcal: 2400, requested_kcal: 2400 };
  const preview = { event, inputs: { expected_demand: "moderate", event_format: "single_day", start_time: null, resolve_overlaps: false },
    days: [planDay], policy_version: "competition-2026-09-v1", competing_events: [], assumptions: ["Start time unknown"], token: "x" };
  const plan = { id: 1, event_id: 1, event, inputs: preview.inputs, days: [planDay], version: 1, policy_version: preview.policy_version, active: true, created_at: now };
  await mockApi(page, async (route, path) => {
    if (path === "/profile") return json(route, { id: 1, weight_kg: 75, dietary_restrictions: "no peanuts", food_preferences: "rice", food_budget: "moderate", body_comp_goal: "performance" });
    if (path === "/readiness/today") return json(route, { day, score: null, band: "unknown", source: "neutral", advisories: {}, inputs: {}, reading_fetched_at: null });
    if (path === `/mealplan/${day}`) return json(route, { day, targets: { kcal: 2800 }, plan: { plan: { meals: [{ slot: "breakfast", time: "08:00", name: "Rice bowl",
      ingredients: [{ name: "Rice", qty_g: 100 }], kcal: null, protein_g: null, carbs_g: null, fat_g: null }], totals: { kcal: null } },
      profile_context: { restrictions: "no peanuts", preferences: "rice", budget: "moderate" } }, generated_at: now });
    if (path === "/nutrition/log") return json(route, []);
    if (path === `/nutrition/totals/${day}`) return json(route, { day, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, micros: {}, entry_count: 0 });
    if (path === `/targets/${day}`) return json(route, { day, day_type: "competition", phase: "comp", weight_kg: 75, kcal: 2500, protein_g: 150,
      carbs_g: 300, fat_g: 80, fiber_g: 25, micros: {}, notes: "Ordinary", override_source: "auto", goal: "performance", baseline_kcal: 2400,
      requested_kcal: 2400, baseline_source: "formula", data_cutoff: day, policy_version: "v1", energy_conflict: null,
      target_source: "ordinary", plan_id: null, plan_version: null, needs_review: false });
    if (path === "/competitions") return json(route, [event]);
    if (path === "/competition-nutrition/plans" && route.request().method() === "GET") return json(route, accepted ? [plan] : []);
    if (path === "/competition-nutrition/preview/1") return json(route, preview);
    if (path === "/competition-nutrition/accept") { accepted = true; return json(route, plan, 201); }
    if (path === "/competition-nutrition/plans/1/meals") return json(route, []);
    if (path === "/nutrition/foods") return json(route, []);
    if (path === "/shopping/week") return json(route, { start: day, end: "2026-10-11", days_covered: [day], missing_days: ["2026-10-06"], items: [{ name: "rice", qty_g: 100 }], item_count: 1 });
    return json(route, {});
  });
  await page.goto(`/nutrition?day=${day}`);
  await expect(page.getByText("Rice bowl")).toBeVisible();
  await expect(page.getByText("100 g", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByText("partial", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Preview targets" }).click();
  await expect(page.getByText("Start time unknown", { exact: false })).toBeVisible();
  await expect(page.getByText("Preview · Cup", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Accept targets" }).click();
  await expect(page.getByText("Accepted Cup nutrition plan v1", { exact: false })).toBeVisible();
});
