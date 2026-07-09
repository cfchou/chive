import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createFreeText, loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

// Bytes of the bundled sample, fetched in-page so we can open several tabs from
// the same source without needing Tauri file IO in the browser build.
async function sampleBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
}

async function freeTextCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      window
        .__pdfSpike!.annotationSidebarSummary()
        .filter((entry: { kind: string }) => entry.kind === "freetext").length,
  );
}

type TabSummary = { id: string; label: string; path: string | null; dirty: boolean; active: boolean };
async function tabList(page: Page): Promise<TabSummary[]> {
  return page.evaluate(() => window.__pdfSpike!.tabs.list());
}

test.describe("multi-document tabs", () => {
  test("keeps each tab's annotations and undo history across switches", async ({ page }) => {
    await openApp(page);
    await loadFixture(page); // tab 1 (path-less sample)
    const bytes = await sampleBytes(page);
    // Both tabs open the same sample, so each shows the same persisted-annotation
    // baseline; assert per-tab deltas on top of it.
    const base = await freeTextCount(page);

    const secondId = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);
    const tabs = await tabList(page);
    expect(tabs.length).toBe(2);
    const firstId = tabs.find((tab) => tab.id !== secondId)!.id;
    expect(tabs.find((tab) => tab.active)!.id).toBe(secondId);

    // Annotate the active (second) tab.
    await createFreeText(page, "second-note");
    await expect.poll(() => freeTextCount(page)).toBe(base + 1);

    // Switch to the first tab: it has no free text of its own yet.
    await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
    await waitForPageReady(page);
    await expect.poll(() => freeTextCount(page)).toBe(base);

    // Annotate the first tab.
    await createFreeText(page, "first-note");
    await expect.poll(() => freeTextCount(page)).toBe(base + 1);

    // Back to the second tab: its own annotation survived; the first's is absent.
    await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), secondId);
    await waitForPageReady(page);
    await expect.poll(() => freeTextCount(page)).toBe(base + 1);

    // Undo on the second tab removes its free text — its editor history survived
    // the round-trip through the first tab (the core D2 guarantee).
    await page.evaluate(() => window.__pdfSpike!.undo());
    await expect.poll(() => freeTextCount(page)).toBe(base);

    // The first tab still has its own annotation.
    await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
    await waitForPageReady(page);
    await expect.poll(() => freeTextCount(page)).toBe(base + 1);
  });

  test("dedupes by path and focuses the existing tab", async ({ page }) => {
    await openApp(page);
    const bytes = await sampleBytes(page);
    const a = await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "a.pdf", "/docs/a.pdf"), bytes);
    await waitForPageReady(page);
    const b = await page.evaluate((by) => window.__pdfSpike!.tabs.openBytes(by, "b.pdf", "/docs/b.pdf"), bytes);
    await waitForPageReady(page);
    expect((await tabList(page)).length).toBe(2);
    expect(b).not.toBe(a);

    // Reopening /docs/a.pdf focuses the existing tab instead of adding one (D4).
    const again = await page.evaluate((by) => window.__pdfSpike!.tabs.openBytes(by, "a.pdf", "/docs/a.pdf"), bytes);
    expect(again).toBe(a);
    const list = await tabList(page);
    expect(list.length).toBe(2);
    expect(list.find((tab) => tab.active)!.id).toBe(a);
  });

  test("closing the active tab activates a neighbor", async ({ page }) => {
    await openApp(page);
    const bytes = await sampleBytes(page);
    const a = await page.evaluate((by) => window.__pdfSpike!.tabs.openBytes(by, "a.pdf", "/docs/a.pdf"), bytes);
    await waitForPageReady(page);
    await page.evaluate((by) => window.__pdfSpike!.tabs.openBytes(by, "b.pdf", "/docs/b.pdf"), bytes);
    await waitForPageReady(page);

    const closed = await page.evaluate(
      () => window.__pdfSpike!.tabs.list().find((tab: TabSummary) => tab.active)!.id,
    );
    await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), closed);
    await waitForPageReady(page);
    const list = await tabList(page);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(a);
    expect(list[0].active).toBe(true);
  });
});
