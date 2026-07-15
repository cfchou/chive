// Browser coverage for the AI Chat generation lifecycle (issue #25 / A3).
//
// These drive the real, mock-service-driven AI Chat Sidebar through streaming,
// Stop, errors, retry, citation navigation, viewport anchoring, and Document
// Tab switching while a generation is running. Everything is asserted through
// the rendered UI (role-based locators), never via internals.
//
// Waiting rule: never sleep to wait for something to HAPPEN — poll the
// observable state instead. There is exactly one deliberate exception, marked
// at its use below: proving that something never happens (no late chunk after
// Stop) has no state to wait for, so it needs a bounded wait past the moment
// the thing would have occurred.
//
// The mock's scripted prompts are what make timing deterministic:
//   - "Summarize this PDF" / "Explain the current page" stream quickly and cite
//     a fixed page;
//   - "Respond slowly" parks for 10s before its first chunk, so the generating
//     state (and a Stop with nothing streamed yet) is reachable without a race;
//   - "Pause after the first chunk" emits one chunk fast, then waits 3s before
//     each next one — a wide, deterministic window to Stop after partial
//     content, type a follow-up, or scroll;
//   - "Fail to respond" always fails (the mock is stateless, so a retry fails
//     again — which is exactly what the retry test asserts).

import { expect, test } from "./coverage";
import type { Page } from "@playwright/test";
import { loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

// Text from the opening of the "Pause after the first chunk" reply, short
// enough to be inside the first fragment at any sane chunk size. Deliberately
// NOT the exact first fragment: that would encode the chunker's 24-char
// budget — an implementation detail — into an e2e test, so tuning the chunk
// size would break this for reasons that have nothing to do with the UI.
// Deriving it from chunkReply() instead would be worse: the test would then
// compute its expectation with the same code under test and could never
// disagree with it. A known-good literal from the scripted reply is the
// independent source of truth.
const PAUSE_REPLY_OPENING = "Mock paused reply";
// The last words of that reply, which must never arrive once Stop is pressed.
const PAUSE_REPLY_TAIL = "at a time";
const GENERATION_ERROR = "The response could not be generated.";

function chatPanel(page: Page) {
  return page.getByRole("tabpanel", { name: "AI Chat" });
}
function composerInput(page: Page) {
  return chatPanel(page).getByRole("textbox", { name: "Message AI Chat" });
}
function sendButton(page: Page) {
  return chatPanel(page).getByRole("button", { name: "Send message" });
}
function stopButton(page: Page) {
  return chatPanel(page).getByRole("button", { name: "Stop generating" });
}
/** The newest AI bubble — the streaming one while generating, else the last reply. */
function lastAiBubble(page: Page) {
  return chatPanel(page).locator('article[aria-label="AI"]').last();
}

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

/** Type a prompt and press Send, without waiting for the reply. */
async function startSend(page: Page, text: string) {
  await composerInput(page).fill(text);
  await sendButton(page).click();
}

/** Send and wait for the reply to finish streaming. */
async function sendAndSettle(page: Page, text: string, expectedFragment: string) {
  await startSend(page, text);
  await expect(chatPanel(page).getByText(expectedFragment, { exact: false })).toBeVisible();
  await expect(sendButton(page)).toBeVisible();
}

function conversationMetrics(page: Page) {
  return chatPanel(page)
    .locator(".conversation")
    .evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
}

test("streams a scripted reply from Send through completion, ending with its citation", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  await startSend(page, "Summarize this PDF");

  // The user turn is visible at once, and the action becomes Stop while the
  // reply is being generated.
  await expect(chatPanel(page).getByText("Summarize this PDF", { exact: true })).toBeVisible();
  await expect(stopButton(page)).toBeVisible();
  await expect(chatPanel(page).getByRole("status")).toHaveText("Generating response…");

  // The reply lands in full, the generating note clears, and the action
  // returns to Send.
  await expect(chatPanel(page).getByText("Mock summary: the document introduces", { exact: false })).toBeVisible();
  await expect(chatPanel(page).getByText("supporting evidence.", { exact: false })).toBeVisible();
  await expect(chatPanel(page).getByRole("status")).toHaveCount(0);
  await expect(sendButton(page)).toBeVisible();
  await expect(stopButton(page)).toHaveCount(0);

  // The scripted citation arrives with the finished reply, as a real button.
  await expect(chatPanel(page).getByRole("button", { name: "Go to page 1" })).toBeVisible();
});

test("Stop before any content leaves no reply behind and returns to Send", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  await startSend(page, "Respond slowly");
  await expect(stopButton(page)).toBeVisible();

  await stopButton(page).click();

  await expect(sendButton(page)).toBeVisible();
  await expect(chatPanel(page).getByRole("status")).toHaveCount(0);
  // Nothing streamed before the Stop, so no assistant turn was kept.
  await expect(chatPanel(page).locator('article[aria-label="AI"]')).toHaveCount(0);
  await expect(chatPanel(page).getByText("Respond slowly", { exact: true })).toBeVisible();

  // The session still works afterwards.
  await sendAndSettle(page, "after the stop", 'Mock reply #2: you asked "after the stop"');
});

test("Stop keeps the content that already streamed, as a finished reply without a citation", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  await startSend(page, "Pause after the first chunk");
  // Wait for the first fragment, then Stop inside the 3s pause that follows.
  await expect(lastAiBubble(page)).toContainText(PAUSE_REPLY_OPENING);
  await stopButton(page).click();

  await expect(sendButton(page)).toBeVisible();
  await expect(chatPanel(page).getByRole("status")).toHaveCount(0);

  // The partial text survives as a committed assistant turn...
  const kept = lastAiBubble(page);
  await expect(kept).toContainText(PAUSE_REPLY_OPENING);
  // ...and it really is partial (the reply's ending never arrived).
  await expect(kept).not.toContainText(PAUSE_REPLY_TAIL);
  // Citations belong to a natural completion only.
  await expect(chatPanel(page).getByRole("button", { name: /Go to page/ })).toHaveCount(0);

  // The one sanctioned sleep (see the waiting rule at the top). This asserts an
  // absence — that no further chunk revives the stopped generation — so there
  // is no state to poll for. The only way to know nothing arrived is to wait
  // past the 3s pause when the next chunk would have been due, and look again.
  // The deterministic version of this lives in the unit tests, where a stopped
  // generation is shown to reject a late chunk outright.
  await page.waitForTimeout(3500);
  await expect(kept).not.toContainText(PAUSE_REPLY_TAIL);

  await sendAndSettle(page, "still working", 'Mock reply #2: you asked "still working"');
});

test("a follow-up draft typed while chunks arrive is not erased, and survives a tab switch", async ({ page }) => {
  await openApp(page);
  await loadFixture(page); // tab 1
  const bytes = await sampleBytes(page);
  const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  const firstId = (await tabList(page)).find((tab) => tab.id !== secondId)!.id;
  await activateTab(page, firstId);

  await startSend(page, "Pause after the first chunk");
  await expect(lastAiBubble(page)).toContainText(PAUSE_REPLY_OPENING);
  const afterFirstChunk = (await lastAiBubble(page).textContent()) ?? "";

  // Start typing the next message while the reply is still streaming.
  await composerInput(page).fill("half-typed follow-up");

  // Wait for a later chunk to land: this is the moment that used to wipe the
  // draft, because every chunk re-mirrors the session into the composer.
  await expect
    .poll(async () => ((await lastAiBubble(page).textContent()) ?? "").length, { timeout: 15_000 })
    .toBeGreaterThan(afterFirstChunk.length);
  await expect(composerInput(page)).toHaveValue("half-typed follow-up");

  // It is a per-document draft, so it also survives leaving and coming back.
  await activateTab(page, secondId);
  await expect(composerInput(page)).toHaveValue("");
  await activateTab(page, firstId);
  await expect(composerInput(page)).toHaveValue("half-typed follow-up");
});

test("a failed generation shows an error with Retry; retry fails again, and a new message clears it", async ({
  page,
}) => {
  await openApp(page);
  await loadFixture(page);

  await startSend(page, "Fail to respond");

  const alert = chatPanel(page).getByRole("alert");
  await expect(alert).toContainText(GENERATION_ERROR);
  await expect(sendButton(page)).toBeVisible();
  // A failure commits no assistant turn.
  await expect(chatPanel(page).locator('article[aria-label="AI"]')).toHaveCount(0);

  // Retry re-runs the same turn. The mock is stateless, so it fails again —
  // and it must not add a second copy of the user's question.
  await chatPanel(page).getByRole("button", { name: "Retry" }).click();
  await expect(chatPanel(page).getByRole("alert")).toContainText(GENERATION_ERROR);
  await expect(chatPanel(page).getByText("Fail to respond", { exact: true })).toHaveCount(1);

  // Sending something else from the error state clears the error.
  await sendAndSettle(page, "something answerable", 'Mock reply #2: you asked "something answerable"');
  await expect(chatPanel(page).getByRole("alert")).toHaveCount(0);
});

test("Send is disabled until there is a document and text, and becomes Stop while generating", async ({ page }) => {
  await openApp(page);

  // No document open: the composer accepts text but Send cannot submit.
  await expect(sendButton(page)).toBeDisabled();
  await composerInput(page).fill("typed with no document");
  await expect(sendButton(page)).toBeDisabled();

  await loadFixture(page);
  // Opening a document clears the no-document draft, so Send stays disabled...
  await expect(composerInput(page)).toHaveValue("");
  await expect(sendButton(page)).toBeDisabled();
  // ...until there is something to send.
  await composerInput(page).fill("now it can submit");
  await expect(sendButton(page)).toBeEnabled();

  // While generating, the same button is Stop — enabled even though the
  // composer is now empty.
  await composerInput(page).fill("Respond slowly");
  await sendButton(page).click();
  await expect(composerInput(page)).toHaveValue("");
  await expect(stopButton(page)).toBeEnabled();
  await stopButton(page).click();
  await expect(sendButton(page)).toBeDisabled();
});

test("a page citation navigates the PDF to its page, by click and by keyboard", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  await sendAndSettle(page, "Explain the current page", "Mock explanation:");
  const citation = chatPanel(page).getByRole("button", { name: "Go to page 2" });
  await expect(citation).toBeVisible();

  const expectedTop = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.page[data-page-number="2"]');
    return target ? Math.max(target.offsetTop - 20, 0) : 0;
  });
  expect(expectedTop).toBeGreaterThan(0);
  const containerTop = () =>
    page.evaluate(() => document.querySelector<HTMLElement>(".pdf-container")?.scrollTop ?? -1);

  // Click navigates.
  await citation.click();
  await expect.poll(containerTop).toBeGreaterThan(expectedTop - 5);

  // Back to the top, then do it from the keyboard alone.
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (container) container.scrollTop = 0;
  });
  await expect.poll(containerTop).toBeLessThan(5);

  await citation.focus();
  await expect(citation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(containerTop).toBeGreaterThan(expectedTop - 5);
});

test("the conversation stays pinned while streaming, unless the user scrolls up to read", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  // Build a conversation tall enough to scroll.
  for (let turn = 1; turn <= 8; turn += 1) {
    await sendAndSettle(page, `filler line ${turn}`, `Mock reply #${turn}:`);
  }
  await expect.poll(async () => (await conversationMetrics(page)).scrollHeight - (await conversationMetrics(page)).clientHeight).toBeGreaterThan(50);

  await startSend(page, "Pause after the first chunk");
  await expect(lastAiBubble(page)).toContainText(PAUSE_REPLY_OPENING);

  // Sending scrolled us to the bottom and the first chunk kept us there.
  const pinnedMetrics = await conversationMetrics(page);
  expect(pinnedMetrics.scrollHeight - pinnedMetrics.scrollTop - pinnedMetrics.clientHeight).toBeLessThanOrEqual(4);

  // Scroll up during the pause to read earlier turns.
  await chatPanel(page)
    .locator(".conversation")
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  await expect.poll(async () => (await conversationMetrics(page)).scrollTop).toBe(0);
  const lengthWhileReading = ((await lastAiBubble(page).textContent()) ?? "").length;

  // The next chunk must not yank the viewport away from what we are reading.
  await expect
    .poll(async () => ((await lastAiBubble(page).textContent()) ?? "").length, { timeout: 15_000 })
    .toBeGreaterThan(lengthWhileReading);
  expect((await conversationMetrics(page)).scrollTop).toBe(0);

  // Scrolling back to the bottom re-engages pinning for later chunks.
  await chatPanel(page)
    .locator(".conversation")
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  const lengthAtBottom = ((await lastAiBubble(page).textContent()) ?? "").length;
  await expect
    .poll(async () => ((await lastAiBubble(page).textContent()) ?? "").length, { timeout: 15_000 })
    .toBeGreaterThan(lengthAtBottom);
  const repinned = await conversationMetrics(page);
  expect(repinned.scrollHeight - repinned.scrollTop - repinned.clientHeight).toBeLessThanOrEqual(4);
});

test("a generation running in one Document Tab never leaks into another", async ({ page }) => {
  await openApp(page);
  await loadFixture(page); // tab 1
  const bytes = await sampleBytes(page);
  const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  const firstId = (await tabList(page)).find((tab) => tab.id !== secondId)!.id;

  await activateTab(page, firstId);
  await startSend(page, "Summarize this PDF");
  await expect(stopButton(page)).toBeVisible();

  // Switch away mid-generation: the other tab shows its own idle, empty
  // conversation — no Stop, no borrowed text.
  await activateTab(page, secondId);
  await expect(chatPanel(page).getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(chatPanel(page).getByText("Mock summary", { exact: false })).toHaveCount(0);

  // The reply landed in the tab that asked for it, and is there on return.
  await activateTab(page, firstId);
  await expect(chatPanel(page).getByText("Mock summary: the document introduces", { exact: false })).toBeVisible();
  await expect(sendButton(page)).toBeVisible();

  // Closing a tab mid-generation cancels its work and leaves the other alone.
  await startSend(page, "Respond slowly");
  await expect(stopButton(page)).toBeVisible();
  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), firstId);
  await waitForPageReady(page);
  await expect(chatPanel(page).getByText("Ask about this PDF", { exact: true })).toBeVisible();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(chatPanel(page).getByText("Mock slow reply", { exact: false })).toHaveCount(0);
});
