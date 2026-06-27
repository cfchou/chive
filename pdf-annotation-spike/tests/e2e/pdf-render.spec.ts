import { expect, test } from "@playwright/test";
import { expectCanvasHasContent, getStats, loadFixture, openApp } from "./helpers/pdf-spike";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("loads sample PDF and renders a nonblank first page", async ({ page }) => {
  await loadFixture(page);
  await expectCanvasHasContent(page);

  const stats = await getStats(page);
  expect(stats.pages).toBeGreaterThan(0);
  expect(stats.textLayerSpans).toBeGreaterThan(0);
  expect(stats.annotationEditorLayers).toBeGreaterThan(0);
});

test("zoom controls keep the PDF rendered", async ({ page }) => {
  await loadFixture(page);

  await page.evaluate(() => {
    const zoomGroup = [...document.querySelectorAll(".control-group")].find(
      (node) => node.querySelector(".label")?.textContent?.trim() === "Zoom",
    );
    const buttons = [...(zoomGroup?.querySelectorAll(".toolbar button") ?? [])] as HTMLButtonElement[];
    buttons[2]?.click();
    buttons[0]?.click();
    buttons[1]?.click();
  });

  await expectCanvasHasContent(page);
  await expect(page.getByText("Fit Width")).toBeVisible();
});

test("tool switching updates active tool state", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "highlight" });

  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "text" });

  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "ink" });
});
