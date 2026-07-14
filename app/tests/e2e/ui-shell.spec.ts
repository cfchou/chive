import { expect, test, type Page } from "./coverage";

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

async function sidebarWidth(page: Page, side: "left" | "right") {
  return page.evaluate((sideArg) => {
    const sidebar = document.querySelector(`.sidebar[data-side="${sideArg}"]`);
    if (!sidebar) throw new Error(`Missing ${sideArg} sidebar`);
    return Math.round(sidebar.getBoundingClientRect().width);
  }, side);
}

test("left sidebar resizer drags the width and persists it across reload", async ({ page }) => {
  const resizer = page.locator('.sidebar[data-side="left"] .sidebar-resizer');
  await expect(resizer).toBeVisible();
  const box = await resizer.boundingBox();
  if (!box) throw new Error("resizer has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY, { steps: 6 });
  await page.mouse.up();
  expect(await sidebarWidth(page, "left")).toBe(427);

  await page.reload();
  await expect(page.getByRole("tab", { name: "Outline" })).toBeVisible();
  expect(await sidebarWidth(page, "left")).toBe(427);
});

test("sidebar resize clamps at the minimum width", async ({ page }) => {
  const resizer = page.locator('.sidebar[data-side="left"] .sidebar-resizer');
  const box = await resizer.boundingBox();
  if (!box) throw new Error("resizer has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(10, startY, { steps: 6 });
  await page.mouse.up();
  expect(await sidebarWidth(page, "left")).toBe(260);
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
  await expect(page.locator('[data-tab-strip="right"] [data-tab="ai-chat"]')).toBeVisible();
  await page.getByRole("tab", { name: "Annotations" }).click();

  await dragTabTo(page, "Annotations", viewport.width - 10, 90);

  await expect(page.locator('[data-tab-strip="right"] [data-tab="annotations"]')).toBeVisible();
  await expect(page.locator('[data-tab-strip="right"] [data-tab="ai-chat"]')).toBeVisible();
  await expect(page.locator("#content")).toHaveClass(/has-right/);
  await expect(page.locator('.sidebar[data-side="right"] #panel-annotations')).toBeVisible();
  await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("right-docked tabs anchor to the outer edge like the left strip does", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport unavailable");
  await dragTabTo(page, "Annotations", viewport.width - 10, 90);
  await expect(page.locator('[data-tab-strip="right"] [data-tab="annotations"]')).toBeVisible();
  await stableBoundingBox(page, "Annotations");

  const insets = await page.evaluate(() => {
    const measure = (side: string) => {
      const sidebar = document.querySelector(`.sidebar[data-side="${side}"]`);
      const tab = document.querySelector(
        side === "left"
          ? `[data-tab-strip="${side}"] [role="tab"]`
          : `[data-tab-strip="${side}"] [role="tab"]:last-child`,
      );
      if (!sidebar || !tab) throw new Error(`Missing sidebar or tab on ${side}`);
      const sidebarRect = sidebar.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      return side === "left"
        ? tabRect.left - sidebarRect.left
        : sidebarRect.right - tabRect.right;
    };
    return { left: measure("left"), right: measure("right") };
  });
  expect(Math.abs(insets.right - insets.left)).toBeLessThanOrEqual(1);
});

test("dragging a tab shows a hand ghost that follows the pointer and clears on drop", async ({ page }) => {
  const box = await stableBoundingBox(page, "Bookmarks");
  if (!box) throw new Error("Bookmarks tab is not visible");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const ghost = page.locator(".tab-drag-ghost");

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expect(ghost).toBeHidden();

  await page.mouse.move(startX + 120, startY + 160, { steps: 6 });
  await expect(ghost).toBeVisible();
  await expect(ghost.locator("svg")).toHaveCount(2);
  const nearFirst = await ghost.boundingBox();
  if (!nearFirst) throw new Error("ghost has no bounding box");
  expect(Math.hypot(nearFirst.x - (startX + 120), nearFirst.y - (startY + 160))).toBeLessThan(80);

  await page.mouse.move(startX + 240, startY + 120, { steps: 4 });
  const nearSecond = await ghost.boundingBox();
  if (!nearSecond) throw new Error("ghost has no bounding box after move");
  expect(Math.hypot(nearSecond.x - (startX + 240), nearSecond.y - (startY + 120))).toBeLessThan(80);

  await page.mouse.up();
  await expect(ghost).toBeHidden();
});

test("dragging into a hidden side's edge zone shows the dock cue until the pointer leaves", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport unavailable");
  await page.getByRole("button", { name: "Hide right sidebar" }).click();
  const box = await stableBoundingBox(page, "Annotations");
  if (!box) throw new Error("Annotations tab is not visible");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const cue = page.locator('.edge-dock-cue[data-side="right"]');

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 4 });
  await expect(cue).toBeHidden();

  await page.mouse.move(viewport.width - 10, viewport.height / 2, { steps: 4 });
  await expect(cue).toBeVisible();

  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 4 });
  await expect(cue).toBeHidden();

  await page.mouse.move(viewport.width - 10, viewport.height / 2, { steps: 4 });
  await expect(cue).toBeVisible();
  await page.mouse.up();
  await expect(cue).toBeHidden();
  await expect(page.locator('[data-tab-strip="right"] [data-tab="annotations"]')).toBeVisible();
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
  await expect(page.locator("#content")).toHaveClass(/has-right/);
  await expect(page.locator('[data-tab-strip="right"] [data-tab="ai-chat"]')).toBeVisible();
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

  await page.getByRole("button", { name: "Hide right sidebar" }).click();
  await expect(page.locator("#content")).not.toHaveClass(/has-right/);
  await expect(page.getByRole("tab", { name: "AI Chat" })).toBeHidden();
  await page.getByRole("button", { name: "Show right sidebar" }).click();
  await expect(page.locator("#content")).toHaveClass(/has-right/);
  await expect(page.getByRole("tab", { name: "AI Chat" })).toBeVisible();
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
