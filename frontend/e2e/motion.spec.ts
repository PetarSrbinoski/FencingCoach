import { expect, test } from "@playwright/test";

const { data } = require("./mobile-fixtures.cjs");

test.beforeEach(async ({ page, baseURL }) => {
  await page.route(/^http:\/\/localhost:8000\/|\/api\//, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/api(?=\/)/, "");
    await route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": new URL(baseURL ?? "http://localhost:3000").origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: route.request().method() === "OPTIONS" ? "" : JSON.stringify(data(url.pathname, url)),
    });
  });
});

for (const theme of ["light", "dark"]) {
  test(`theme-aware panels preserve metric data and readable summary text in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("coach-motion", "paused");
    }, theme);
    await page.goto("/");
    const tiles = page.locator(".metric-tile");
    await expect(tiles).toHaveCount(5);
    await expect(page.locator(".metric-tile .metric-trend")).toHaveCount(5);
    for (const tile of await tiles.all()) {
      await expect(tile.locator(".metric-value")).not.toContainText("—");
      await expect(tile.locator(".metric-meta")).toContainText("vs prior reading");
      await expect(tile.locator(".recharts-area-curve")).toBeVisible();
      await expect(tile.locator(".metric-trend .sr-only")).toContainText("recent readings");
      await expect(tile).toHaveCSS("background-image", "none");
    }
    await page.goto("/weekly");
    const summary = page.locator(".weekly-summary");
    const foreground = await page.locator("body").evaluate((body) => getComputedStyle(body).color);
    await expect(summary.getByRole("heading", { name: "Weekly summary" })).toHaveCSS("color", foreground);
    await expect(summary.locator(".text-2xl").first()).toHaveCSS("color", foreground);
    await expect(summary).toHaveCSS("background-image", "none");
    await summary.locator("summary").click();
    await expect(summary.locator("summary")).toHaveCSS("color", foreground);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

async function canvasFrame(page: import("@playwright/test").Page) {
  return page.locator(".kinetic-background").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

test("comic fencer idles, cuts with the sword, and stops when paused", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  const strip = page.locator(".fencer-strip");
  await expect(strip).toBeVisible();
  await expect(page.locator(".fencer-mascot")).toHaveAttribute("aria-hidden", "true");
  await expect(strip).toHaveCSS("animation-duration", "12s");
  const poses = await strip.evaluate(async (element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    const transforms: string[] = [];
    for (const time of [0, 1800, 11100, 11400, 12000]) {
      animation.currentTime = time;
      await new Promise(requestAnimationFrame);
      transforms.push(getComputedStyle(element).backgroundPosition);
    }
    animation.play();
    return transforms;
  });
  expect(new Set(poses.slice(0, 4)).size).toBe(4);
  expect(poses[4]).toBe(poses[0]);
  const idle = await strip.evaluate(async (element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    const frames: string[] = [];
    for (let frame = 0; frame < 48; frame++) {
      animation.currentTime = frame * 75 + 1;
      frames.push(getComputedStyle(element).backgroundPosition);
    }
    animation.currentTime = 3601;
    const loop = getComputedStyle(element).backgroundPosition;
    const image = new Image();
    image.src = "/fencer-sprites.png";
    await image.decode();
    animation.play();
    return { frames, loop, width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(new Set(idle.frames).size).toBe(48);
  expect(idle.loop).toBe(idle.frames[0]);
  expect([idle.width, idle.height]).toEqual([1792, 2048]);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.endsWith("/fencer-sprites.png")))).toBe(true);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await expect(strip).toBeHidden();
  await expect(page.locator("img.fencer-study")).toBeVisible();
  await expect(strip).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Resume animations", exact: true }).click();
  await expect(strip).toBeVisible();
});

test("fencer stays still for system reduced motion, including live preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".fencer-strip")).toBeHidden();
  await expect(page.locator("img.fencer-study")).toBeVisible();
  await expect(page.locator(".fencer-strip")).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".fencer-strip")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".fencer-strip")).toBeHidden();
});

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

test.describe("phone transitions", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const width of [390, 844]) {
    test(`${width}px phone uses a short fade without snapshot, blur or layout movement`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 390 });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
      await page.evaluate(() => {
        const state = window as unknown as { mobileSnapshots: number; mobileFades: { duration: number; keys: string[] }[] };
        state.mobileSnapshots = 0;
        state.mobileFades = [];
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (callback) => { state.mobileSnapshots++; return start(callback); };
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          if (this.hasAttribute("data-motion-page") && Array.isArray(frames)) {
            state.mobileFades.push({ duration: typeof options === "object" ? Number(options.duration) : Number(options), keys: Object.keys(frames[0]) });
          }
          return animate.call(this, frames, options);
        };
      });
      const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
      await nav.getByRole("link", { name: "Training", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Training", level: 1 })).toBeVisible();
      await nav.getByRole("link", { name: "Nutrition", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Nutrition", level: 1 })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Training", level: 1 })).toBeVisible();
      const state = await page.evaluate(() => {
        const state = window as unknown as { mobileSnapshots: number; mobileFades: { duration: number; keys: string[] }[] };
        return { snapshots: state.mobileSnapshots, fades: state.mobileFades };
      });
      expect(state.snapshots).toBe(0);
      expect(state.fades.length).toBeGreaterThanOrEqual(3);
      for (const fade of state.fades) {
        expect(fade.duration).toBeLessThanOrEqual(180);
        expect(fade.keys).toEqual(["opacity"]);
      }
      await expect(page.locator(".route-wake")).toBeHidden();
      await expect(page.locator("[data-motion-page]")).toHaveCSS("view-transition-name", "none");
      await expect.poll(() => page.locator("[data-motion-page]").evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});

test("unsupported browsers use real-DOM transitions without blocking forms", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Alex Motion");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Alex Motion");
});
