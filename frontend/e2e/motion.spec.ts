import { expect, test } from "@playwright/test";

const { data } = require("./mobile-fixtures.cjs");

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: route.request().method() === "OPTIONS" ? "" : JSON.stringify(data(url.pathname, url)),
    });
  });
});

for (const theme of ["light", "dark"]) {
  test(`luminous panels preserve metric data and readable summary text in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("coach-motion", "paused");
    }, theme);
    await page.goto("/");
    const tiles = page.locator(".metric-tile");
    await expect(tiles).toHaveCount(5);
    await expect(page.locator(".metric-tile .signal-form")).toHaveCount(5);
    for (const tile of await tiles.all()) {
      await expect(tile.locator(".metric-value")).not.toContainText("—");
      await expect(tile.locator(".metric-meta")).toContainText("vs prior reading");
      await expect(tile.locator(".signal-form")).toHaveAttribute("aria-hidden", "true");
    }
    await page.goto("/weekly");
    const summary = page.locator(".weekly-summary");
    // Pale fields keep dark ink even when the surrounding shell is dark.
    await expect(summary.getByRole("heading", { name: "Weekly summary" })).toHaveCSS("color", "rgb(37, 55, 42)");
    await expect(summary.locator(".text-2xl").first()).toHaveCSS("color", "rgb(37, 55, 42)");
    await summary.locator("summary").click();
    await expect(summary.locator("summary")).toHaveCSS("color", "rgb(37, 55, 42)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

async function canvasFrame(page: import("@playwright/test").Page) {
  return page.locator(".kinetic-background").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

test("the ambient background moves, can be paused, and remembers the preference", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".kinetic-background")).toHaveAttribute("aria-hidden", "true");
  const moving = await canvasFrame(page);
  await expect.poll(() => canvasFrame(page)).not.toBe(moving);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  const paused = await canvasFrame(page);
  await page.waitForTimeout(180);
  expect(await canvasFrame(page)).toBe(paused);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume animations", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page.getByRole("button", { name: "Resume animations", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
});

test("native page transitions survive rapid navigation and browser Back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    (window as any).routeTransitions = 0;
    document.startViewTransition = (callback) => {
      (window as any).routeTransitions++;
      return original(callback);
    };
  });
  const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await nav.getByRole("link", { name: "Training", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await nav.getByRole("link", { name: "Trends", exact: true }).click();
  await expect(page).toHaveURL(/\/weekly$/);
  await expect(page.getByRole("heading", { name: "Trends", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).routeTransitions)).toBe(2);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  expect(errors).toEqual([]);
});

test("reduced motion keeps the background static and navigation immediate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  const frame = await canvasFrame(page);
  await page.waitForTimeout(180);
  expect(await canvasFrame(page)).toBe(frame);
  await expect(page.getByRole("button", { name: "Animations reduced by system" })).toBeDisabled();
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Training", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("mobile dock and portalled navigation keep working during transitions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Training", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Training", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "More navigation and settings" }).click();
  await page.getByRole("navigation", { name: "More navigation", exact: true }).getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Mobile athlete");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Mobile athlete");
});

test("background rendering is capped and stops while the document is hidden", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).backdropFrames = 0;
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.classList.contains("kinetic-background")) (window as any).backdropFrames++;
      return original.apply(this, args);
    };
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  const start = await page.evaluate(() => (window as any).backdropFrames);
  await page.waitForTimeout(500);
  const painted = await page.evaluate(() => (window as any).backdropFrames);
  expect(painted - start).toBeGreaterThan(0);
  expect(painted - start).toBeLessThanOrEqual(20);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenFrame = await canvasFrame(page);
  const hiddenCount = await page.evaluate(() => (window as any).backdropFrames);
  await page.waitForTimeout(200);
  expect(await canvasFrame(page)).toBe(hiddenFrame);
  expect(await page.evaluate(() => (window as any).backdropFrames)).toBe(hiddenCount);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => (window as any).backdropFrames)).toBeGreaterThan(hiddenCount);
});

test("unsupported browsers use real-DOM transitions without blocking forms", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Alex Motion");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Alex Motion");
});
