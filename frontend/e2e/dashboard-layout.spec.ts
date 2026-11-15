import { expect, test } from "@playwright/test";

const { data: fixtureData } = require("./mobile-fixtures.cjs");

// Notices must not change the dashboard's two-column placement. The mobile
// version keeps DOM order: readiness, coach, recovery, then the editorial row.
for (const width of [320, 390, 768, 1280, 1440]) {
  for (const state of ["ready", "error", "sync", "error-and-sync", "empty"] as const) {
    test(`${width}px dashboard: ${state}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route(/^http:\/\/localhost:8000\/|\/api\//, async (route) => {
        const url = new URL(route.request().url());
        url.pathname = url.pathname.replace(/^\/api(?=\/)/, "");
        const path = url.pathname;
        const headers = {
          "access-control-allow-origin": new URL(baseURL ?? "http://localhost:3000").origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "*",
        };
        if (route.request().method() === "OPTIONS") {
          return route.fulfill({ status: 204, headers });
        }
        let body = fixtureData(path, url);
        let status = 200;
        if (state.includes("error") && (path === "/readiness/today" || path.startsWith("/metrics/"))) {
          status = 503;
          body = { detail: "Readings temporarily unavailable" };
        }
        if (path === "/garmin/sync/recent") {
          body = { ok: true, outcome: "partial", fetched: {} };
        }
        if (state === "empty") {
          if (path.startsWith("/metrics/")) body = { kind: path.split("/").pop(), points: [] };
          if (path === "/readiness/today") body = { ...body, score: null, band: "unknown" };
          if (path === "/competitions") body = [];
        }
        return route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body ?? {}) });
      });
      await page.goto("/");
      const readiness = page.getByRole("region", { name: "Today's readiness", exact: true });
      const recovery = page.getByRole("region", { name: "Recovery metrics", exact: true });
      const coach = page.getByRole("region", { name: "Ask your coach", exact: true });
      await expect(readiness).toBeVisible();
      await expect(recovery.locator(".metric-tile")).toHaveCount(5);
      if (state.includes("error")) {
        await expect(page.locator(".dashboard-home > [role=alert]")).toBeVisible();
        await expect(recovery.getByText("Unavailable", { exact: true })).toHaveCount(5);
      } else if (state === "empty") {
        await expect(readiness.getByText("Unavailable today")).toBeVisible();
        await expect(page.getByText("No upcoming competitions.")).toBeVisible();
      } else {
        await expect(readiness.getByText("Today’s band: green")).toBeVisible();
        await expect(recovery.locator(".metric-value")).toHaveCount(5);
      }
      if (state.includes("sync")) {
        await page.getByRole("button", { name: "Sync", exact: true }).click();
        await expect(page.locator(".dashboard-home > [role=status]")).toContainText("Sync partially completed");
      }
      const r = (await readiness.boundingBox())!;
      const m = (await recovery.boundingBox())!;
      const c = (await coach.boundingBox())!;
      if (width >= 1280) {
        expect(Math.abs(r.y - m.y)).toBeLessThanOrEqual(1);
        expect(m.x).toBeGreaterThan(r.x + r.width);
        expect(Math.abs(c.y - (r.y + r.height + 16))).toBeLessThanOrEqual(1);
      } else {
        expect(c.y).toBeGreaterThanOrEqual(r.y + r.height + 16);
        expect(m.y).toBeGreaterThanOrEqual(c.y + c.height + 16);
        expect(Math.abs(m.x - r.x)).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const input = (await coach.getByRole("textbox").boundingBox())!;
      const send = (await coach.getByRole("button", { name: "Send message" }).boundingBox())!;
      expect(send.width).toBeGreaterThanOrEqual(44);
      expect(send.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(input.y + input.height / 2 - send.y - send.height / 2)).toBeLessThanOrEqual(1);
      const editorial = (await page.locator(".dashboard-editorial").boundingBox())!;
      expect(editorial.y).toBeGreaterThanOrEqual(m.y + m.height);
    });
  }
}
