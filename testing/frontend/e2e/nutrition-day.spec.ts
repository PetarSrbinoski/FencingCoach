import { expect, test } from "@playwright/test";

test("nutrition uses the athlete's day when the browser UTC date differs", async ({ page }) => {
  const api = process.env.NUTRITION_API_URL ?? `http://127.0.0.1:${process.env.TEST_BACKEND_PORT ?? "18000"}`;
  const response = await page.request.get(`${api}/targets/today`);
  expect(response.ok()).toBeTruthy();
  const { day } = await response.json();
  // Just after midnight in the athlete's timezone is still yesterday in UTC.
  await page.clock.setFixedTime(new Date(`${day}T00:30:00+02:00`));
  await page.goto(`${process.env.NAVIGATION_BASE_URL ?? ""}/nutrition`);
  await expect(page.getByText(`Today (${day})`, { exact: true })).toBeVisible();
});
