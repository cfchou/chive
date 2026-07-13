import { expect, test } from "./coverage";
import type { Page } from "@playwright/test";
import {
  activateFirstAnnotationByKind,
  createFreeText,
  createInkStroke,
  loadFixture,
  openApp,
  waitForPageReady,
} from "./helpers/pdf-spike";

async function openTwoTabsWithDirtySecond(page: Page, dirtyText: string | null = "unsaved edit") {
  await openApp(page);
  await loadFixture(page); // clean tab 1
  const bytes = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())),
  );
  await page.evaluate((b) => window.__pdfSpike!.tabs.openBytes(b, "second.pdf"), bytes);
  await waitForPageReady(page);
  if (dirtyText) await createFreeText(page, dirtyText); // makes the active (second) tab dirty
  await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
}

const closeActiveTab = (page: Page) =>
  page.locator("[data-doc-tab]").nth(1).locator(".doc-tab-close").click();
const modal = (page: Page) => page.locator("dialog.modal");

async function prepareEditableFreeTextAtViewportCenter(page: Page) {
  const text = "Issue 11 editable free text";

  await page.waitForFunction(
    (expectedText) =>
      window.__pdfSpike?.annotationSidebarSummary().some(
        (candidate: { kind?: string; source?: string; sourceId?: string; detail?: string }) =>
          candidate.kind === "freetext" && candidate.source === "live" && candidate.detail?.includes(expectedText),
      ) ?? false,
    text,
  );

  const editorId = await page.evaluate(async (expectedText) => {
    const entry = window.__pdfSpike!
      .annotationSidebarSummary()
      .find((candidate: { kind?: string; source?: string; sourceId?: string; detail?: string }) =>
        candidate.kind === "freetext" && candidate.source === "live" && candidate.detail?.includes(expectedText),
      );
    if (!entry?.sourceId) throw new Error("Live free-text Annotation Sidebar Entry was not found");
    if (!(await window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId))) {
      throw new Error("Live free-text Annotation Sidebar Entry did not activate");
    }
    const editor = document.getElementById(entry.sourceId);
    if (!(editor instanceof HTMLElement)) throw new Error("Activated free-text editor DOM was not found");
    editor.focus();
    return entry.sourceId;
  }, text);

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const editor = document.getElementById(id);
        const internal = editor?.querySelector<HTMLElement>(".internal[contenteditable='true'], [contenteditable='true']");
        return {
          editable: internal?.isContentEditable ?? false,
          selected: editor?.classList.contains("selectedEditor") ?? false,
        };
      }, editorId),
    )
    .toEqual({ editable: true, selected: true });

  expect(
    await page.evaluate((id) => {
      const editor = document.getElementById(id);
      if (!(editor instanceof HTMLElement)) throw new Error("Editable free-text editor DOM was not found");
      const rect = editor.getBoundingClientRect();
      return window.__pdfSpike!.moveSelected(
        window.innerWidth / 2 - (rect.left + rect.width / 2),
        window.innerHeight / 2 - (rect.top + rect.height / 2),
      );
    }, editorId),
  ).toBe(true);

  return editorId;
}

test.describe("unsaved-changes close prompt", () => {
  test("an editable free-text Annotation cannot paint above its close prompt", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page, "Issue 11 editable free text");
    const editorId = await prepareEditableFreeTextAtViewportCenter(page);

    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();

    const result = await page.evaluate((id) => {
      const editor = document.getElementById(id);
      const prompt = document.querySelector<HTMLElement>("dialog.modal");
      if (!(editor instanceof HTMLElement) || !(prompt instanceof HTMLElement)) {
        throw new Error("Expected editable free-text editor and close prompt");
      }
      const editorRect = editor.getBoundingClientRect();
      const promptRect = prompt.getBoundingClientRect();
      const left = Math.max(editorRect.left, promptRect.left);
      const right = Math.min(editorRect.right, promptRect.right);
      const top = Math.max(editorRect.top, promptRect.top);
      const bottom = Math.min(editorRect.bottom, promptRect.bottom);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        hasOverlap: right > left && bottom > top,
        hitIsInsidePrompt: Boolean(hit && prompt.contains(hit)),
        hitIsInsidePdfEditorLayer: Boolean(hit?.closest(".annotationEditorLayer")),
        promptIsModalDialog: prompt instanceof HTMLDialogElement && prompt.open && prompt.matches(":modal"),
        saveButtonHasFocus: document.activeElement === prompt.querySelector("[data-modal-save]"),
      };
    }, editorId);

    expect(result.hasOverlap).toBe(true);
    expect(result.hitIsInsidePrompt).toBe(true);
    expect(result.hitIsInsidePdfEditorLayer).toBe(false);
    expect(result.promptIsModalDialog).toBe(true);
    expect(result.saveButtonHasFocus).toBe(true);

    await page.locator("[data-modal-cancel]").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("a selected ink Annotation cannot paint above its close prompt", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page, null);
    await createInkStroke(page);
    await activateFirstAnnotationByKind(page, "ink");
    const editorId = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>(".inkEditor.selectedEditor");
      if (!editor?.id) throw new Error("Selected ink editor DOM was not found");
      const rect = editor.getBoundingClientRect();
      if (!window.__pdfSpike!.moveSelected(window.innerWidth / 2 - (rect.left + rect.width / 2), window.innerHeight / 2 - (rect.top + rect.height / 2))) {
        throw new Error("Selected ink editor did not move");
      }
      return editor.id;
    });

    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();
    const result = await page.evaluate((id) => {
      const editor = document.getElementById(id);
      const prompt = document.querySelector<HTMLElement>("dialog.modal");
      if (!(editor instanceof HTMLElement) || !(prompt instanceof HTMLElement)) {
        throw new Error("Expected selected ink editor and close prompt");
      }
      const editorRect = editor.getBoundingClientRect();
      const promptRect = prompt.getBoundingClientRect();
      const left = Math.max(editorRect.left, promptRect.left);
      const right = Math.min(editorRect.right, promptRect.right);
      const top = Math.max(editorRect.top, promptRect.top);
      const bottom = Math.min(editorRect.bottom, promptRect.bottom);
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        hasOverlap: right > left && bottom > top,
        hitIsInsidePrompt: Boolean(hit && prompt.contains(hit)),
        hitIsInsidePdfEditorLayer: Boolean(hit?.closest(".annotationEditorLayer")),
      };
    }, editorId);

    expect(result.hasOverlap).toBe(true);
    expect(result.hitIsInsidePrompt).toBe(true);
    expect(result.hitIsInsidePdfEditorLayer).toBe(false);
    await page.locator("[data-modal-cancel]").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("Enter follows the Save path for an unsaved Document Tab close", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();

    await page.keyboard.press("Enter");

    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
  });

  test("a backdrop click does not dismiss an unsaved Document Tab close prompt", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);
    await expect(modal(page)).toBeVisible();

    await page.mouse.click(5, 5);

    await expect(modal(page)).toBeVisible();
    await expect(page.locator("[data-doc-tab]")).toHaveCount(2);
    await page.locator("[data-modal-cancel]").click();
  });

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

  test("the unsaved-changes dialog describes the affected Document Tab", async ({ page }) => {
    await openTwoTabsWithDirtySecond(page);
    await closeActiveTab(page);

    await expect(modal(page)).toHaveAttribute("aria-describedby", "unsaved-message");
    await expect(page.locator("#unsaved-message")).toHaveText("Do you want to save the changes made to “second.pdf”?" );
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

  test("Ctrl+W without an Active Document Tab leaves the browser shortcut alone", async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "w",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const dispatched = document.dispatchEvent(event);
      return { dispatched, defaultPrevented: event.defaultPrevented };
    });

    expect(result).toEqual({ dispatched: true, defaultPrevented: false });
  });
});
