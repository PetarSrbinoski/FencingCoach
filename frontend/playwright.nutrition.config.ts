import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "nutrition-quick-log.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "../.scratch/nutrition-quick-log/results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:13003",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command:
      "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 node node_modules/next/dist/bin/next dev -p 13003 -H 127.0.0.1",
    url: "http://127.0.0.1:13003/nutrition",
    timeout: 120_000,
  },
});
