import { expect, test } from "@playwright/test";
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

test("annotation mode buttons toggle the PDF.js editor mode", async ({ page }) => {
  const highlight = page.getByRole("button", { name: "Highlight", exact: true });
  const freeText = page.getByRole("button", { name: "Free text", exact: true });
  const ink = page.getByRole("button", { name: "Ink", exact: true });

  await highlight.click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "highlight" });
  await highlight.click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "none" });

  await freeText.click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "text" });

  await ink.click();
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "ink" });
});

test("color slot context menu rewrites the held slot and selects the color", async ({ page }) => {
  await page.getByRole("button", { name: "Red", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Annotation colors" })).toBeVisible();

  await page.getByRole("menu", { name: "Annotation colors" }).getByRole("button", { name: "Cyan" }).click();

  await expect(page.locator(".color-slot[aria-label='Cyan']")).toHaveCount(1);
  await expect(page.locator(".color-slot[aria-label='Cyan']")).toHaveClass(/active/);
  await expect(page.getByRole("menu", { name: "Annotation colors" })).toHaveCount(0);
});

test("free text settings popover changes the default font size", async ({ page }) => {
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Free text settings" })).toBeVisible();

  await page.getByLabel("Font size").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, 22);

  await expect.poll(() => getStats(page)).toMatchObject({ defaultFreeTextFontSize: 22 });
});

test("ink settings popover changes the default thickness", async ({ page }) => {
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Ink settings" })).toBeVisible();

  await page.getByLabel("Ink thickness").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, 12);

  await expect.poll(() => getStats(page)).toMatchObject({ defaultInkThickness: 12 });
});
