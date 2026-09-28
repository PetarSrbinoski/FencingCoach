import { expect, test, type Page } from "@playwright/test";
const { data } = require("./mobile-fixtures.cjs");

async function fixture(page: Page) {
  await page.route("http://localhost:8000/**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body:
        route.request().method() === "OPTIONS"
          ? ""
          : JSON.stringify(data(url.pathname, url)),
    });
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`all routes fit at ${width}px and expose usable primary controls`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixture(page);
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/",
      "/training",
      "/nutrition",
      "/competitions",
      "/weekly",
      "/chat",
      "/garmin",
      "/profile",
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const result = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
        small: Array.from(
          document.querySelectorAll<HTMLElement>(
            "main button, main input:not([type=checkbox]), main select, main [role=combobox]",
          ),
        )
          .filter((element) => element.checkVisibility())
          .filter((element) => {
            const r = element.getBoundingClientRect();
            return r.height < 44 || r.width < 44;
          })
          .map(
            (element) =>
              element.textContent || element.getAttribute("aria-label"),
          ),
      }));
      expect(result, route).toEqual({ overflow: false, small: [] });
      if (width < 1024)
        await expect(
          page.getByRole("button", { name: "More navigation and settings" }),
        ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("nutrition views survive Back and food portions use the chosen date", async ({
  page,
}) => {
  await fixture(page);
  let submitted: any;
  await page.route(
    "http://localhost:8000/nutrition/foods/log",
    async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      submitted = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          id: 9,
          day: submitted.day,
          raw_text: "Greek yogurt",
          kcal: 240,
          protein_g: 20,
          carbs_g: 30,
          fat_g: 4,
        }),
      });
    },
  );
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Plans", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Shopping", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Diary", exact: true }).click();
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("button", { name: /^Greek yogurt/ }).click();
  const editor = page.getByRole("dialog", { name: "Log Greek yogurt" });
  await editor.getByLabel("Diary date").fill("2026-09-27");
  await editor.getByLabel("Amount eaten").fill("200");
  await expect(editor.getByText("Portion:", { exact: false })).toContainText(
    "240.0",
  );
  await editor.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByLabel("Diary date")).toHaveValue("2026-09-27");
  expect(submitted).toMatchObject({
    day: "2026-09-27",
    portions: [{ food_id: 1, grams: 200 }],
  });
});

test("failed deletion remains reviewable and retryable in the confirmation", async ({
  page,
}) => {
  await fixture(page);
  await page.route("http://localhost:8000/nutrition/log/1", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fallback()
      : route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ detail: "Try again later" }),
        }),
  );
  await page.goto("/nutrition");
  await page
    .getByRole("button", { name: "Delete entry", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Delete entry", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Try again later");
  await expect(
    dialog.getByRole("button", { name: "Delete entry", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Greek yogurt with oats, banana and honey", { exact: true }),
  ).toBeVisible();
});

test("profile draft survives internal navigation and returns to the same values", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/profile");
  await page.getByLabel("Name", { exact: true }).fill("Unsaved athlete");
  // The guard works for both the desktop sidebar and the mobile dock.
  await page.getByRole("link", { name: "Training", exact: true }).click();
  await page.getByRole("button", { name: "Leave and keep draft" }).click();
  await expect(page).toHaveURL(/\/training/);
  await page.goto("/profile");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved athlete",
  );
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Alex");
});

test("mobile editors stay within the viewport and restore trigger focus", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/competitions");
  const trigger = page.getByRole("button", {
    name: "Add competition",
    exact: true,
  });
  await trigger.click();
  const editor = page.getByRole("dialog");
  const box = await editor.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(320);
  expect(box!.height).toBeLessThanOrEqual(568);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
});

test("secondary views and food editor stay readable at 320px", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const route of [
    "/training?view=fencing",
    "/training?view=mindset",
    "/weekly?view=training",
    "/weekly?view=nutrition",
    "/nutrition?view=plans&planView=competition",
    "/nutrition?view=plans&planView=shopping",
    "/nutrition?view=foods",
  ]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      route,
    ).toBeLessThanOrEqual(320);
  }
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  const smallInputs = await editor
    .locator("input, textarea, select, [role=combobox]")
    .evaluateAll(
      (elements) =>
        elements
          .filter((element) => element.checkVisibility())
          .filter(
            (element) => parseFloat(getComputedStyle(element).fontSize) < 16,
          ).length,
    );
  expect(smallInputs).toBe(0);
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test("editor follows a reduced visual viewport while typing", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/competitions");
  await page
    .getByRole("button", { name: "Add competition", exact: true })
    .click();
  await page.locator("#event-name").focus();
  // Simulates the VisualViewport event; this is not a physical keyboard test.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      get: () => 440,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const editor = page.getByRole("dialog");
  await expect
    .poll(async () => {
      const box = await editor.boundingBox();
      return Math.round(box!.y + box!.height);
    })
    .toBeLessThanOrEqual(440);
  await expect(page.locator("[data-mobile-dock]")).toBeHidden();
});
