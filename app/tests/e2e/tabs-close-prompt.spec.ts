import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createFreeText, loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

async function openTwoTabsWithDirtySecond(page: Page) {
  await openApp(page);
  await loadFixture(page); // clean tab 1
  const bytes = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
  await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  await createFreeText(page, "unsaved edit"); // makes the active (second) tab dirty
  await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
}

const closeActiveTab = (page: Page) =>
  page.locator("[data-doc-tab]").nth(1).locator(".doc-tab-close").click();
const modal = (page: Page) => page.locator('.modal[role="dialog"]');

test.describe("unsaved-changes close prompt", () => {
  test("closing a clean tab does not prompt", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);
    await closeActiveTab(page);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(1);
  });

  test("Cancel keeps the dirty tab open", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();
    await page.locator("[data-modal-cancel]").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("Don't Save discards and closes the tab", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();
    await page.locator("[data-modal-discard]").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(1);
  });

  test("a failed Save aborts the close and keeps the tab (D9)", async ({ page }) => {
    // In the browser build the Tauri save path is unavailable, so Save fails;
    // the tab must stay open rather than lose its edits.
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();
    await page.locator("[data-modal-save]").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("Ctrl+Tab cycles the active Document Tab", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const bytes = await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
    );
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
    await waitForPageReady(page);
    const tabs = page.locator("[data-doc-tab]");
    await expect(tabs.nth(1).locator(".doc-tab-main")).toHaveAttribute("aria-selected", "true");

    await page.evaluate(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true })),
    );
    await waitForPageReady(page);
    await expect(tabs.nth(0).locator(".doc-tab-main")).toHaveAttribute("aria-selected", "true");
  });
});
