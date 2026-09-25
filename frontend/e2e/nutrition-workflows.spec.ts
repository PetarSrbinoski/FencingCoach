import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const resetScript = path.resolve(__dirname, "../../testing/scripts/reset_db.sh");
const backend = `http://127.0.0.1:${process.env.TEST_BACKEND_PORT ?? "18000"}`;

test.beforeEach(async ({ page }) => {
  execFileSync("bash", [resetScript], { stdio: "inherit" });
  const day = process.env.TEST_ATHLETE_DAY;
  if (!day) throw new Error("TEST_ATHLETE_DAY is required");
  await page.clock.setFixedTime(new Date(`${day}T12:00:00.000Z`));
});

test("manual day type updates targets, persists after reload, and Auto restores selection", async ({ page }) => {
  await page.goto("/nutrition");
  await expect(page.getByText(/^Targets vs intake —/)).toBeVisible();
  const original = await (await page.request.get(`${backend}/targets/today`)).json();
  const selected = original.day_type === "rest" ? "Competition" : "Rest";

  await page.getByRole("combobox", { name: "Day type" }).click();
  await page.getByRole("option", { name: selected }).click();
  await expect(page.getByText(new RegExp(`^Targets vs intake — ${selected.toLowerCase()} day`))).toBeVisible();
  await expect(page.getByText("manual", { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`${backend}/targets/today`)).json()).override_source).toBe("manual");
  const manual = await (await page.request.get(`${backend}/targets/today`)).json();
  expect(manual.carbs_g).not.toBe(original.carbs_g);

  await page.reload();
  await expect(page.getByText("manual", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`^Targets vs intake — ${selected.toLowerCase()} day`))).toBeVisible();
  await page.getByRole("combobox", { name: "Day type" }).click();
  await page.getByRole("option", { name: "Auto" }).click();
  await expect(page.getByText("auto", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`^Targets vs intake — ${original.day_type} day`))).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`${backend}/targets/today`)).json()).carbs_g).toBe(original.carbs_g);
});

test("reviewed edits create one meal and totals, then deletion persists", async ({ page }) => {
  const day = process.env.TEST_ATHLETE_DAY;
  await page.goto("/nutrition");
  await page.getByRole("textbox", { name: "Meal description" }).fill("synthetic review meal");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByText("Review estimate")).toBeVisible();
  expect(await (await page.request.get(`${backend}/nutrition/log`)).json()).toEqual([]);

  await page.getByRole("textbox", { name: "Kcal" }).fill("510");
  await page.getByRole("textbox", { name: "Protein g" }).fill("33");
  await page.getByRole("button", { name: "Confirm & log" }).click();
  await expect(page.getByText("synthetic review meal")).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`${backend}/nutrition/totals/${day}`)).json()).entry_count).toBe(1);
  const totals = await (await page.request.get(`${backend}/nutrition/totals/${day}`)).json();
  expect([totals.kcal, totals.protein_g]).toEqual([510, 33]);

  await page.reload();
  await expect(page.getByText("synthetic review meal")).toBeVisible();
  const logs = await (await page.request.get(`${backend}/nutrition/log`)).json();
  expect(logs).toHaveLength(1);
  expect([logs[0].kcal, logs[0].protein_g]).toEqual([510, 33]);
  await page.getByRole("button", { name: "Delete entry" }).click();
  await expect(page.getByText("Nothing logged yet")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nothing logged yet")).toBeVisible();
  expect((await (await page.request.get(`${backend}/nutrition/totals/${day}`)).json()).entry_count).toBe(0);
});

test("estimate failure ends busy state and another estimate reaches review", async ({ page }) => {
  await page.goto("/nutrition");
  const description = page.getByRole("textbox", { name: "Meal description" });
  await description.fill("FAIL: synthetic outage");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByText("controlled nutrition estimate failure")).toBeVisible();
  await expect(page.getByRole("button", { name: "Estimate", exact: true })).toBeEnabled();
  expect(await (await page.request.get(`${backend}/nutrition/log`)).json()).toEqual([]);

  await description.fill("synthetic recovery meal");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByText("Review estimate")).toBeVisible();
  expect(await (await page.request.get(`${backend}/nutrition/log`)).json()).toEqual([]);
});
