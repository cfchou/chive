import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectCanvasHasContent, openApp, waitForPageReady } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("debug API opens and switches Document Tabs", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "alpha.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "beta.pdf");
    return [first, second];
  });

  await waitForPageReady(page);
  await expectCanvasHasContent(page);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "alpha.pdf", path: null, active: false },
    { id: secondId, label: "beta.pdf", path: null, active: true },
  ]);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "alpha.pdf", path: null, active: true },
    { id: secondId, label: "beta.pdf", path: null, active: false },
  ]);
  await expect(page.locator(".file")).toHaveText("alpha.pdf");
});

test("Document Tabs restore their own zoom when activated", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "zoom-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "zoom-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const secondZoom = await page.locator(".zoom-value").textContent();

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.getByRole("button", { name: "Zoom out" }).click();
  const firstZoom = await page.locator(".zoom-value").textContent();
  expect(firstZoom).not.toBe(secondZoom);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), secondId);
  await waitForPageReady(page);
  await expect(page.locator(".zoom-value")).toHaveText(secondZoom ?? "");
});

test("Document Tab Bar shows open documents and switches on click", async ({ page }) => {
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    await window.__pdfSpike!.tabs.openBytes(bytes, "bar-a.pdf");
    await window.__pdfSpike!.tabs.openBytes(bytes, "bar-b.pdf");
  });
  await waitForPageReady(page);

  const tabBar = page.getByRole("tablist", { name: "Open documents" });
  await expect(tabBar).toBeVisible();
  await expect(page.getByRole("tab", { name: "bar-a.pdf" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "bar-b.pdf" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "bar-a.pdf" }).click();
  await waitForPageReady(page);

  await expect(page.getByRole("tab", { name: "bar-a.pdf" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file")).toHaveText("bar-a.pdf");
});

test("Document Tabs keep undo history across switches", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "undo-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "undo-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Undo survives switch"));
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), secondId);
  await waitForPageReady(page);
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(0);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Other document text"));
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.keyboard.press("ControlOrMeta+Z");

  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(0);
});

function liveFreeTextEntryCount(page: Page) {
  return page.evaluate(
    () =>
      window
        .__pdfSpike!.annotationSidebarSummary()
        .filter((entry: { kind: string; source: string }) => entry.kind === "freetext" && entry.source === "live")
        .length,
  );
}
