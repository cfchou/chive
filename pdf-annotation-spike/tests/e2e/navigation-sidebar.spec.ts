import { expect, test } from "@playwright/test";
import {
  type AnnotationEntry,
  collectPageErrors,
  createFreeText,
  createHighlight,
  expectSidebarHasUsefulHighlight,
  loadFixture,
  openApp,
  saveAndReopen,
} from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("outline sidebar navigates to page two", async ({ page }) => {
  await loadFixture(page);

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string }) => entry.title),
      ),
    )
    .toContain("1. Networking and Resource Loading");

  await page.getByRole("button", { name: "1. Networking and Resource Loading 2" }).click();
  await expect(page.getByText("Navigated to 1. Networking and Resource Loading.")).toBeVisible();
  await expect(page.getByText("Networking and resource loading pipeline")).toBeVisible();
});

test("annotation sidebar keeps useful highlight snippets after load and click", async ({ page }) => {
  await loadFixture(page);
  const selectedText = await createHighlight(page);
  await createFreeText(page, "Sidebar regression note");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-sidebar.pdf");

  await expectSidebarHasUsefulHighlight(page);

  const entries = (await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary())) as AnnotationEntry[];
  expect(entries.some((entry) => entry.kind === "freetext" && entry.detail.includes("Sidebar regression note"))).toBe(
    true,
  );
  expect(entries.some((entry) => entry.kind === "highlight" && entry.detail.includes(selectedText.split(/\s+/)[0]))).toBe(
    true,
  );

  const activated = await page.evaluate(() => window.__pdfSpike!.activateFirstAnnotationItem());
  expect(activated).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).not.toBeNull();
});

test("annotation sidebar snippets survive repeated fixture loads", async ({ page }) => {
  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);

  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);
});

test("annotation sidebar stays synced across load, click, delete, edit, and create", async ({ page }) => {
  const result = await page.evaluate(async () => {
    type SidebarEntry = AnnotationEntry & { source: "live" | "pdf"; sortTop: number };

    const tab = () =>
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")].find(
        (button) => button.textContent?.trim() === "Annotations",
      );
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const entries = () => window.__pdfSpike!.annotationSidebarSummary() as SidebarEntry[];
    const waitForUsefulHighlight = async (label: string) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const highlights = entries().filter((entry) => entry.kind === "highlight");
        const details = highlights.map((entry) => entry.detail);
        const hasPreciseSampleSnippets =
          details.some((detail) => detail.includes("browser's UI thread") && detail.includes("navigation request")) &&
          details.some((detail) => detail.includes("support preconnect and preload directives")) &&
          details.some((detail) => detail.includes("Chrome's CORB") || detail.includes("Cross-Origin Read Blocking"));
        const hasBroadSampleSnippet = details.some((detail) => detail.startsWith("ter a URL or click a link"));
        const hasPartialWordSnippet = details.some((detail) => detail.startsWith("e browser's") || detail.startsWith("ta (Chrome"));
        const allUseful =
          highlights.length >= 3 &&
          highlights.every(
            (entry) =>
              entry.detail &&
              !entry.detail.includes("Persisted PDF annotation") &&
              !entry.detail.includes("Unsaved/live highlight") &&
              /\s/.test(entry.detail.trim()) &&
              Number.isFinite(entry.sortTop) &&
              entry.sortTop < Number.MAX_SAFE_INTEGER,
          ) &&
          hasPreciseSampleSnippets &&
          !hasBroadSampleSnippet &&
          !hasPartialWordSnippet;
        if (allUseful) {
          return { label, highlights: details };
        }
        await sleep(150);
      }
      throw new Error(`${label}: not all highlight snippets useful after load; entries=${JSON.stringify(entries())}`);
    };
    const pageCounts = () => {
      const counts = new Map<number, { total: number; pdf: number; live: number; details: string[] }>();
      for (const entry of entries()) {
        const current = counts.get(entry.page) ?? { total: 0, pdf: 0, live: 0, details: [] };
        current.total += 1;
        current[entry.source] += 1;
        current.details.push(`${entry.source}:${entry.kind}:${entry.detail}`);
        counts.set(entry.page, current);
      }
      return Object.fromEntries(counts);
    };
    const assertPageHeadersMatchEntries = () => {
      const groups: { page: number; count: number }[] = [];
      for (const entry of entries()) {
        const last = groups[groups.length - 1];
        if (last?.page === entry.page) {
          last.count += 1;
        } else {
          groups.push({ page: entry.page, count: 1 });
        }
      }
      const headers = [...document.querySelectorAll(".annotation-page-header")].map((header) =>
        header.textContent?.replace(/\s+/g, " ").trim(),
      );
      const expected = groups.map((group) => `Page ${group.page} ${group.count} item${group.count === 1 ? "" : "s"}`);
      if (headers.length !== expected.length || !expected.every((text, index) => headers[index] === text)) {
        throw new Error(`Annotation page headers mismatch; expected=${JSON.stringify(expected)} actual=${JSON.stringify(headers)}`);
      }
    };
    const textInsideFocusBox = () => {
      const box = document.querySelector(".annotation-focus-box");
      if (!(box instanceof HTMLElement)) return "";
      const boxRect = box.getBoundingClientRect();
      const chunks: string[] = [];
      for (const pdfPage of document.querySelectorAll(".page")) {
        const walker = document.createTreeWalker(pdfPage.querySelector(".textLayer") ?? pdfPage, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          let firstOffset: number | null = null;
          let lastOffset: number | null = null;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (!text[offset]?.trim()) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            range.detach();
            if (
              rect.width > 0 &&
              rect.height > 0 &&
              boxRect.left - 2 < rect.right &&
              boxRect.right + 2 > rect.left &&
              boxRect.top - 2 < rect.bottom &&
              boxRect.bottom + 2 > rect.top
            ) {
              firstOffset ??= offset;
              lastOffset = offset + 1;
            }
          }
          if (firstOffset !== null && lastOffset !== null) {
            chunks.push(text.slice(firstOffset, lastOffset));
          }
        }
      }
      return chunks.join(" ").replace(/\s+/g, " ").trim();
    };
    const significantTokens = (text: string) =>
      text
        .replace(/[()".,;:—-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 5);
    const assertHighlightRowsPointToFocusedText = async () => {
      for (const entry of entries()) {
        if (entry.source !== "pdf" || entry.kind !== "highlight") continue;
        const rowIndex = entries().findIndex((candidate) => candidate.id === entry.id);
        const row = [...document.querySelectorAll(".annotation-item")][rowIndex];
        if (!(row instanceof HTMLElement)) throw new Error(`Could not find annotation row for ${entry.detail}`);
        row.click();
        await sleep(800);
        const focusText = textInsideFocusBox();
        const expectedTokens = significantTokens(entry.detail);
        const matchingTokens = expectedTokens.filter((token) => focusText.includes(token));
        if (matchingTokens.length < Math.min(2, expectedTokens.length)) {
          throw new Error(`Annotation row points to wrong content; expected=${entry.detail}; focus=${focusText}`);
        }
      }
    };
    const clickEntryAndWait = async (predicate: (entry: SidebarEntry) => boolean, selectedKind: string) => {
      const rowIndex = entries().findIndex(predicate);
      if (rowIndex < 0) throw new Error(`Annotation entry not found; entries=${JSON.stringify(entries())}`);
      const row = [...document.querySelectorAll(".annotation-item")][rowIndex];
      if (!(row instanceof HTMLElement)) throw new Error(`Annotation row not found at index ${rowIndex}`);
      row.click();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike!.stats();
        if (stats.selectedAnnotationKind === selectedKind) {
          return;
        }
        await sleep(150);
      }
      throw new Error(`Annotation row did not select ${selectedKind}; stats=${JSON.stringify(window.__pdfSpike!.stats())}`);
    };
    const selectTextOnPage = async (pageNumber: number) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const pdfPage = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
        if (pdfPage instanceof HTMLElement) {
          pdfPage.scrollIntoView({ block: "center" });
          await sleep(250);
          const walker = document.createTreeWalker(pdfPage.querySelector(".textLayer") ?? pdfPage, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent ?? "";
            const start = text.search(/\S/);
            if (start >= 0 && text.trim().length >= 30) {
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, Math.min(text.length, start + 30));
              const selection = document.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              return selection?.toString() ?? "";
            }
          }
        }
        await sleep(150);
      }
      throw new Error(`Could not select text on page ${pageNumber}`);
    };
    const createHighlightSelectionOnPage = async (pageNumber: number) => {
      await selectTextOnPage(pageNumber);
      const created = await window.__pdfSpike!.createSelectionHighlightInToolMode();
      if (!created) throw new Error(`Could not create highlight on page ${pageNumber}`);
      tab()?.click();
      await sleep(500);
    };

    tab()?.click();
    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    const first = await waitForUsefulHighlight("first load with annotations tab already selected");
    assertPageHeadersMatchEntries();
    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    const second = await waitForUsefulHighlight("second load with annotations tab still selected");
    assertPageHeadersMatchEntries();

    const beforeClick = entries();
    await window.__pdfSpike!.activateFirstAnnotationItem();
    await sleep(800);
    const afterClick = entries();
    const liveMirrors = afterClick.filter(
      (entry) => entry.source === "live" && beforeClick.some((before) => before.page === entry.page),
    );
    if (afterClick.length !== beforeClick.length || liveMirrors.length > 0) {
      throw new Error(`Clicking persisted annotation should not add live mirror rows; before=${beforeClick.length} after=${afterClick.length} live=${JSON.stringify(liveMirrors)}`);
    }
    await assertHighlightRowsPointToFocusedText();

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("delete sync sample reload");
    const beforeDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    if (!window.__pdfSpike!.deleteSelected()) throw new Error("Delete selected returned false");
    await sleep(300);
    const afterDeleteCounts = pageCounts();
    if (afterDeleteCounts[2]?.total !== beforeDeleteCounts[2]?.total - 1) {
      throw new Error(`Deleting page-2 highlight must reduce page-2 count; before=${JSON.stringify(beforeDeleteCounts)} after=${JSON.stringify(afterDeleteCounts)}`);
    }
    if (afterDeleteCounts[2]?.details.some((detail) => detail.includes("browser process"))) {
      throw new Error(`Deleted page-2 highlight still appears in sidebar; after=${JSON.stringify(afterDeleteCounts)}`);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("keyboard delete sync sample reload");
    const beforeKeyboardDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete", code: "Delete", bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const counts = pageCounts();
      if (counts[2]?.total === beforeKeyboardDeleteCounts[2]?.total - 1 && !counts[2]?.details.some((detail) => detail.includes("browser process"))) {
        break;
      }
      if (attempt === 29) {
        throw new Error(`Keyboard Delete must remove page-2 highlight from sidebar without tool switch; before=${JSON.stringify(beforeKeyboardDeleteCounts)} after=${JSON.stringify(counts)} stats=${JSON.stringify(window.__pdfSpike!.stats())}`);
      }
      await sleep(100);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("edit sync sample reload");
    const beforeEditCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "freetext", "freetext");
    const edited = await window.__pdfSpike!.editSelectedFreeText("Synced free text row");
    await sleep(1000);
    const afterEditCounts = pageCounts();
    if (!edited) throw new Error("Edit selected free text returned false");
    if (afterEditCounts[2]?.total !== beforeEditCounts[2]?.total) {
      throw new Error(`Editing page-2 free text must keep page-2 count stable; before=${JSON.stringify(beforeEditCounts)} after=${JSON.stringify(afterEditCounts)}`);
    }
    if (!afterEditCounts[2]?.details.some((detail) => detail.includes("Synced free text row"))) {
      throw new Error(`Edited free text does not appear in sidebar; after=${JSON.stringify(afterEditCounts)}`);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("create sync sample reload");
    const beforeNewHighlightCounts = pageCounts();
    await createHighlightSelectionOnPage(5);
    const afterNewHighlightCounts = pageCounts();
    if (afterNewHighlightCounts[2]?.total !== beforeNewHighlightCounts[2]?.total) {
      throw new Error(`Adding a page-5 highlight must not duplicate page-2 rows; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }
    if ((afterNewHighlightCounts[5]?.total ?? 0) !== (beforeNewHighlightCounts[5]?.total ?? 0) + 1) {
      throw new Error(`Expected one new page-5 annotation; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }

    return { first, second, afterClickCount: afterClick.length };
  });

  expect(result.afterClickCount).toBeGreaterThan(0);
});
