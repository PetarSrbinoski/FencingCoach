import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const resetScript = path.resolve(__dirname, "../../testing/scripts/reset_db.sh");

test.beforeEach(async ({ page }) => {
  execFileSync("bash", [resetScript], { stdio: "inherit" });
  // Playwright creates a fresh browser context for every test, so local and
  // session storage cannot carry a pending estimate into the next case.
  const day = process.env.TEST_ATHLETE_DAY;
  if (!day) throw new Error("TEST_ATHLETE_DAY is required");
  await page.clock.setFixedTime(new Date(`${day}T12:00:00.000Z`));
});

test("nutrition page loads real targets and reviews a controlled estimate", async ({ page }) => {
  const targetResponse = page.waitForResponse(
    (response) => response.url().endsWith("/targets/today") && response.status() === 200,
  );
  await page.goto("/nutrition");
  const targets = await (await targetResponse).json();
  expect(targets.day).toBe(process.env.TEST_ATHLETE_DAY);

  await expect(page.getByRole("heading", { name: "Nutrition" })).toBeVisible();
  await expect(page.getByText(/^Targets vs intake —/)).toBeVisible();

  await page.getByRole("textbox", { name: "Meal description" }).fill("synthetic training meal");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByText("Review estimate")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & log" })).toBeVisible();
});
