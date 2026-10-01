import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "voice-logging.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "../.scratch/voice-logging/browser-results",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:13002", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "PYTHONPATH=../backend:.. ../.venv/bin/uvicorn backend.tests.support.voice_browser_app:app --host 127.0.0.1 --port 18002", url: "http://127.0.0.1:18002/docs", timeout: 60_000 },
    { command: "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18002 npx next dev -p 13002 -H 127.0.0.1", url: "http://127.0.0.1:13002/nutrition", timeout: 120_000 },
  ],
});
