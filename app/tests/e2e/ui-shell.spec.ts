import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Outline" })).toBeVisible();
});

// The workspace animates grid-template-columns for 240ms when sidebars
// dock/undock; measuring a tab mid-transition yields off-viewport coordinates.
async function stableBoundingBox(page: Page, tabName: string) {
  const tab = page.getByRole("tab", { name: tabName });
  let previous = await tab.boundingBox();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(60);
    const next = await tab.boundingBox();
    if (
      previous &&
      next &&
      Math.abs(next.x - previous.x) < 0.5 &&
      Math.abs(next.y - previous.y) < 0.5
    ) {
      return next;
    }
    previous = next;
  }
  return previous;
}

async function dragTabTo(page: Page, tabName: string, targetX: number, targetY: number) {
  const box = await stableBoundingBox(page, tabName);
  if (!box) throw new Error(`tab ${tabName} is not visible`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      startX + ((targetX - startX) * step) / steps,
      startY + ((targetY - startY) * step) / steps,
    );
  }
  await page.mouse.up();
}

test("left sidebar renders at its default design width", async ({ page }) => {
  const width = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar[data-side="left"]');
    if (!sidebar) throw new Error("Missing left sidebar");
    return getComputedStyle(sidebar).width;
  });
  expect(width).toBe("367px");
});

test("sidebar tabs activate their panels", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByRole("tab", { name: "Bookmarks" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#panel-bookmarks")).toBeVisible();
  await expect(page.locator("#panel-outline")).toBeHidden();

  await page.getByRole("tab", { name: "Annotations" }).click();
  await expect(page.locator("#panel-annotations")).toBeVisible();
  await expect(page.locator("#panel-bookmarks")).toBeHidden();
});

test("dragging a tab docks it to the right sidebar", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport unavailable");
  await expect(page.locator("#content")).not.toHaveClass(/has-right/);

  await dragTabTo(page, "Annotations", viewport.width - 10, 90);

  await expect(page.locator('[data-tab-strip="right"] [data-tab="annotations"]')).toBeVisible();
  await expect(page.locator("#content")).toHaveClass(/has-right/);
  await expect(page.locator('.sidebar[data-side="right"] #panel-annotations')).toBeVisible();
  await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("dragging a docked tab back before Outline reorders the left strip", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport unavailable");
  await dragTabTo(page, "Annotations", viewport.width - 10, 90);
  await expect(page.locator('[data-tab-strip="right"] [data-tab="annotations"]')).toBeVisible();

  const outlineBox = await stableBoundingBox(page, "Outline");
  if (!outlineBox) throw new Error("outline tab is not visible");
  await dragTabTo(page, "Annotations", outlineBox.x + 2, outlineBox.y + outlineBox.height / 2);

  const leftTabs = page.locator('[data-tab-strip="left"] [role="tab"]');
  await expect(leftTabs).toHaveCount(3);
  await expect(leftTabs.nth(0)).toHaveAttribute("data-tab", "annotations");
  await expect(leftTabs.nth(1)).toHaveAttribute("data-tab", "outline");
  await expect(page.locator("#content")).not.toHaveClass(/has-right/);
});

test("collapsing a sidebar shows its edge reopen button", async ({ page }) => {
  await page.getByRole("button", { name: "Hide left sidebar" }).click();
  await expect(page.locator("#content")).toHaveClass(/no-left/);
  await expect(page.getByRole("tab", { name: "Outline" })).toBeHidden();

  const reopen = page.getByRole("button", { name: "Show left sidebar" });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.locator("#content")).not.toHaveClass(/no-left/);
  await expect(page.getByRole("tab", { name: "Outline" })).toBeVisible();
});

test("moving the active tab keeps a valid active tab on the source side", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport unavailable");

  await dragTabTo(page, "Outline", viewport.width - 10, 90);

  await expect(page.locator('[data-tab-strip="right"] [data-tab="outline"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-tab-strip="left"] [data-tab="bookmarks"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('.sidebar[data-side="right"] #panel-outline')).toBeVisible();
  await expect(page.locator('.sidebar[data-side="left"] #panel-bookmarks')).toBeVisible();
});
