import { expect, test } from "@playwright/test";
import { collectPageErrors, expectCanvasHasContent, getStats, loadFixture, openApp } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("loads sample PDF and renders a nonblank first page", async ({ page }) => {
  await loadFixture(page);
  await expectCanvasHasContent(page);

  const stats = await getStats(page);
  expect(stats.pages).toBeGreaterThan(0);
  expect(stats.textLayerSpans).toBeGreaterThan(0);
  expect(stats.annotationEditorLayers).toBeGreaterThan(0);
});

test("text selection geometry matches the rendered title size", async ({ page }) => {
  await loadFixture(page);

  const titleGeometry = await page.evaluate(() => {
    const span = [...document.querySelectorAll<HTMLElement>(".textLayer span")].find(
      (candidate) =>
        candidate.textContent?.includes("How Modern Browsers Work") &&
        candidate.getBoundingClientRect().width > 0,
    );
    if (!span) throw new Error("Title text-layer span not found");
    const rect = span.getBoundingClientRect();
    const textLayer = span.closest<HTMLElement>(".textLayer");
    return {
      width: rect.width,
      height: rect.height,
      fontSize: getComputedStyle(span).fontSize,
      minFontSize: textLayer ? getComputedStyle(textLayer).getPropertyValue("--min-font-size").trim() : "",
    };
  });

  expect(titleGeometry.fontSize).not.toBe("10000px");
  expect(Number(titleGeometry.minFontSize)).toBeLessThan(10);
  expect(titleGeometry.width).toBeGreaterThan(300);
  expect(titleGeometry.height).toBeGreaterThan(25);
});

test("zoom controls keep the PDF rendered", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();

  await expectCanvasHasContent(page);
  await expect(page.getByLabel("Zoom level")).toHaveText(/\d+%/);
});
