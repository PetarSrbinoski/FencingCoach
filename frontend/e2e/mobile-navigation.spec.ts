import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Also a read-only deployment smoke check against the actual served frontend.
test("mobile dock stays visible and More opens working navigation", async ({ page }) => {
  await page.goto(`${process.env.NAVIGATION_BASE_URL ?? ""}/nutrition`);
  const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
  await expect(dock).toBeVisible({ timeout: 5000 });
  await expect(dock).toBeInViewport();
  const bounds = await dock.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThan(650);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(dock).toBeInViewport();
  await dock.getByRole("button", { name: "More navigation and settings" }).click();
  const more = page.getByRole("dialog", { name: "More from Coach" });
  await expect(more).toBeVisible();
  await more.getByRole("link", { name: "Weekly", exact: true }).click();
  await expect(page).toHaveURL(/\/weekly$/);
  await expect(more).not.toBeVisible();
  await expect(dock).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(dock).not.toBeVisible();
});
