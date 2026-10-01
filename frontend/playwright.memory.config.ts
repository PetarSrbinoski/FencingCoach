import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "coach-memory.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "../.scratch/coach-memory/browser-results",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:13001", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "PYTHONPATH=../backend:.. ../.venv/bin/uvicorn backend.tests.support.memory_browser_app:app --host 127.0.0.1 --port 18001", url: "http://127.0.0.1:18001/docs", timeout: 60_000 },
    { command: "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18001 npx next dev -p 13001 -H 127.0.0.1", url: "http://127.0.0.1:13001/chat", timeout: 120_000 },
  ],
});
