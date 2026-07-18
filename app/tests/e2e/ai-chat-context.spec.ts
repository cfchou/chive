import { expect, test } from "./coverage";
import { loadFixture, openApp } from "./helpers/pdf-spike";

const HELPER_COPY =
  "The AI sees the included page text and the chips above — annotations and bookmarks are not included yet.";

test("an open PDF exposes its current-page context and explains what is not included", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);

  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await expect(panel.getByRole("button", { name: "Remove Page 1 context; use whole document" })).toBeVisible();
  await expect(panel.getByText(HELPER_COPY, { exact: true })).toBeVisible();
});

test("a dismissed page chip and the composer draft stay with their Document Session", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const pageChip = panel.getByRole("button", { name: "Remove Page 1 context; use whole document" });
  await pageChip.click();
  await panel.getByRole("textbox", { name: "Message AI Chat" }).fill("draft for first");

  const bytes = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
  const secondId = await page.evaluate((pdfBytes) => window.__pdfSpike!.tabs.openBytes(pdfBytes, "second.pdf"), bytes);
  const firstId = await page.evaluate(
    (otherId) => window.__pdfSpike!.tabs.list().find((tab: { id: string }) => tab.id !== otherId).id,
    secondId,
  );
  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);

  await expect(pageChip).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Message AI Chat" })).toHaveValue("draft for first");

  await panel.getByRole("textbox", { name: "Message AI Chat" }).fill("Describe the context");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText(/Mock context report:.*included=1.*current=none/)).toBeVisible();
});

test("closing the active Document Tab clears its selected-text context", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  const bytes = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
  const secondId = await page.evaluate(
    (pdfBytes) => window.__pdfSpike!.tabs.openBytes(pdfBytes, "second.pdf"),
    bytes,
  );
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const visibleTextLayer = page.locator('.pdf-container:visible .page[data-page-number="1"] .textLayer');
  await expect(visibleTextLayer).toBeVisible();
  await visibleTextLayer.evaluate((textLayer) => {
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!(textNode instanceof Text) || !textNode.data.length) throw new Error("Page 1 has no selectable text");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.data.length));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await expect(panel.getByRole("button", { name: "Remove Selection context; use whole document" })).toBeVisible();

  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), secondId);

  await expect(panel.getByRole("button", { name: "Remove Selection context; use whole document" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: "Message AI Chat" }).fill("Explain the selection");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Mock selection reply: no selection context.", { exact: true })).toBeVisible();
});

test("selected PDF text becomes citable context and clears when the selection collapses", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const input = panel.getByRole("textbox", { name: "Message AI Chat" });
  const pageTwo = page.locator('.pdf-container:visible .page[data-page-number="2"]');
  await pageTwo.scrollIntoViewIfNeeded();
  await expect(panel.getByRole("button", { name: "Remove Page 2 context; use whole document" })).toBeVisible();
  await expect(pageTwo.locator(".textLayer")).toBeVisible();

  await pageTwo.locator(".textLayer").evaluate((textLayer) => {
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!(textNode instanceof Text) || !textNode.data.length) throw new Error("Page 2 has no selectable text");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.data.length));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await expect(panel.getByRole("button", { name: "Remove Selection context; use whole document" })).toBeVisible();

  await input.fill("Explain the selection");
  await expect(panel.getByRole("button", { name: "Remove Selection context; use whole document" })).toBeVisible();
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Mock selection reply: the selection on page 2 is noted.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Go to page 2" })).toBeVisible();

  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await expect(panel.getByRole("button", { name: "Remove Selection context; use whole document" })).toHaveCount(0);
  await input.fill("Explain the selection");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Mock selection reply: no selection context.", { exact: true })).toBeVisible();
});

test("real extraction reports an image-only page and invented source ids never become citations", async ({ page }) => {
  await openApp(page);
  await loadFixture(page, "/mixed-text-image.pdf", "mixed-text-image.pdf");
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const input = panel.getByRole("textbox", { name: "Message AI Chat" });

  await input.fill("Describe the context");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText(/Mock context report:.*unavailable=2/)).toBeVisible();

  await input.fill("Cite a missing page");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Mock missing citation reply.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Go to page 9999/ })).toHaveCount(0);
});

test("editing and saving during generation does not change the frozen Context Snapshot", async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await panel.getByRole("textbox", { name: "Message AI Chat" }).fill("Pause after the first chunk");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.locator('article[aria-label="AI"]').last()).toContainText("Mock paused reply");

  const saved = await page.evaluate(async () => {
    const created = await window.__pdfSpike!.createPageFreeText("Added while generating", 1);
    await window.__pdfSpike!.saveToPath("/tmp/chive-ai-context-save.pdf");
    return created;
  });
  expect(saved).toBe(true);

  await expect(panel.locator('article[aria-label="AI"]').last()).toContainText(
    "Mock paused reply: the first fragment arrives quickly, then the remaining fragments trickle in one at a time.",
    { timeout: 30_000 },
  );
});
