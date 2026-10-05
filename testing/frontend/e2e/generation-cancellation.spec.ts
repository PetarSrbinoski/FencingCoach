import { expect, test, type Page } from "@playwright/test";

async function mockApi(page: Page) {
  await page.route(/\/((chat|agent-actions|coach-plan-proposals|settings|profile|readiness|nutrition|targets|mealplan|foods)(\/|\?|$))/, async (route) => {
    if (!["fetch", "xhr"].includes(route.request().resourceType())) return route.continue();
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/agent-actions") json = { items: [], total: 0 };
    if (path === "/settings/llm-provider") json = { provider: "local" };
    if (path === "/readiness/today") json = { day: "2026-10-01", advisories: {} };
    if (path === "/profile" || path.startsWith("/mealplan")) json = null;
    if (path.startsWith("/targets")) json = null;
    if (path.startsWith("/nutrition/totals")) json = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, micros: {}, entry_count: 0 };
    await route.fulfill({ json });
  });
}

for (const kind of ["chat", "nutrition"] as const) {
  test(`${kind}: cancel during submission reaches the server and permits a new request`, async ({ page }) => {
    await mockApi(page);
    const isChat = kind === "chat";
    const path = isChat ? "/chat" : "/nutrition/estimate";
    const resultPath = isChat ? "/chat/messages/42" : "/nutrition/estimate/42";
    let accept!: () => void;
    const acceptance = new Promise<void>((resolve) => { accept = resolve; });
    let cancelled = false;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await acceptance;
      await route.fulfill({ status: 202, json: isChat
        ? { conversation_id: 1, message_id: 42, status: "pending" }
        : { id: 42, status: "pending" } });
    });
    await page.route(`**${resultPath}`, (route) => route.fulfill({ json: {
      id: 42, status: cancelled ? "cancelled" : "pending", content: "", nutrition_refs: [],
    } }));
    await page.route(`**${resultPath}/cancel`, async (route) => {
      expect(route.request().method()).toBe("POST");
      cancelled = true;
      await route.fulfill({ json: { id: 42, status: "cancelled", content: "", nutrition_refs: [] } });
    });
    await page.goto(isChat ? "/chat" : "/nutrition");
    const input = page.getByRole("textbox", { name: isChat ? "Message the coach" : "Meal description" });
    const send = page.getByRole("button", { name: isChat ? "Send message" : "Estimate", exact: true });
    await input.fill(isChat ? "Help me train" : "rice");
    await send.click();
    await expect(page.getByRole("button", { name: /Hide progress|Stop watching/ })).toHaveCount(0);
    await page.getByRole("button", { name: isChat ? "Cancel reply" : "Cancel estimate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancelling…", exact: true })).toBeDisabled();
    accept();
    await expect.poll(() => cancelled).toBe(true);
    await expect(page.getByRole("button", { name: "Cancelling…", exact: true })).toHaveCount(0);
    if (isChat) {
      await expect(page.getByText("Reply cancelled. Any actions already saved are kept.")).toBeVisible();
      await input.fill("Try a different question");
    } else {
      await expect(input).toHaveValue("rice");
      expect(await page.evaluate(() => sessionStorage.getItem("pendingNutritionEstimate"))).toBeNull();
      await expect(page.getByText("Review estimate", { exact: true })).toHaveCount(0);
    }
    await expect(send).toBeEnabled();
  });
}

test("chat: cancellation failure keeps the pending reply cancellable", async ({ page }) => {
  await mockApi(page);
  await page.route("**/chat", (route) => route.request().method() !== "POST" ? route.fallback() : route.fulfill({ status: 202, json: {
    conversation_id: 1, message_id: 42, status: "pending",
  } }));
  await page.route("**/chat/messages/42", (route) => route.fulfill({ json: { id: 42, status: "pending" } }));
  await page.route("**/chat/messages/42/cancel", (route) => route.fulfill({ status: 503, json: { detail: "Cancellation unavailable" } }));
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Message the coach" }).fill("hello");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Cancel reply" }).click();
  await expect(page.getByText("503: Cancellation unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel reply" })).toBeEnabled();
  await expect(page.getByText("Reply cancelled. Any actions already saved are kept.")).toHaveCount(0);
});
