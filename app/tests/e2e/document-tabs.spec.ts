import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectCanvasHasContent, openApp, waitForPageReady } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("debug API opens and switches Document Tabs", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "alpha.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "beta.pdf");
    return [first, second];
  });

  await waitForPageReady(page);
  await expectCanvasHasContent(page);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "alpha.pdf", path: null, active: false },
    { id: secondId, label: "beta.pdf", path: null, active: true },
  ]);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "alpha.pdf", path: null, active: true },
    { id: secondId, label: "beta.pdf", path: null, active: false },
  ]);
  await expect(page.locator(".file")).toHaveText("alpha.pdf");
});

test("Document Tabs restore their own zoom when activated", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "zoom-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "zoom-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const secondZoom = await page.locator(".zoom-value").textContent();

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.getByRole("button", { name: "Zoom out" }).click();
  const firstZoom = await page.locator(".zoom-value").textContent();
  expect(firstZoom).not.toBe(secondZoom);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), secondId);
  await waitForPageReady(page);
  await expect(page.locator(".zoom-value")).toHaveText(secondZoom ?? "");
});

test("Document Tab Bar shows open documents and switches on click", async ({ page }) => {
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    await window.__pdfSpike!.tabs.openBytes(bytes, "bar-a.pdf");
    await window.__pdfSpike!.tabs.openBytes(bytes, "bar-b.pdf");
  });
  await waitForPageReady(page);

  const tabBar = page.getByRole("tablist", { name: "Open documents" });
  await expect(tabBar).toBeVisible();
  await expect(page.locator(".document-tab-bar")).toHaveAttribute("data-tauri-drag-region", "");
  await expect(page.getByRole("tab", { name: "bar-a.pdf" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "bar-b.pdf" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "bar-a.pdf" })).not.toHaveAttribute("data-tauri-drag-region", "");
  await expect(page.getByRole("button", { name: "Close bar-a.pdf" })).not.toHaveAttribute(
    "data-tauri-drag-region",
    "",
  );
  await expect(page.getByRole("button", { name: "Open PDF" })).not.toHaveAttribute("data-tauri-drag-region", "");

  await page.getByRole("tab", { name: "bar-a.pdf" }).click();
  await waitForPageReady(page);

  await expect(page.getByRole("tab", { name: "bar-a.pdf" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file")).toHaveText("bar-a.pdf");
});

test("window title follows the Active Document Tab", async ({ page }) => {
  await expect(page).toHaveTitle("Chive");
  await page.waitForFunction(() => Boolean(window.__pdfSpike?.tabs));
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "title-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "title-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await expect(page).toHaveTitle("title-b.pdf");

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await expect(page).toHaveTitle("title-a.pdf");

  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id, { force: true }), firstId);
  await expect(page).toHaveTitle("title-b.pdf");

  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id, { force: true }), secondId);
  await expect(page).toHaveTitle("Chive");
});

test("Document Tab Bar reorders tabs by dragging", async ({ page }) => {
  await page.waitForFunction(() => Boolean(window.__pdfSpike?.tabs));
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    await window.__pdfSpike!.tabs.openBytes(bytes, "drag-a.pdf");
    await window.__pdfSpike!.tabs.openBytes(bytes, "drag-b.pdf");
    await window.__pdfSpike!.tabs.openBytes(bytes, "drag-c.pdf");
  });
  await waitForPageReady(page);

  await expect
    .poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list().map((tab: { label: string }) => tab.label)))
    .toEqual(["drag-a.pdf", "drag-b.pdf", "drag-c.pdf"]);

  const firstBox = await page.getByRole("tab", { name: "drag-a.pdf" }).boundingBox();
  const thirdBox = await page.getByRole("tab", { name: "drag-c.pdf" }).boundingBox();
  if (!firstBox || !thirdBox) throw new Error("Document Tab boxes not found");

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 12, firstBox.y + firstBox.height / 2);
  await page.mouse.move(thirdBox.x + thirdBox.width + 8, thirdBox.y + thirdBox.height / 2);
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list().map((tab: { label: string }) => tab.label)))
    .toEqual(["drag-b.pdf", "drag-c.pdf", "drag-a.pdf"]);
});

test("Cmd+W closes the Active Document Tab and activates the neighbor", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "close-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "close-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "w",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await waitForPageReady(page);

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "close-a.pdf", active: true },
  ]);
  await expect(page.getByRole("tab", { name: "close-b.pdf" })).toHaveCount(0);
  await expect(page.locator(".file")).toHaveText("close-a.pdf");

  await page.evaluate((id) => window.__pdfSpike!.tabs.close(id), firstId);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toEqual([]);
  await expect(page.locator(".file")).toHaveText("No document");
  await expect(page.getByText("Open a PDF to start reading")).toBeVisible();
});

test("dirty Document Tab close prompts and Cancel keeps the tab open", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "dirty-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "dirty-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Unsaved close prompt"));
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "dirty-a.pdf", dirty: true, active: true },
    { id: secondId, label: "dirty-b.pdf", dirty: false, active: false },
  ]);

  await page.getByRole("button", { name: "Close dirty-a.pdf" }).click();
  await expect(page.getByText("Do you want to save the changes made to 'dirty-a.pdf'?")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toHaveLength(2);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Do you want to save the changes made to 'dirty-a.pdf'?")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toHaveLength(2);

  await page.getByRole("button", { name: "Close dirty-a.pdf" }).click();
  await page.getByRole("button", { name: "Don't Save" }).click();
  await waitForPageReady(page);

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: secondId, label: "dirty-b.pdf", active: true },
  ]);
  await expect(page.getByRole("tab", { name: "dirty-a.pdf" })).toHaveCount(0);
});

test("dirty Document Tab close Save failure keeps the tab open and dirty", async ({ page }) => {
  await page.waitForFunction(() => Boolean(window.__pdfSpike?.tabs));
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "save-fail-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "save-fail-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.evaluate(() => window.__pdfSpike!.saveToPath("/tmp/chive-save-failure-tab.pdf"));
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Save failure keeps dirty tab open"));

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "save-fail-a.pdf", dirty: true, active: true },
    { id: secondId, label: "save-fail-b.pdf", dirty: false, active: false },
  ]);

  await page.getByRole("button", { name: "Close save-fail-a.pdf" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Do you want to save the changes made to 'save-fail-a.pdf'?")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Save failed:");
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "save-fail-a.pdf", dirty: true, active: true },
    { id: secondId, label: "save-fail-b.pdf", dirty: false, active: false },
  ]);
});

test("window close request prompts dirty Document Tabs and Cancel aborts close", async ({ page }) => {
  await page.waitForFunction(() => Boolean(window.__pdfSpike?.tabs));
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "window-close-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "window-close-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Cancel window close keeps all tabs"));

  const closeResult = await page.evaluate(() => window.__pdfSpike!.requestWindowCloseForTest());

  expect(closeResult).toBe("prompted");
  await expect(page.getByText("Do you want to save the changes made to 'window-close-a.pdf'?")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "window-close-a.pdf", dirty: true, active: true },
    { id: secondId, label: "window-close-b.pdf", dirty: false, active: false },
  ]);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Do you want to save the changes made to 'window-close-a.pdf'?")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.tabs.list())).toMatchObject([
    { id: firstId, label: "window-close-a.pdf", dirty: true, active: true },
    { id: secondId, label: "window-close-b.pdf", dirty: false, active: false },
  ]);
});

test("Document Tabs keep undo history across switches", async ({ page }) => {
  const [firstId, secondId] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer());
    const first = await window.__pdfSpike!.tabs.openBytes(bytes, "undo-a.pdf");
    const second = await window.__pdfSpike!.tabs.openBytes(bytes, "undo-b.pdf");
    return [first, second];
  });
  await waitForPageReady(page);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Undo survives switch"));
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), secondId);
  await waitForPageReady(page);
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(0);
  await page.evaluate(() => window.__pdfSpike!.createPageFreeText("Other document text"));
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.evaluate((id) => window.__pdfSpike!.tabs.activate(id), firstId);
  await waitForPageReady(page);
  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(1);

  await page.keyboard.press("ControlOrMeta+Z");

  await expect.poll(() => liveFreeTextEntryCount(page)).toBe(0);
});

function liveFreeTextEntryCount(page: Page) {
  return page.evaluate(
    () =>
      window
        .__pdfSpike!.annotationSidebarSummary()
        .filter((entry: { kind: string; source: string }) => entry.kind === "freetext" && entry.source === "live")
        .length,
  );
}
