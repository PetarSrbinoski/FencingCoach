import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../testing/frontend/e2e",
  testMatch: "future-ai.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "../testing/.artifacts/future-ai/browser-results",
  reporter: [["list"], ["html", { outputFolder: "../testing/.artifacts/future-ai/browser-report", open: "never" }]],
  use: { baseURL: `http://localhost:${process.env.TEST_FRONTEND_PORT || "13009"}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
