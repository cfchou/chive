import { expect, test } from "./coverage";
import type { Page } from "@playwright/test";
import { loadFixture, openApp, waitForPageReady } from "./helpers/pdf-spike";

async function sampleBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
}

async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__pdfSpike!.tabs.list().map((tab: { label: string }) => tab.label),
  );
}

test.describe("document tab reorder and drag-and-drop", () => {
  test("dragging a tab to the end reorders the strip", async ({ page }) => {
    await openApp(page);
    await loadFixture(page); // sample.pdf
    const bytes = await sampleBytes(page);
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "a.pdf"), bytes);
    await waitForPageReady(page);
    await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "b.pdf"), bytes);
    await waitForPageReady(page);
    expect(await tabLabels(page)).toEqual(["sample.pdf", "a.pdf", "b.pdf"]);

    const tabs = page.locator("[data-doc-tab] .doc-tab-main");
    const firstBox = (await tabs.nth(0).boundingBox())!;
    const lastBox = (await tabs.nth(2).boundingBox())!;
    // Drag the first tab past the last tab's midpoint.
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastBox.x + lastBox.width - 4, lastBox.y + lastBox.height / 2, { steps: 8 });
    await page.mouse.up();

    expect(await tabLabels(page)).toEqual(["a.pdf", "b.pdf", "sample.pdf"]);
  });

  test("dropping a PDF file opens it in a new tab", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    expect(await tabLabels(page)).toEqual(["sample.pdf"]);

    // Build the DragEvent in-page so dataTransfer.files carries the dropped file.
    await page.evaluate(async () => {
      const dt = new DataTransfer();
      const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
      dt.items.add(new File([bytes], "dropped.pdf", { type: "application/pdf" }));
      const app = document.querySelector(".app")!;
      app.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      app.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => tabLabels(page)).toContain("dropped.pdf");
    expect((await tabLabels(page)).length).toBe(2);
  });
});
