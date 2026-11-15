import { expect, test, type Page } from "@playwright/test";

const { data } = require("./mobile-fixtures.cjs");

type Scenario = "normal" | "over" | "zero" | "no-target" | "unavailable" | "sparse";
async function fixtures(page: Page, baseURL: string | undefined, scenario: Scenario = "normal") {
  await page.route(/^http:\/\/localhost:8000\/|\/api\//, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/api(?=\/)/, "");
    let body = data(url.pathname, url);
    let status = 200;
    if (url.pathname.startsWith("/nutrition/totals/")) {
      if (scenario === "over") body = { ...body, carbs_g: 400, protein_g: 200, fat_g: 100, kcal: 3300 };
      if (scenario === "zero") body = { ...body, carbs_g: 0, protein_g: 0, fat_g: 0, kcal: 0, entry_count: 0 };
      if (scenario === "unavailable") { status = 503; body = { detail: "Totals unavailable" }; }
    }
    if (url.pathname.startsWith("/targets/") && scenario === "no-target") {
      body = { ...body, carbs_g: 0, protein_g: 0, fat_g: 0, kcal: 0 };
    }
    if (url.pathname.startsWith("/metrics/") && scenario === "sparse") {
      body = { ...body, points: [{ day: "2026-09-26", value: null }, { day: "2026-09-27", value: 0 }, { day: "2026-09-28", value: null }] };
    }
    await route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : status,
      headers: { "Access-Control-Allow-Origin": new URL(baseURL ?? "http://localhost:3000").origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      contentType: "application/json", body: route.request().method() === "OPTIONS" ? "" : JSON.stringify(body) });
  });
}

// All colors below are browser-resolved RGB values, not token guesses.
async function contrast(page: Page, selector: string, ink = "color", background = ".nutrition-intake") {
  return page.locator(selector).first().evaluate((element, { ink, background }) => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => {
        const c = n / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const fg = luminance(getComputedStyle(element).getPropertyValue(ink));
    const bg = luminance(getComputedStyle(document.querySelector(background)!).backgroundColor);
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
  }, { ink, background });
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${theme} ${width}px: ordered rings, accurate values and readable charts`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((theme) => { localStorage.setItem("theme", theme); localStorage.setItem("coach-motion", "paused"); }, theme);
      await fixtures(page, baseURL);
      await page.goto("/nutrition");
      const intake = page.locator(".nutrition-intake");
      await expect(intake).toBeVisible();
      for (const [label, radius, actual, target] of [["Carbs", "120", 160, 320], ["Protein", "96", 75, 150], ["Fats", "72", 31, 80]] as const) {
        const ring = intake.getByRole("progressbar", { name: label, exact: true });
        await expect(ring).toHaveAttribute("aria-valuenow", String(actual));
        await expect(ring).toHaveAttribute("aria-valuemax", String(target));
        await expect(ring.locator(".macro-arc")).toHaveAttribute("r", radius);
        await expect(ring.locator(".macro-arc")).toHaveAttribute("stroke-dasharray", `${actual / target * 100} 100`);
      }
      await expect(intake.getByRole("progressbar", { name: "Calories", exact: true })).toHaveAttribute("aria-valuetext", "1220 of 2600 kcal");
      expect(await contrast(page, ".ring-calories strong")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(page, ".ring-calories span")).toBeGreaterThanOrEqual(4.5);
      for (const macro of ["carbs_g", "protein_g", "fat_g"]) {
        expect(await contrast(page, `[data-macro=${macro}] .macro-arc`, "stroke")).toBeGreaterThanOrEqual(3);
      }
      expect(await contrast(page, ".macro-label")).toBeGreaterThanOrEqual(4.5);
      for (const [i, text] of ["/ 320 g", "/ 150 g", "/ 80 g"].entries()) {
        await expect(intake.locator(".macro-target").nth(i)).toHaveText(text);
        await expect(intake.locator(".macro-percentage").nth(i)).toBeVisible({ visible: width >= 640 });
        await expect(intake.locator(".macro-position").nth(i)).toBeVisible({ visible: width >= 640 });
      }
      if (width < 640) {
        const counters = await intake.locator(".macro-legend-row").evaluateAll((rows) => rows.map((row) => {
          const r = row.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right };
        }));
        expect(counters[0].y).toBe(counters[1].y);
        expect(counters[1].y).toBe(counters[2].y);
        expect(counters[0].right).toBeLessThan(counters[1].x);
        expect(counters[1].right).toBeLessThan(counters[2].x);
      } else {
        expect(await contrast(page, ".macro-percentage")).toBeGreaterThanOrEqual(4.5);
      }
      await intake.getByText("Targets & details", { exact: true }).click();
      await expect(intake.getByText("Ordinary calculated target")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto("/");
      await expect(page.locator(".metric-trend")).toHaveCount(5);
      await expect(page.locator("img.fencer-study")).toBeVisible();
      expect(await page.locator("img.fencer-study").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await contrast(page, ".metric-value", "color", ".metric-tile")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(page, ".metric-meta", "color", ".metric-tile")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(page, ".metric-tile .recharts-area-curve", "stroke", ".metric-tile")).toBeGreaterThanOrEqual(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const scenario of ["over", "zero", "no-target"] as const) {
  test(`macro rings handle ${scenario} without misleading completion`, async ({ page, baseURL }) => {
    await fixtures(page, baseURL, scenario);
    await page.goto("/nutrition");
    const ring = page.locator(".nutrition-intake").getByRole("progressbar", { name: "Carbs", exact: true });
    await expect(ring).toBeVisible();
    if (scenario === "over") {
      await expect(ring).toHaveAttribute("aria-valuenow", "320");
      await expect(ring).toHaveAttribute("aria-valuetext", "400 of 320 g");
      await expect(ring.locator(".macro-arc")).toHaveAttribute("stroke-dasharray", "100 100");
      await expect(page.locator(".macro-legend-row").first()).toContainText("125%");
    } else {
      await expect(ring).toHaveAttribute("aria-valuenow", "0");
      await expect(ring.locator(".macro-arc")).toHaveAttribute("visibility", "hidden");
      await expect(ring).toHaveAttribute("aria-valuetext", scenario === "zero" ? "0 of 320 g" : "160 g; no target set");
    }
  });
}

test("unavailable nutrition totals do not masquerade as zero intake", async ({ page, baseURL }) => {
  await fixtures(page, baseURL, "unavailable");
  await page.goto("/nutrition");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.locator(".nutrition-rings")).toHaveCount(0);
});

test("a single zero metric reading remains visible, null dates remain missing", async ({ page, baseURL }) => {
  await fixtures(page, baseURL, "sparse");
  await page.goto("/");
  await expect(page.locator(".metric-trend")).toHaveCount(5);
  await expect(page.locator(".metric-value").first()).toContainText("0.0");
  await expect(page.locator(".metric-trend .recharts-area-dots").first()).toBeVisible();
  await expect(page.locator(".metric-trend .sr-only").first()).toContainText("2026-09-26: no reading; 2026-09-27: 0 ms; 2026-09-28: no reading");
});
