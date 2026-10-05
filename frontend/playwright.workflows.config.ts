import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "coach-memory.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "../.scratch/product-workflows/browser-artifacts/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "../.scratch/product-workflows/browser-artifacts/report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:13000",
    timezoneId: "Europe/Skopje",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npx next dev -p 13000",
    url: "http://localhost:13000/chat",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
