import { defineConfig, devices } from "@playwright/test";

const artifactDir = process.env.TEST_ARTIFACT_DIR ?? "../testing/.artifacts/latest";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: `${artifactDir}/test-results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactDir}/playwright.json` }],
    ["html", { outputFolder: `${artifactDir}/html`, open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${process.env.TEST_FRONTEND_PORT ?? "13000"}`,
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
