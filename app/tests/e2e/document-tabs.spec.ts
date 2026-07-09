import { expect, test } from "@playwright/test";
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
