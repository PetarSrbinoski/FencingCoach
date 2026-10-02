import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:18002";

test.beforeEach(async ({ request }) => {
  const foods = await (await request.get(`${api}/nutrition/foods`)).json();
  for (const food of foods) await request.delete(`${api}/nutrition/foods/${food.id}`);
  const logs = await (await request.get(`${api}/nutrition/log?days=90`)).json();
  for (const log of logs) await request.delete(`${api}/nutrition/log/${log.id}`);
});

async function openVoice(page: import("@playwright/test").Page) {
  await page.goto("/nutrition");
}

test("permission denial leaves manual entry available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) } });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: class {
      static isTypeSupported() { return true; }
    } });
  });
  await openVoice(page);
  await page.getByRole("button", { name: "Record voice" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Microphone permission was denied" })).toBeVisible();
  await expect(page.getByLabel("Meal description")).toBeVisible();
});

test("corrected speech is reviewed before separate save and log actions", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
    } });
    class Recorder {
      state = "inactive";
      mimeType: string;
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor(_: unknown, options: { mimeType: string }) { this.mimeType = options.mimeType; }
      static isTypeSupported(type: string) { return type === "audio/webm"; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["recording"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
  });
  await openVoice(page);
  await page.getByRole("button", { name: "Record voice" }).click();
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await expect(page.getByRole("heading", { name: "Review interpretation" })).toBeVisible();
  await page.getByLabel("Correct transcription").fill("Save kefir pot, 150 grams, 90 calories, 6 grams protein, 12 grams carbs, 2 grams fat");
  await page.getByRole("button", { name: "Reinterpret correction" }).click();
  await expect(page.getByLabel("Food name")).toHaveValue("Kefir pot");
  await page.getByRole("button", { name: "Save food" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved Kefir pot" })).toBeVisible();
  expect(await (await request.get(`${api}/nutrition/log?days=90`)).json()).toEqual([]);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Saved Kefir pot" })).toBeVisible();
  await page.getByRole("button", { name: "Start another" }).click();
  await page.getByRole("button", { name: "Record voice" }).click();
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await page.getByLabel("Correct transcription").fill("I ate half a pot of kefir");
  await page.getByRole("button", { name: "Reinterpret correction" }).click();
  await expect(page.getByText("Preview: 45 kcal", { exact: false })).toBeVisible();
  await page.getByLabel("Voice meal").selectOption("lunch");
  await page.getByRole("button", { name: "Log consumption" }).click();
  const logs = await (await request.get(`${api}/nutrition/log?days=90`)).json();
  expect(logs).toHaveLength(1);
  expect(logs[0].kcal).toBe(45);
  await page.getByRole("button", { name: "Undo in Agent logs" }).click();
  expect(await (await request.get(`${api}/nutrition/log?days=90`)).json()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
