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

test("header swatch click selects the global annotation color", async ({ page }) => {
  await expect(page.getByRole("radio", { name: "Yellow" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Green" }).click();

  await expect(page.getByRole("radio", { name: "Green" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Yellow" })).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => getStats(page)).toMatchObject({
    defaultHighlightColor: "green",
    defaultFreeTextColor: "green",
    defaultInkColor: "green",
  });
});

test("long-press opens the color plate and choosing rewrites the held slot", async ({ page }) => {
  const redSwatch = page.getByRole("radio", { name: "Red" });
  const box = await redSwatch.boundingBox();
  if (!box) throw new Error("red swatch not visible");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();

  const plate = page.getByRole("dialog", { name: "Annotation color plate" });
  await expect(plate).toBeVisible();
  await plate.getByRole("button", { name: "Cyan" }).click();

  await expect(plate).toBeHidden();
  await expect(page.getByRole("radio", { name: "Red" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Cyan" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => getStats(page)).toMatchObject({ defaultInkColor: "cyan" });
});

test("right-click opens the plate and clicking outside closes it", async ({ page }) => {
  await page.getByRole("radio", { name: "Purple" }).click({ button: "right" });

  const plate = page.getByRole("dialog", { name: "Annotation color plate" });
  await expect(plate).toBeVisible();

  const container = page.locator(".pdf-container");
  const containerBox = await container.boundingBox();
  if (!containerBox) throw new Error("pdf container not visible");
  await page.mouse.click(containerBox.x + containerBox.width / 2, containerBox.y + 40);

  await expect(plate).toBeHidden();
  await expect(page.getByRole("radio", { name: "Purple" })).toHaveAttribute("aria-checked", "false");
});
