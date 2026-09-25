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

test("save exact food values, log a serving, edit and remove without changing history", async ({ page }) => {
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill("My yogurt");
  await page.getByLabel("Calories (kcal)", { exact: true }).fill("62.3");
  await page.getByLabel("Protein (g)", { exact: true }).fill("5.12");
  await page.getByLabel("Carbs (g)", { exact: true }).fill("4.1");
  await page.getByLabel("Fat (g)", { exact: true }).fill("2.03");
  await page.getByLabel("Serving name (optional)").fill("1 pot");
  await page.getByLabel("Serving weight (g)").fill("150");
  await page.getByRole("button", { name: "Add nutrient", exact: true }).click();
  await page.getByLabel("Nutrient 1", { exact: true }).fill("Calcium");
  await page.getByLabel("Amount 1", { exact: true }).fill("125");
  await page.getByLabel("Unit 1", { exact: true }).selectOption("mg");
  await page.getByRole("button", { name: "Save food", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved My yogurt");
  expect(await (await page.request.get(`${backend}/nutrition/log`)).json()).toEqual([]);

  await page.reload();
  await page.getByLabel("Search my foods").fill("yog");
  await page.getByRole("button", { name: /My yogurt.*62.3/ }).click();
  await page.getByLabel("Amount eaten").fill("0.5");
  await page.getByLabel("Measure", { exact: true }).selectOption("servings");
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("46.725 kcal");
  const logs = await (await page.request.get(`${backend}/nutrition/log`)).json();
  expect(logs).toHaveLength(1);
  expect(logs[0].micros.calcium_mg).toBe(93.75);
  expect(logs[0].fiber_g).toBeNull();

  await page.getByRole("button", { name: "Edit My yogurt", exact: true }).click();
  await page.getByLabel("Calories (kcal)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save food", exact: true }).click();
  await expect(page.getByRole("button", { name: /My yogurt.*100 kcal/ })).toBeVisible();
  await page.getByRole("button", { name: "Remove My yogurt", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Past meals are preserved");
  await page.reload();
  await expect(page.getByText("75 g My yogurt", { exact: true })).toBeVisible();
  const reloaded = await (await page.request.get(`${backend}/nutrition/log`)).json();
  expect(reloaded[0].kcal).toBe(46.725);
});

test("incomplete foods stay unknown and require missing macros before logging", async ({ page }) => {
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill("Incomplete bar");
  await page.getByLabel("Protein (g)", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save food", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved Incomplete bar");
  await expect(page.getByRole("button", { name: "Log food", exact: true })).toBeDisabled();
  await expect(page.getByText(/Edit this food to add Calories/)).toBeVisible();
  const foods = await (await page.request.get(`${backend}/nutrition/foods`)).json();
  expect(foods[0].kcal).toBeNull();
  expect(foods[0].micros).toEqual([]);
});
