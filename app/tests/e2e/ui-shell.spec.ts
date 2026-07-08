import { expect, test } from "@playwright/test";

test("tab activation updates the active panel", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await expect(page.getByRole("tab", { name: "Bookmarks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Bookmarks" })).toBeVisible();
});

test("sidebar tabs and annotation tools render icons instead of placeholder letters", async ({ page }) => {
  await page.goto("/");

  for (const label of ["Outline", "Bookmarks", "Annotations"]) {
    const tab = page.getByRole("tab", { name: label });
    await expect(tab.locator("svg")).toHaveCount(1);
    await expect(tab).not.toHaveText(/^[OBA]$/);
  }

  for (const label of ["Highlight", "Free text", "Ink"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button).not.toHaveText(/^[HTI]$/);
  }
});

test("tab can be dragged to the right strip", async ({ page }) => {
  await page.goto("/");

  const tab = page.getByTestId("left-tab-bookmarks");
  const box = await tab.boundingBox();
  if (!box) throw new Error("Bookmarks tab has no bounding box");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(page.viewportSize()!.width - 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("right-sidebar")).toBeVisible();
  await expect(page.getByTestId("right-tab-bookmarks")).toHaveAttribute("aria-selected", "true");
});

test("sidebars collapse and reopen from the edge", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Collapse left sidebar" }).click();

  await expect(page.getByTestId("left-sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open left sidebar" })).toBeVisible();

  await page.getByRole("button", { name: "Open left sidebar" }).click();

  await expect(page.getByTestId("left-sidebar")).toBeVisible();
});
