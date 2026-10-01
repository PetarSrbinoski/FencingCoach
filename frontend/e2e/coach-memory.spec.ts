import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:18001";

test.beforeEach(async ({ request }) => {
  const conversations = await (await request.get(`${api}/chat/conversations`)).json();
  for (const conversation of conversations) await request.delete(`${api}/chat/conversations/${conversation.id}`);
  const state = await (await request.get(`${api}/coach-memory`)).json();
  for (const memory of state.items) {
    await request.delete(`${api}/coach-memory/${memory.id}`, { data: {
      expected_revision: memory.revision, request_id: crypto.randomUUID(),
    } });
  }
  await request.put(`${api}/coach-memory/settings`, { data: { enabled: true } });
});

test("athlete manages memory and disabling persists after reload", async ({ page }) => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Coach options" }).click();
  await page.getByRole("menuitem", { name: "What my coach knows" }).click();
  await expect(page.getByRole("heading", { name: "What my coach knows" })).toBeVisible();
  await expect(page.getByText("No memories yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add memory" }).click();
  await page.getByLabel("Memory content").fill("My gym only has dumbbells");
  await page.getByRole("button", { name: "Save memory" }).click();
  await page.reload();
  const memory = page.getByRole("article").filter({ hasText: "My gym only has dumbbells" });
  await expect(memory).toBeVisible();
  await expect(memory.getByText("Explicit", { exact: true })).toBeVisible();
  await memory.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Memory content").fill("Gym sessions must stay under 45 minutes");
  await page.getByLabel("Last active date").fill("2020-01-01");
  await page.getByRole("button", { name: "Save memory" }).click();
  const edited = page.getByRole("article").filter({ hasText: "Gym sessions must stay under 45 minutes" });
  await expect(edited.getByText("Expired · inactive", { exact: true })).toBeVisible();
  await edited.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Memory confirmed" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Use coach memory" }).uncheck();
  await expect(page.getByRole("status").filter({ hasText: "Coach memory disabled." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Use coach memory" })).not.toBeChecked();
  await edited.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete memory", exact: true }).click();
  await expect(page.getByText("No memories yet.")).toBeVisible();
});

test("chat-created inference can be confirmed and safely reversed from Agent logs", async ({ page, request }) => {
  await page.goto("/chat");
  await page.getByPlaceholder("Ask your coach…").fill("I usually eat rice for lunch");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Saved a tentative preference.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Coach options" }).click();
  await page.getByRole("menuitem", { name: "What my coach knows" }).click();
  const memory = page.getByRole("article").filter({ hasText: "Prefers rice for lunch" });
  await expect(memory.getByText("Inferred", { exact: true })).toBeVisible();
  await expect(memory.getByText("Unconfirmed", { exact: true })).toBeVisible();
  await memory.getByText("Source and history").click();
  await expect(memory.getByText("I usually eat rice for lunch", { exact: true })).toBeVisible();
  await memory.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(memory.getByText("Confirmed by you", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agent logs", exact: true }).click();
  const receipt = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Coach memory: Confirm memory: Prefers rice for lunch" }) }).first();
  await receipt.getByText("Review changes & undo").click();
  await receipt.getByRole("button", { name: "Preview Undo" }).click();
  await receipt.getByRole("button", { name: "Confirm Undo" }).click();
  await expect(receipt.getByText("Status: undone", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(memory.getByText("Unconfirmed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(memory.getByText("Unconfirmed", { exact: true })).toBeVisible();
  // A later edit protects the original create receipt from undo.
  const state = await (await request.get(`${api}/coach-memory`)).json();
  const item = state.items[0];
  await request.put(`${api}/coach-memory/${item.id}`, { data: { content: "Prefers rice with vegetables", expires_on: null,
    expected_revision: item.revision, request_id: crypto.randomUUID() } });
  await page.getByRole("button", { name: "Agent logs", exact: true }).click();
  const created = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Coach memory: Create memory: Prefers rice for lunch" }) }).first();
  await created.getByText("Review changes & undo").click();
  await created.getByRole("button", { name: "Preview Undo" }).click();
  await created.getByRole("button", { name: "Confirm Undo" }).click();
  await expect(page.getByRole("alert")).toContainText("Memory changed since this action");
});

test("keyboard editing shows stale conflicts and preserves the newer memory", async ({ page, request }) => {
  const response = await request.post(`${api}/coach-memory`, { data: { content: "Practice distance control", request_id: crypto.randomUUID() } });
  const memory = await response.json();
  await page.goto("/chat/memory");
  await page.getByRole("button", { name: "Edit", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Memory content").fill("Practice footwork");
  await request.put(`${api}/coach-memory/${memory.id}`, { data: {
    content: "Coach says prioritize timing", expected_revision: memory.revision, request_id: crypto.randomUUID(),
  } });
  await page.getByRole("button", { name: "Save memory" }).click();
  await expect(page.getByRole("alert")).toContainText("Memory changed since you opened it");
  await page.route(`${api}/coach-memory`, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Reload and review" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Reload failed. Your edit is preserved.");
  await expect(page.getByLabel("Memory content")).toHaveValue("Practice footwork");
  await page.unroute(`${api}/coach-memory`);
  await page.getByRole("button", { name: "Reload and review" }).click();
  await expect(page.getByText("Coach says prioritize timing", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("memory loading failure offers retry and blank content cannot be saved", async ({ page }) => {
  await page.route(`${api}/coach-memory`, (route) => route.abort("failed"));
  await page.goto("/chat/memory");
  await expect(page.getByRole("alert").filter({ hasText: "Failed to fetch" })).toBeVisible();
  await page.unroute(`${api}/coach-memory`);
  await page.getByRole("button", { name: "Reload memories" }).click();
  await expect(page.getByText("No memories yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add memory" }).click();
  await page.getByLabel("Memory content").fill("   ");
  await page.getByRole("button", { name: "Save memory" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Enter a memory before saving");
  await page.keyboard.press("Escape");
  await expect(page.getByText("No memories yet.")).toBeVisible();
});
