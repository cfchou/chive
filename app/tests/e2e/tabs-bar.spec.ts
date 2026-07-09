import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createFreeText, loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

async function sampleBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
}

async function openSecondTab(page: Page, label = "second.pdf") {
  const bytes = await sampleBytes(page);
  await page.evaluate(([b, l]) => window.__pdfSpike!.tabs.openBytes(b as number[], l as string), [bytes, label] as const);
  await waitForPageReady(page);
}

test.describe("document tab bar", () => {
  test("renders one tab per open document and keeps the workspace filling below it", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(1);

    await openSecondTab(page, "the-second-document.pdf");
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);

    // The bar occupies its own row and the workspace still fills the rest.
    const layout = await page.evaluate(() => {
      const bar = document.querySelector(".doc-tab-bar")!.getBoundingClientRect();
      const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
      return { barHeight: Math.round(bar.height), barTop: Math.round(bar.top), workspaceBottom: Math.round(workspace.bottom), viewport: window.innerHeight };
    });
    expect(layout.barTop).toBe(0);
    expect(layout.barHeight).toBeGreaterThan(30);
    expect(layout.workspaceBottom).toBe(layout.viewport);

    await page.screenshot({ path: "test-results/document-tab-bar.png" });
  });

  test("clicking a tab switches the active document", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await openSecondTab(page);
    const tabs = page.locator("[data-doc-tab]");
    await expect(tabs.nth(1).locator(".doc-tab-main")).toHaveAttribute("aria-selected", "true");

    await tabs.nth(0).locator(".doc-tab-main").click();
    await waitForPageReady(page);
    await expect(tabs.nth(0).locator(".doc-tab-main")).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1).locator(".doc-tab-main")).toHaveAttribute("aria-selected", "false");
  });

  test("the close button removes a tab", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await openSecondTab(page);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);

    await page.locator("[data-doc-tab]").nth(1).locator(".doc-tab-close").click();
    await waitForPageReady(page);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(1);
  });

  test("a tab shows a dirty indicator once it has unsaved edits", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await expect(page.locator("[data-doc-tab] .dirty-dot")).toHaveCount(0);
    await createFreeText(page, "edit");
    await expect(page.locator("[data-doc-tab] .dirty-dot")).toHaveCount(1);
  });
});
