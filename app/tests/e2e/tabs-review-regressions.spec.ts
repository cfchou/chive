import { expect, test } from "@playwright/test";
import { createFreeText, loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

test.describe("Document Tab review regressions", () => {
  test("the empty document state accepts pointer input without a page error", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await openApp(page);
    await page.locator(".app").click({ position: { x: 10, y: 10 } });

    expect(pageErrors).toEqual([]);
  });

  test("Escape cancels a dirty Document Tab close even when an annotation is selected", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);
    await createFreeText(page, "unsaved edit");
    await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().selectedAnnotationKind)).toBe("freetext");

    await page.locator("[data-doc-tab]").nth(1).locator(".doc-tab-close").click();
    const modal = page.locator('.modal[role="dialog"]');
    await expect(modal).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(modal).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("the topbar shows the basename for a Windows Document Tab path", async ({ page }) => {
    await openApp(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );

    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "report.pdf", "C:\\docs\\report.pdf"), bytes);
    await waitForPageReady(page);

    await expect(page.locator(".topbar .file")).toHaveText("report.pdf");
  });

  test("cancelling a Document Tab drag clears its drag styling", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);

    const firstTab = page.locator("[data-doc-tab]").first();
    const firstTabButton = firstTab.locator(".doc-tab-main");
    const box = await firstTabButton.boundingBox();
    if (!box) throw new Error("Document Tab has no bounding box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2);
    await expect(firstTab).toHaveClass(/is-dragging/);
    await firstTabButton.dispatchEvent("pointercancel");

    await expect(firstTab).not.toHaveClass(/is-dragging/);
    await page.mouse.up();
  });

  test("vertical pointer jitter selects an inactive Document Tab without starting reordering", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);

    const tabs = page.locator("[data-doc-tab]");
    const inactiveTab = tabs.first();
    const inactiveButton = inactiveTab.locator(".doc-tab-main");
    await expect(inactiveButton).toHaveAttribute("aria-selected", "false");
    const orderBefore = await tabs.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-doc-tab")));
    const box = await inactiveButton.boundingBox();
    if (!box) throw new Error("Inactive Document Tab has no bounding box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 16);
    await expect(inactiveTab).not.toHaveClass(/is-dragging/);
    await page.mouse.up();

    expect(await tabs.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-doc-tab")))).toEqual(orderBefore);
    await expect(inactiveButton).toHaveAttribute("aria-selected", "true");
  });
});
