import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const base = `http://127.0.0.1:${process.env.TEST_BACKEND_PORT || "18009"}`;
const day = "2026-10-05";

test.beforeEach(async ({ request }) => {
  const root = path.resolve(process.cwd(), "..");
  execFileSync(`${root}/.venv/bin/python`, [`${root}/testing/support/reset_db.py`], { cwd: "/tmp", env: process.env });
  await request.put(`${base}/profile`, { data: { weight_kg: 70, dietary_restrictions: "", food_preferences: "" } });
});

async function seed(request: APIRequestContext) {
  const response = await request.post(`${base}/nutrition/foods`, { data: { name: "Rice", kcal: 200, protein_g: 10, carbs_g: 30, fat_g: 4, prep_time_min: 5 } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function savedRecipe(request: APIRequestContext, foodId: number, name: string) {
  const draft = await (await request.post(`${base}/nutrition/recipes/drafts`, { data: { recipe: {
    name, portions: 4, prep_time_min: 5, ingredients: [{ food_id: foodId, qty_g: 1000, basis: "cooked" }],
  } } })).json();
  const saved = await request.post(`${base}/nutrition/recipes/drafts/${draft.id}/accept`, { data: { expected_revision: draft.revision, request_id: `seed-${draft.id}` } });
  expect(saved.ok()).toBeTruthy();
  return saved.json();
}

test("compose, review, save, reload, edit and log a fractional portion", async ({ page, request }, testInfo) => {
  await seed(request);
  await page.goto(`/nutrition?view=foods&library=recipes&day=${day}`);
  await expect(page.getByRole("heading", { name: "My recipes" })).toBeVisible();
  await expect(page.getByText("No recipes saved yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Create recipe", exact: true }).click();
  await page.getByLabel("Recipe name").fill(`Rice batch ${testInfo.project.name}`);
  await page.getByLabel("Number of portions").fill("4");
  await page.getByLabel("Ingredient 1 source").selectOption({ label: "Rice (current values)" });
  await page.getByLabel("Ingredient 1 grams").fill("1000");
  await page.getByLabel("Ingredient 1 basis").selectOption("cooked");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await expect(page.getByRole("cell", { name: "2000", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "500", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved recipe" })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
  await page.reload();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: `Rice batch ${testInfo.project.name}`, exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Log portion of/ }).click();
  await page.getByLabel("Consumed amount").fill("0.5");
  await page.getByLabel("Consumption day").fill(day);
  await page.getByLabel("Consumption meal").selectOption("lunch");
  await page.getByRole("button", { name: "Confirm log portion" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged lunch:" })).toBeVisible();
  const logs = await (await request.get(`${base}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(1); expect(logs[0].kcal).toBe(250);
  await card.getByRole("button", { name: /Edit Rice/ }).click();
  await page.getByLabel("Number of portions").fill("2");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(card.getByText("1000 kcal per portion", { exact: false })).toBeVisible();
  expect((await (await request.get(`${base}/nutrition/log?days=90`)).json())[0].kcal).toBe(250);
  await page.getByRole("button", { name: "Undo recipe action" }).click();
  await expect(card.getByText("500 kcal per portion", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../testing/.artifacts/future-ai/recipes-${testInfo.project.name}.png`, fullPage: true });
});

test("text import clarifies measurements and cancellation leaves consumption unchanged", async ({ page, request }, testInfo) => {
  await seed(request);
  await page.goto(`/nutrition?view=foods&library=recipes&day=${day}`);
  await page.getByRole("button", { name: "Import recipe from text" }).click();
  await page.getByLabel("Paste a recipe or describe what you cooked").fill("unclear rice for four");
  await page.getByRole("button", { name: "Interpret recipe" }).click();
  await expect(page.getByText("Confirm whether Rice was weighed", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save recipe", exact: true })).toBeDisabled();
  await page.getByLabel("Recipe name").fill(`Imported rice ${testInfo.project.name}`);
  await page.getByLabel("Ingredient 1 basis").selectOption("cooked");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
  await page.getByRole("button", { name: "Create recipe", exact: true }).click();
  await page.getByLabel("Recipe name").fill("Cancelled rice");
  await page.getByLabel("Ingredient 1 source").selectOption({ label: "Rice (current values)" });
  await page.getByLabel("Ingredient 1 grams").fill("100");
  await page.getByLabel("Ingredient 1 basis").selectOption("cooked");
  await page.getByLabel("Number of portions").fill("1");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await page.getByRole("button", { name: "Cancel draft" }).click();
  await expect(page.getByText("Recipe draft cancelled.")).toBeVisible();
});

test("suggestions save separately and refresh changed diary context before logging", async ({ page, request }, testInfo) => {
  const rice = await seed(request);
  await page.goto(`/nutrition?view=plans&planView=suggestions&day=${day}`);
  await page.getByLabel("Available foods").fill("Rice");
  await page.getByLabel("Suggestion day").fill(day);
  await page.getByRole("button", { name: "Find meal options" }).click();
  const option = page.getByRole("article").filter({ hasText: "Rice option 1" });
  await expect(option).toBeVisible();
  await expect(option.getByText("300 kcal per portion", { exact: false })).toBeVisible();
  await option.getByRole("button", { name: "Adjust option" }).click();
  await option.getByLabel("Recipe name").fill(`Rice option ${testInfo.project.name}`);
  await option.getByRole("button", { name: "Review adjustments" }).click();
  await page.getByRole("button", { name: "Save as reusable meal" }).click();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
  await request.post(`${base}/nutrition/foods/log`, { data: { day, meal: "breakfast", portions: [{ food_id: rice.id, grams: 100 }] } });
  await page.getByRole("button", { name: "I ate this" }).click();
  await page.getByLabel("Suggestion meal").selectOption("lunch");
  await page.getByRole("button", { name: "Confirm consumption" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Refresh the fit explanation" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh day fit" }).click();
  await page.getByRole("button", { name: "Confirm consumption" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged lunch:" })).toBeVisible();
  const logs = await (await request.get(`${base}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(2);
  await page.getByRole("button", { name: "Undo suggestion action" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Change undone." })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../testing/.artifacts/future-ai/suggestions-${testInfo.project.name}.png`, fullPage: true });
});

test("chat recipe logging appears in nutrition and can be undone", async ({ page, request }) => {
  const rice = await seed(request);
  await savedRecipe(request, rice.id, "Rice batch");
  await page.goto("/chat");
  await page.getByPlaceholder(/Ask your coach/i).fill("Log my usual lunch");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(page.getByText("Which recipe do you mean?", { exact: false })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
  await page.getByPlaceholder(/Ask your coach/i).fill("Log half a portion of Rice batch for lunch today");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(page.getByText("Logged half a portion of Rice batch for lunch.", { exact: false })).toBeVisible();
  const logs = await (await request.get(`${base}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(1); expect(logs[0].kcal).toBe(250);
  const action = (await (await request.get(`${base}/agent-actions?kind=meal`)).json()).items[0];
  expect((await request.post(`${base}/agent-actions/${action.id}/undo`, { data: { request_id: "undo-chat" } })).ok()).toBeTruthy();
});

test("voice reviews a named ingredient change without changing its source", async ({ page, request }) => {
  const rice = await seed(request);
  const saved = await savedRecipe(request, rice.id, "Rice batch");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    } });
    class Recorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      static isTypeSupported() { return true; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["I ate my usual lunch, but half the rice"], { type: this.mimeType }) }); this.onstop?.(); }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
  });
  await page.goto(`/nutrition?day=${day}`);
  await page.getByRole("button", { name: "Record voice" }).click();
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await expect(page.getByRole("heading", { name: "Review interpretation" })).toBeVisible();
  await expect(page.getByText("Which known meal do you mean?", { exact: false })).toBeVisible();
  await page.getByText("Known recipe or previous meal", { exact: true }).click();
  await page.getByLabel("Meal source").selectOption(`recipe:${saved.resource_id}`);
  await page.getByLabel("Rice amount multiplier").fill("0.5");
  await page.getByRole("button", { name: "Update review" }).click();
  await expect(page.getByText("Preview: 250 kcal", { exact: false })).toBeVisible();
  await page.getByLabel("Rice amount multiplier").fill("0.25");
  await page.getByRole("button", { name: "Update review" }).click();
  await expect(page.getByText("Preview: 125 kcal", { exact: false })).toBeVisible();
  await page.getByLabel("Voice meal").selectOption("lunch");
  await page.getByRole("button", { name: "Log consumption", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged lunch:" })).toBeVisible();
  const logs = await (await request.get(`${base}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(1); expect(logs[0].kcal).toBe(125);
  const recipe = await (await request.get(`${base}/nutrition/recipes/${saved.resource_id}`)).json();
  expect(recipe.totals.kcal).toBe(2000);
  await page.getByRole("button", { name: "Undo in Agent logs" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Change undone." })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
});

test("failed import and stale food offer recovery without a save", async ({ page, request }) => {
  const rice = await seed(request);
  await page.goto(`/nutrition?view=foods&library=recipes&day=${day}`);
  await page.getByRole("button", { name: "Import recipe from text" }).click();
  await page.getByLabel("Paste a recipe or describe what you cooked").fill("FAIL: rice");
  await page.getByRole("button", { name: "Interpret recipe" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Controlled recipe interpretation failure" })).toBeVisible();
  await page.getByRole("button", { name: "Compose manually" }).click();
  await page.getByLabel("Recipe name").fill("Stale rice");
  await page.getByLabel("Number of portions").fill("1");
  await page.getByLabel("Ingredient 1 source").selectOption({ label: "Rice (current values)" });
  await page.getByLabel("Ingredient 1 grams").fill("100");
  await page.getByLabel("Ingredient 1 basis").selectOption("cooked");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await request.put(`${base}/nutrition/foods/${rice.id}`, { data: { name: "Rice", kcal: 300, protein_g: 10, carbs_g: 30, fat_g: 4 } });
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ingredient food changed" })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/recipes`)).json()).toEqual([]);
});

test("suggestions explain unknown restrictions and infeasible constraints", async ({ page, request }) => {
  await seed(request);
  await request.put(`${base}/profile`, { data: { weight_kg: 70, dietary_restrictions: "avoid the usual stuff" } });
  await page.goto(`/nutrition?view=plans&planView=suggestions&day=${day}`);
  await page.getByLabel("Available foods").fill("Rice");
  await page.getByRole("button", { name: "Find meal options" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
  await request.put(`${base}/profile`, { data: { weight_kg: 70, dietary_restrictions: "" } });
  await page.getByLabel("Time to prepare (minutes)").fill("0");
  await page.getByRole("button", { name: "Find meal options" }).click();
  await expect(page.getByText("No feasible options.", { exact: false })).toBeVisible();
  await page.getByLabel("Time to prepare (minutes)").fill("15");
  await page.getByRole("button", { name: "Find meal options" }).click();
  await expect(page.getByRole("heading", { name: "Rice option 1", exact: true })).toBeVisible();
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toEqual([]);
});

test("recent foods use searchable cards with clear portion controls", async ({ page, request }) => {
  const rice = await seed(request);
  await request.post(`${base}/nutrition/foods/log`, { data: { day, meal: "lunch", portions: [{ food_id: rice.id, grams: 100 }] } });
  await page.goto(`/nutrition?day=${day}`);
  await expect(page.getByLabel("Diary date")).toHaveCount(0);
  await expect(page.getByLabel("Previous diary day")).toHaveCount(0);
  const picker = page.getByRole("region", { name: "Quick food logging" });
  await picker.getByLabel("Search recent and saved foods").fill("Rice");
  await expect(picker.getByRole("button", { name: /Log .*Rice.* again/ })).toBeVisible();
  await picker.getByRole("button", { name: /Adjust portion of .*Rice/ }).click();
  await picker.getByLabel("Portion amount").fill("0.5");
  await picker.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(picker.getByRole("status").filter({ hasText: "Logged" })).toBeVisible();
  const logs = await (await request.get(`${base}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(2);
  expect(logs.map((entry: { kcal: number }) => entry.kcal).sort()).toEqual([100, 200]);
  await picker.getByRole("button", { name: /Undo logging/ }).click();
  await expect(picker.getByRole("status").filter({ hasText: "Logged" })).toHaveCount(0);
  expect(await (await request.get(`${base}/nutrition/log?days=90`)).json()).toHaveLength(1);
});
