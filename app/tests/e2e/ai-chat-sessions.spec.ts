// Browser coverage for per-document AI Chat Sessions (issue #24 / A2).
//
// These tests exercise the real, mock-service-driven AI Chat Sidebar — no
// `?aiChatFixture=` param anywhere here; that param is A1's test-only
// backstage door and is covered by ai-chat.spec.ts until A3 removes it.
// Multi-tab orchestration goes through `window.__pdfSpike.tabs`, the same
// hook tabs-multidoc.spec.ts uses; everything user-visible is asserted
// through the rendered UI (role-based locators), never via internals.

import { expect, test } from "./coverage";
import type { Page } from "@playwright/test";
import { loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

// Bytes of the bundled sample, fetched in-page so a second tab can open
// without Tauri file IO in the browser build (same trick as tabs-multidoc).
async function sampleBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
}

type TabSummary = { id: string; active: boolean };
async function tabList(page: Page): Promise<TabSummary[]> {
  return page.evaluate(() => window.__pdfSpike!.tabs.list());
}

async function activateTab(page: Page, id: string) {
  await page.evaluate((tabId) => window.__pdfSpike!.tabs.activate(tabId), id);
  await waitForPageReady(page);
}

function chatPanel(page: Page) {
  return page.getByRole("tabpanel", { name: "AI Chat" });
}

function composerInput(page: Page) {
  return chatPanel(page).getByRole("textbox", { name: "Message AI Chat" });
}

// Send one message through the composer UI and wait for its mock reply.
// Unscripted prompts get the deterministic fallback that names both the
// prompt and the turn number, so each (tab, turn) pair is distinguishable.
async function sendMessage(page: Page, text: string, expectedReplyFragment: string) {
  await composerInput(page).fill(text);
  await chatPanel(page).getByRole("button", { name: "Send message" }).click();
  await expect(chatPanel(page).getByText(text, { exact: true })).toBeVisible();
  await expect(chatPanel(page).getByText(expectedReplyFragment, { exact: false })).toBeVisible();
}

function conversationScrollTop(page: Page): Promise<number> {
  return chatPanel(page)
    .locator(".conversation")
    .evaluate((element) => element.scrollTop);
}

// Grow the active conversation until it overflows, then scroll to a known
// offset. Returns that offset. The guard assertion keeps the test honest: a
// non-overflowing conversation would clamp scrollTop to 0 and false-pass.
async function scrollConversationTo(page: Page, target: number): Promise<number> {
  const conversation = chatPanel(page).locator(".conversation");
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(target);
  await conversation.evaluate((element, top) => {
    element.scrollTop = top;
  }, target);
  await expect.poll(() => conversationScrollTop(page)).toBe(target);
  return target;
}

test("default page shows the real empty AI Chat state, not the A1 fixture", async ({ page }) => {
  await openApp(page);
  const panel = chatPanel(page);
  await expect(panel.getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(panel.getByText("Write a message to begin.", { exact: true })).toBeVisible();
  // The completed fixture's canned conversation must not leak into real mode.
  await expect(panel.getByText("What is the main argument?", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Static example", { exact: true })).toHaveCount(0);
});

test("sending appends the user turn and a deterministic mock reply; follow-ups stay in the same conversation", async ({
  page,
}) => {
  await openApp(page);
  await loadFixture(page);

  await sendMessage(page, "Summarize this PDF", "Mock summary:");
  // The scripted reply carries its fixed AI Chat Page Citation.
  await expect(chatPanel(page).getByText("Page 1", { exact: true })).toBeVisible();

  // Follow-up turn: appends to the same single session (turn #2).
  await sendMessage(page, "and then?", 'Mock reply #2: you asked "and then?"');
  await expect(chatPanel(page).getByText("Summarize this PDF", { exact: true })).toBeVisible();
});

test("two Document Tabs keep isolated conversations and restore them on switch", async ({ page }) => {
  await openApp(page);
  await loadFixture(page); // tab 1
  const bytes = await sampleBytes(page);
  const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  const firstId = (await tabList(page)).find((tab) => tab.id !== secondId)!.id;

  // Converse in the second (active) tab only.
  await sendMessage(page, "hello from second", 'Mock reply #1: you asked "hello from second"');

  // The first tab has its own — still empty — AI Chat Session.
  await activateTab(page, firstId);
  await expect(chatPanel(page).getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(chatPanel(page).getByText("hello from second", { exact: true })).toHaveCount(0);

  // Converse in the first tab; its reply is also turn #1 — per-session counters.
  await sendMessage(page, "hello from first", 'Mock reply #1: you asked "hello from first"');

  // Back to the second tab: exactly its own two turns, nothing from the first.
  await activateTab(page, secondId);
  await expect(chatPanel(page).getByText("hello from second", { exact: true })).toBeVisible();
  await expect(chatPanel(page).getByText("hello from first", { exact: true })).toHaveCount(0);
});

test("returning to a Document Tab restores its chat scroll position", async ({ page }) => {
  await openApp(page);
  await loadFixture(page); // tab 1
  const bytes = await sampleBytes(page);
  const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  const firstId = (await tabList(page)).find((tab) => tab.id !== secondId)!.id;

  // Build an overflowing conversation in the second tab, scroll to a known
  // mid-conversation offset, then leave and come back.
  for (let turn = 1; turn <= 8; turn += 1) {
    await sendMessage(page, `filler line ${turn}`, `Mock reply #${turn}:`);
  }
  const offset = await scrollConversationTo(page, 80);

  await activateTab(page, firstId);
  await expect(chatPanel(page).getByText("Ask about this PDF", { exact: true })).toBeVisible();

  await activateTab(page, secondId);
  await expect.poll(() => conversationScrollTop(page)).toBe(offset);
});

test("the unsent composer draft is per-document", async ({ page }) => {
  await openApp(page);
  await loadFixture(page); // tab 1
  const bytes = await sampleBytes(page);
  const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  const firstId = (await tabList(page)).find((tab) => tab.id !== secondId)!.id;

  await composerInput(page).fill("draft for second");
  await activateTab(page, firstId);
  await expect(composerInput(page)).toHaveValue("");
  await composerInput(page).fill("draft for first");

  await activateTab(page, secondId);
  await expect(composerInput(page)).toHaveValue("draft for second");
  await activateTab(page, firstId);
  await expect(composerInput(page)).toHaveValue("draft for first");
});

test("a draft typed with no document open does not leak into the first opened document", async ({ page }) => {
  await openApp(page);
  await composerInput(page).fill("orphan draft");
  await loadFixture(page);
  // The new Document Session starts with an empty per-document draft; the
  // no-document draft is shell-local and must not seed it.
  await expect(composerInput(page)).toHaveValue("");
});

test("closing the final Document Tab clears the conversation and composer", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  await sendMessage(page, "will be disposed", 'Mock reply #1: you asked "will be disposed"');
  await composerInput(page).fill("doomed draft");

  const [only] = await tabList(page);
  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), only.id);

  const panel = chatPanel(page);
  await expect(panel.getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(panel.getByText("will be disposed", { exact: true })).toHaveCount(0);
  await expect(composerInput(page)).toHaveValue("");
});

test("closing a Document Tab disposes its AI Chat Session; reopening starts fresh", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  await sendMessage(page, "ephemeral", 'Mock reply #1: you asked "ephemeral"');

  const [only] = await tabList(page);
  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), only.id);

  // Reopen the same document: one document → one *new* session (no
  // persistence across close, per issue #24 non-goals).
  await loadFixture(page);
  await expect(chatPanel(page).getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(chatPanel(page).getByText("ephemeral", { exact: true })).toHaveCount(0);
});

// Cross-side docking recreates the sidebar panel DOM (keyed {#each} per
// side), which would silently reset the conversation's scroll position; the
// shell captures before the dock move and restores after. Companion to the
// docking-draft test in ui-shell.spec.ts.
test("docking AI Chat to the opposite side preserves the chat scroll position", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  for (let turn = 1; turn <= 8; turn += 1) {
    await sendMessage(page, `filler line ${turn}`, `Mock reply #${turn}:`);
  }
  const offset = await scrollConversationTo(page, 80);

  // Drag the AI Chat sidebar tab into the left dock strip (same gesture as
  // ui-shell.spec.ts's docking-draft test).
  const tab = page.getByRole("tab", { name: "AI Chat" });
  const box = await tab.boundingBox();
  if (!box) throw new Error("AI Chat tab is not visible");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + ((10 - startX) * step) / steps, startY + ((90 - startY) * step) / steps);
  }
  await page.mouse.up();

  await expect(page.locator('.sidebar[data-side="left"] #panel-ai-chat')).toBeVisible();
  await expect.poll(() => conversationScrollTop(page)).toBe(offset);
});
