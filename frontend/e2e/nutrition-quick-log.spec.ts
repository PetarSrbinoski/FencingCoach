import { expect, test, type Page } from "@playwright/test";
const { data } = require("./mobile-fixtures.cjs");
const day = "2026-09-28";
const name = "Greek yogurt with oats, banana and honey";

async function fixture(
  page: Page,
  options: {
    failRepeat?: boolean;
    failRecent?: boolean;
    pending?: boolean;
  } = {},
) {
  const rows = structuredClone(
    data(
      "/nutrition/log",
      new URL(`http://localhost:8000/nutrition/log?day=${day}`),
    ),
  );
  const repeats: any[] = [];
  const saves: any[] = [];
  const portions: any[] = [];
  const deletes: number[] = [];
  let nextId = 100;
  let failed = false;
  let pending = !!options.pending;
  const replay = new Map<string, any>();
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: status === 204 ? "" : JSON.stringify(body),
      });
    if (method === "OPTIONS") return respond(null, 204);
    if (path === "/nutrition/log" && method === "GET") {
      if (options.failRecent && url.searchParams.has("days"))
        return respond({ detail: "Recent foods unavailable" }, 503);
      return respond(
        url.searchParams.has("day")
          ? rows.filter((row: any) => row.day === url.searchParams.get("day"))
          : rows,
      );
    }
    if (path.match(/\/nutrition\/log\/\d+\/repeat$/)) {
      const body = route.request().postDataJSON();
      repeats.push(body);
      const original = rows.find(
        (row: any) => row.id === Number(path.split("/")[3]),
      );
      const entry = replay.get(body.request_id) ?? {
        ...original,
        ...body,
        id: nextId++,
        logged_at: "2026-09-28T14:00:00Z",
        kcal: original.kcal * body.multiplier,
      };
      if (!replay.has(body.request_id)) rows.push(entry);
      replay.set(body.request_id, entry);
      if (options.failRepeat && !failed) {
        failed = true;
        return respond({ detail: "Connection interrupted" }, 503);
      }
      return respond(entry, 201);
    }
    if (path.match(/\/nutrition\/log\/\d+$/) && method === "DELETE") {
      const id = Number(path.split("/").at(-1));
      deletes.push(id);
      const index = rows.findIndex((row: any) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return respond(null, 204);
    }
    if (path === "/nutrition/foods/log") {
      const body = route.request().postDataJSON();
      portions.push(body);
      const entry = {
        ...rows[0],
        id: nextId++,
        day: body.day,
        meal: body.meal,
        raw_text: "Greek yogurt",
        kcal: 180,
        logged_at: "2026-09-28T14:00:00Z",
      };
      rows.push(entry);
      return respond(entry, 201);
    }
    if (path === "/nutrition/estimate" && method === "POST")
      return respond({ id: 9, status: "pending" }, 202);
    if (path === "/nutrition/estimate/9")
      return respond({
        id: 9,
        status: pending ? "pending" : "done",
        kcal: 510,
        protein_g: 33,
        carbs_g: 60,
        fat_g: 15,
        fiber_g: 7,
        micros: {},
        items: [{ name: "Chicken", qty_g: 200 }],
        confidence: "high",
        notes: "Synthetic estimate",
        estimated_by: "llm",
      });
    if (path === "/nutrition/log" && method === "POST") {
      const body = route.request().postDataJSON();
      saves.push(body);
      const entry = {
        ...rows[0],
        ...body,
        id: nextId++,
        logged_at: "2026-09-28T14:00:00Z",
      };
      rows.push(entry);
      return respond(entry, 201);
    }
    if (path.startsWith("/nutrition/totals/")) {
      const selected = rows.filter(
        (row: any) => row.day === path.split("/").at(-1),
      );
      const totals: any = {
        entry_count: selected.length,
        micros: {},
        incomplete_micros: [],
      };
      for (const key of ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"])
        totals[key] = selected.reduce(
          (sum: number, row: any) => sum + (row[key] || 0),
          0,
        );
      return respond(totals);
    }
    return respond(data(path, url));
  });
  return {
    rows,
    repeats,
    saves,
    portions,
    deletes,
    finishEstimate: () => {
      pending = false;
    },
  };
}

test("one tap repeats to the selected day and meal; Undo removes only the copy", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto("/nutrition");
  await expect(
    page.getByRole("button", { name: `Log ${name} again` }),
  ).toBeVisible();
  await page.screenshot({
    path: `.scratch/nutrition-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Diary date", { exact: true }).fill("2026-09-27");
  await page.getByLabel("Meal slot", { exact: true }).selectOption("lunch");
  await page.getByRole("button", { name: `Log ${name} again` }).click();
  await expect(
    page.getByRole("button", { name: `Undo logging ${name}` }),
  ).toBeVisible();
  expect(state.repeats).toHaveLength(1);
  expect(state.repeats[0]).toMatchObject({
    day: "2026-09-27",
    meal: "lunch",
    multiplier: 1,
  });
  expect(
    state.rows.filter((row: any) => row.day === "2026-09-27"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: `Undo logging ${name}` }).click();
  await expect(
    page.getByRole("button", { name: `Undo logging ${name}` }),
  ).toHaveCount(0);
  expect(state.deletes).toEqual([100]);
  expect(state.rows.some((row: any) => row.id === 1)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("repeat retries reuse the request id and inline portions scale the copy", async ({
  page,
}) => {
  const state = await fixture(page, { failRepeat: true });
  await page.goto("/nutrition");
  const quick = page.getByRole("region", { name: "Quick food logging" });
  await quick
    .getByRole("button", {
      name: `${name} Last recorded portion`,
      exact: false,
    })
    .click();
  await page.getByLabel("Portion amount").fill("0.5");
  await quick.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(quick.getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await quick.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Undo logging ${name}` }),
  ).toBeVisible();
  expect(state.repeats).toHaveLength(2);
  expect(state.repeats[0].request_id).toBe(state.repeats[1].request_id);
  expect(state.repeats[1].multiplier).toBe(0.5);
  expect(state.rows.filter((row: any) => row.id === 100)).toHaveLength(1);
  expect(state.rows.find((row: any) => row.id === 100).kcal).toBe(270);
});

test("saved food search opens an inline portion with the named serving prefilled", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/nutrition?day=2026-09-27");
  await page.getByLabel("Search recent and saved foods").fill("Greek yogurt");
  await page
    .getByRole("button", { name: "Greek yogurt one pot · 150 g", exact: true })
    .click();
  await expect(page.getByLabel("Portion amount")).toHaveValue("1");
  await expect(page.getByLabel("Portion measure")).toHaveValue("servings");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Portion measure").selectOption("grams");
  await expect(page.getByLabel("Portion amount")).toHaveValue("150");
  await page.getByLabel("Portion amount").fill("200");
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Undo logging Greek yogurt",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.portions).toEqual([
    { day: "2026-09-27", portions: [{ food_id: 1, grams: 200 }] },
  ]);
});

test("inline estimate preserves its description and destination until reviewed and saved", async ({
  page,
}) => {
  const state = await fixture(page, { pending: true });
  await page.goto("/nutrition");
  await page.getByLabel("Meal slot", { exact: true }).selectOption("dinner");
  await page.getByLabel("Meal description").fill("200 g chicken with rice");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByLabel("Meal description")).toBeDisabled();
  await page.getByLabel("Diary date", { exact: true }).fill("2026-09-27");
  state.finishEstimate();
  await expect(
    page.getByText("Review estimate", { exact: true }),
  ).toBeVisible();
  expect(state.saves).toHaveLength(0);
  await expect(page.getByLabel("Kcal", { exact: true })).toBeHidden();
  await page.getByText("Edit calories & macros", { exact: true }).click();
  await page.getByLabel("Kcal", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByLabel("Meal description")).toHaveValue("");
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0]).toMatchObject({
    raw_text: "200 g chicken with rice",
    day,
    meal: "dinner",
    kcal: 600,
    estimated_by: "manual",
  });
});

test("recent-food failure leaves description usable and mobile controls fit at 320px", async ({
  page,
}) => {
  await fixture(page, { failRecent: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/nutrition");
  await expect(page.getByText(/Some foods could not be loaded/)).toBeVisible();
  await page.getByLabel("Meal description").fill("Rice and vegetables");
  await expect(
    page.getByRole("button", { name: "Estimate", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByText("All nutrients & totals", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const find = page.getByRole("button", { name: "Find food", exact: true });
  await expect(find).toBeInViewport();
  await find.click();
  await expect(page.getByLabel("Search recent and saved foods")).toBeFocused();
});
