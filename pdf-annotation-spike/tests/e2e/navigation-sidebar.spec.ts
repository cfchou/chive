import { expect, test } from "@playwright/test";
import {
  type AnnotationEntry,
  createFreeText,
  createHighlight,
  expectSidebarHasUsefulHighlight,
  loadFixture,
  openApp,
  saveAndReopen,
} from "./helpers/pdf-spike";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("outline sidebar navigates to page two", async ({ page }) => {
  await loadFixture(page, "/outline-sample.pdf", "outline-sample.pdf");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string }) => entry.title),
      ),
    )
    .toContain("Outline Page Two");

  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".outline-item")] as HTMLButtonElement[];
    buttons[1]?.click();
  });
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().currentPageNumber)).toBe(2);
});

test("annotation sidebar keeps useful highlight snippets after load and click", async ({ page }) => {
  await loadFixture(page);
  const selectedText = await createHighlight(page);
  await createFreeText(page, "Sidebar regression note");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-sidebar.pdf");

  await expectSidebarHasUsefulHighlight(page);

  const entries = (await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary())) as AnnotationEntry[];
  expect(entries.some((entry) => entry.kind === "freetext" && entry.detail.includes("Sidebar regression note"))).toBe(
    true,
  );
  expect(entries.some((entry) => entry.kind === "highlight" && entry.detail.includes(selectedText.split(/\s+/)[0]))).toBe(
    true,
  );

  const activated = await page.evaluate(() => window.__pdfSpike!.activateFirstAnnotationItem());
  expect(activated).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).not.toBeNull();
});

test("annotation sidebar snippets survive repeated fixture loads", async ({ page }) => {
  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);

  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);
});
