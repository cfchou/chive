import { expect, test } from "./coverage";
import { collectPageErrors, getStats, loadFixture, openApp } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
  await loadFixture(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("free text mode opens the font-size popover and the slider updates the default", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Free text", exact: true }).click();

  const popover = page.getByRole("dialog", { name: "Free text settings" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("14px");

  await popover.getByRole("slider", { name: "Free text font size" }).fill("22");

  await expect(popover).toContainText("22px");
  await expect.poll(() => getStats(page)).toMatchObject({
    activeTool: "text",
    defaultFreeTextFontSize: 22,
  });
});

test("ink mode opens the thickness popover and the slider updates the default", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Ink", exact: true }).click();

  const popover = page.getByRole("dialog", { name: "Ink settings" });
  await expect(popover).toBeVisible();

  await popover.getByRole("slider", { name: "Ink thickness" }).fill("12");

  await expect(popover).toContainText("12px");
  await expect.poll(() => getStats(page)).toMatchObject({
    activeTool: "ink",
    defaultInkThickness: 12,
  });
});

test("popover closes on outside pointerdown and when the tool toggles off", async ({ page }) => {
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  const popover = page.getByRole("dialog", { name: "Free text settings" });
  await expect(popover).toBeVisible();

  const container = page.locator(".pdf-container");
  const containerBox = await container.boundingBox();
  if (!containerBox) throw new Error("pdf container not visible");
  // Click well away from the popover, which floats just below the toolbar.
  await page.mouse.click(containerBox.x + 60, containerBox.y + 300);
  await expect(popover).toBeHidden();

  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await expect(popover).toBeHidden();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "none" });
});
