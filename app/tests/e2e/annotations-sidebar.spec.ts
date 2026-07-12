import { expect, test } from "./coverage";
import {
  type AnnotationEntry,
  createFreeText,
  createHighlight,
  expectSidebarHasUsefulHighlight,
  loadFixture,
  saveAndReopen,
} from "./helpers/pdf-spike";
import { installNavigationSidebarHooks } from "./helpers/navigation-sidebar";

installNavigationSidebarHooks();

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

  const activated = await page.evaluate(() => {
    window.__pdfSpike!.setTool("ink");
    return window.__pdfSpike!.activateFirstAnnotationItem();
  });
  expect(activated).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => {
          const stats = window.__pdfSpike!.stats();
          return {
            activeTool: stats.activeTool,
            hasAnnotationFocusBox: Boolean(stats.annotationFocusBox),
            hasSelectedEditor: Boolean(document.querySelector(".annotationEditorLayer .selectedEditor")),
            selectedAnnotationKind: stats.selectedAnnotationKind,
            visibleEditorToolbars: stats.visibleEditorToolbars,
          };
        },
      ),
    )
    .toMatchObject({
      activeTool: "ink",
      hasAnnotationFocusBox: true,
      hasSelectedEditor: false,
      selectedAnnotationKind: null,
      visibleEditorToolbars: 0,
    });
});

test("text-editing a persisted free text keeps its sidebar sort position", async ({ page }) => {
  await loadFixture(page);

  const before = await page.evaluate(() => {
    type Entry = { page: number; kind: string; id: string; sortTop: number };
    const entries = (window.__pdfSpike!.annotationSidebarSummary() as Entry[]).filter(
      (entry) => entry.page === 2,
    );
    const freetext = entries.find((entry) => entry.kind === "freetext");
    if (!freetext) throw new Error("Missing persisted free text entry on page 2");
    return { kinds: entries.map((entry) => entry.kind), sortTop: freetext.sortTop };
  });

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageEl = document.querySelector<HTMLElement>('.page[data-page-number="2"]');
    if (!container || !pageEl) throw new Error("Missing page 2");
    container.scrollTop = pageEl.offsetTop + 100;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const annotation = document.querySelector<HTMLElement>('.page[data-page-number="2"] .freeTextAnnotation');
    if (!annotation) throw new Error("Missing persisted free text annotation on page 2");
    annotation.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
  const point = await page.evaluate(() => {
    const annotation = document.querySelector<HTMLElement>('.page[data-page-number="2"] .freeTextAnnotation');
    if (!annotation) throw new Error("Missing persisted free text annotation on page 2");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const internal = document.querySelector<HTMLElement>('.page[data-page-number="2"] .freeTextEditor .internal');
        return internal?.isContentEditable ?? false;
      }),
    )
    .toBe(true);

  // macOS Chromium's End key scrolls instead of moving the caret, so place
  // the caret at the end of the existing text explicitly.
  await page.evaluate(() => {
    const internal = document.querySelector<HTMLElement>('.page[data-page-number="2"] .freeTextEditor .internal');
    if (!internal) throw new Error("Missing free text editor content");
    internal.focus();
    const range = document.createRange();
    range.selectNodeContents(internal);
    range.collapse(false);
    const selection = getSelection();
    if (!selection) throw new Error("Missing selection");
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type("X");
  await page.keyboard.press("Enter");

  // A pure text edit must not move the annotation in the sidebar: once the
  // live stand-in replaces the persisted entry, it has to keep the persisted
  // entry's sort geometry.
  await expect
    .poll(() =>
      page.evaluate(() => {
        type Entry = { page: number; kind: string; id: string; sortTop: number };
        const entries = (window.__pdfSpike!.annotationSidebarSummary() as Entry[]).filter(
          (entry) => entry.page === 2,
        );
        const freetext = entries.find((entry) => entry.kind === "freetext");
        return freetext
          ? {
              isLive: freetext.id.startsWith("live:"),
              kinds: entries.map((entry) => entry.kind),
              sortTop: Math.round(freetext.sortTop),
            }
          : null;
      }),
    )
    .toEqual({ isLive: true, kinds: before.kinds, sortTop: Math.round(before.sortTop) });
});

test("annotation sidebar locate focus clears on blank PDF click and Escape", async ({ page }) => {
  await loadFixture(page);

  const hasVisibleAnnotationSelection = () =>
    page.evaluate(
      () =>
        Boolean(window.__pdfSpike!.stats().annotationFocusBox) ||
        Boolean(document.querySelector(".annotationEditorLayer .selectedEditor")),
    );

  const activateAndExpectFocus = async () => {
    const activated = await page.evaluate(() => window.__pdfSpike!.activateFirstAnnotationItem());
    expect(activated).toBe(true);
    await expect.poll(hasVisibleAnnotationSelection).toBe(true);
  };

  await activateAndExpectFocus();
  const blankPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing PDF container");
    (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen = false;
    container.addEventListener(
      "pointerdown",
      () => {
        (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen = true;
      },
      { capture: true, once: true },
    );
    const containerRect = container.getBoundingClientRect();
    const xCandidates = [containerRect.left + 20, containerRect.left + 80, containerRect.left + 160];
    const yCandidates = [containerRect.top + 20, containerRect.top + 80, containerRect.top + 160, containerRect.top + 240];
    for (const x of xCandidates) {
      for (const y of yCandidates) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (
          hit?.closest(".pdf-container") &&
          !hit.closest(".highlightAnnotation, .freeTextAnnotation, .inkAnnotation, .highlightEditor, .freeTextEditor, .inkEditor")
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("Missing clickable blank PDF container point");
  });
  await page.mouse.click(blankPoint.x, blankPoint.y);
  await expect.poll(() => page.evaluate(() => (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen)).toBe(true);
  await expect.poll(hasVisibleAnnotationSelection).toBe(false);

  await page.getByRole("tab", { name: "Annotations" }).click();
  await page.locator(".annotation-item").first().click();
  await expect.poll(hasVisibleAnnotationSelection).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.classList.contains("annotation-item");
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(hasVisibleAnnotationSelection).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.classList.contains("annotation-item");
      }),
    )
    .toBe(false);
});

test("annotation sidebar snippets survive repeated fixture loads", async ({ page }) => {
  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);

  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);
});

test("annotation sidebar locates each persisted ink row after editor mode changes", async ({ page }) => {
  await loadFixture(page);

  const result = await page.evaluate(async () => {
    type SidebarEntry = AnnotationEntry & {
      bounds: { top: number; bottom: number } | null;
      sourceId: string;
    };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const entries = () => window.__pdfSpike!.annotationSidebarSummary() as SidebarEntry[];
    const pageBounds = (entry: SidebarEntry) => {
      const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
      if (!pageElement || !entry.bounds) throw new Error(`Missing page bounds for ${entry.id}`);
      return {
        top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight,
        bottom: pageElement.offsetTop + entry.bounds.bottom * pageElement.offsetHeight,
      };
    };
    const selectedEditorBox = () => {
      const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
      const container = document.querySelector<HTMLElement>(".pdf-container");
      if (!editor || !container) return null;
      const editorRect = editor.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        top: editorRect.top - containerRect.top + container.scrollTop,
        bottom: editorRect.bottom - containerRect.top + container.scrollTop,
        borderStyle: getComputedStyle(editor).borderTopStyle,
      };
    };
    const focusBox = (entry: SidebarEntry) => {
      const stats = window.__pdfSpike!.stats();
      const box = stats.annotationFocusBox as { top: number; height: number } | null;
      const editorBox = selectedEditorBox();
      const effectiveBox = box
        ? {
            top: box.top,
            bottom: box.top + box.height,
            borderStyle: null,
          }
        : editorBox;
      if (!effectiveBox) throw new Error(`Missing focus target; stats=${JSON.stringify(stats)}`);
      return {
        top: effectiveBox.top,
        bottom: effectiveBox.bottom,
        activeTool: stats.activeTool,
        hasAnnotationFocusBox: Boolean(box),
        selectedAnnotationKind: stats.selectedAnnotationKind,
        selectedEditorType: stats.selectedEditorType,
        selectedEditorBorderStyle: effectiveBox.borderStyle,
        visibleEditorToolbars: stats.visibleEditorToolbars,
        status: stats.status,
        selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        expectedPersistedAnnotationKey: `${entry.page}:${entry.sourceId}`,
      };
    };
    const clickEntry = async (entry: SidebarEntry) => {
      const row = document.getElementById(`annotation-row-${entry.sourceId}`);
      if (!(row instanceof HTMLElement)) throw new Error(`Annotation row not found for ${entry.id}`);
      row.click();
      const expectedPersistedKey = `${entry.page}:${entry.sourceId}`;
      const expectedBounds = pageBounds(entry);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike!.stats();
        const box = stats.annotationFocusBox as { top: number; height: number } | null;
        if (
          stats.status === `Located ink on page ${entry.page}.` &&
          stats.activeTool === "ink" &&
          stats.selectedAnnotationKind === null &&
          stats.selectedEditorType === null &&
          stats.visibleEditorToolbars === 0 &&
          stats.selectedPersistedAnnotationKey === expectedPersistedKey &&
          box &&
          Math.abs(box.top - expectedBounds.top) < 30
        ) {
          break;
        }
        await sleep(150);
      }
      return focusBox(entry);
    };
    const runPair = async (pageNumber: number, firstIndex: number, secondIndex: number) => {
      await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
      await sleep(500);
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")]
        .find((button) => button.textContent?.trim() === "Annotations")
        ?.click();
      await sleep(300);
      const inks = entries().filter((entry) => entry.page === pageNumber && entry.kind === "ink");
      if (inks.length <= Math.max(firstIndex, secondIndex)) {
        throw new Error(`Expected enough page ${pageNumber} ink rows; entries=${JSON.stringify(inks)}`);
      }
      window.__pdfSpike!.setTool("ink");
      await sleep(500);
      return {
        pageNumber,
        pair: [firstIndex + 1, secondIndex + 1],
        firstInk: await clickEntry(inks[firstIndex]),
        secondInk: await clickEntry(inks[secondIndex]),
        firstExpected: pageBounds(inks[firstIndex]),
        secondExpected: pageBounds(inks[secondIndex]),
      };
    };
    return [await runPair(2, 0, 1), await runPair(2, 1, 2), await runPair(3, 0, 1)];
  });

  for (const pairResult of result) {
    expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
    expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
    expect(pairResult.firstInk.status, JSON.stringify(pairResult)).toBe(`Located ink on page ${pairResult.pageNumber}.`);
    expect(pairResult.firstInk.activeTool, JSON.stringify(pairResult)).toBe("ink");
    expect(pairResult.firstInk.hasAnnotationFocusBox, JSON.stringify(pairResult)).toBe(true);
    expect(pairResult.firstInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBeNull();
    expect(pairResult.firstInk.selectedEditorType, JSON.stringify(pairResult)).toBeNull();
    expect(pairResult.firstInk.visibleEditorToolbars, JSON.stringify(pairResult)).toBe(0);
    expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstInk.expectedPersistedAnnotationKey);
    expect(pairResult.secondInk.status, JSON.stringify(pairResult)).toBe(`Located ink on page ${pairResult.pageNumber}.`);
    expect(pairResult.secondInk.activeTool, JSON.stringify(pairResult)).toBe("ink");
    expect(pairResult.secondInk.hasAnnotationFocusBox, JSON.stringify(pairResult)).toBe(true);
    expect(pairResult.secondInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBeNull();
    expect(pairResult.secondInk.selectedEditorType, JSON.stringify(pairResult)).toBeNull();
    expect(pairResult.secondInk.visibleEditorToolbars, JSON.stringify(pairResult)).toBe(0);
    expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondInk.expectedPersistedAnnotationKey);
  }
});

test("direct re-click of selected editable annotation does not flash locate box", async ({ page }) => {
  await loadFixture(page);
  await page.getByRole("tab", { name: "Annotations" }).click();

  const selectedInk = await page.evaluate(async () => {
    const inkHighlightSourceIds = new Set(
      (await window.__pdfSpike!.annotationSummary())
        .flatMap((summary: { annotations?: { id?: unknown; it?: unknown; subtype?: unknown }[] }) => summary.annotations ?? [])
        .filter(
          (annotation: { id?: unknown; it?: unknown; subtype?: unknown }) =>
            annotation.subtype === "Ink" && annotation.it === "InkHighlight",
        )
        .map((annotation: { id?: unknown }) => String(annotation.id ?? ""))
        .filter(Boolean),
    );
    const entry = (window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[])
      .filter((candidate) => candidate.kind === "ink")
      .find((candidate) => !inkHighlightSourceIds.has(candidate.sourceId));
    if (!entry) throw new Error("Missing editable ink row");
    const activated = await window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId);
    if (!activated) throw new Error(`Could not activate editable ink ${entry.sourceId}`);
    return { expectedPersistedAnnotationKey: `${entry.page}:${entry.sourceId}`, sourceId: entry.sourceId };
  });

  await expect
    .poll(() =>
      page.evaluate((expectedPersistedAnnotationKey) => {
        const stats = window.__pdfSpike!.stats();
        const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
        return {
          annotationFocusBox: stats.annotationFocusBox,
          borderStyle: editor ? getComputedStyle(editor).borderTopStyle : null,
          selectedAnnotationKind: stats.selectedAnnotationKind,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
          expectedPersistedAnnotationKey,
        };
      }, selectedInk.expectedPersistedAnnotationKey),
    )
    .toMatchObject({
      annotationFocusBox: null,
      borderStyle: "dashed",
      selectedAnnotationKind: "ink",
      selectedPersistedAnnotationKey: selectedInk.expectedPersistedAnnotationKey,
    });

  const point = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
    if (!editor) throw new Error("Missing selected editor");
    (window as Window & { __pdfSpikeSelectedEditorPointerSeen?: boolean }).__pdfSpikeSelectedEditorPointerSeen = false;
    editor.addEventListener(
      "pointerdown",
      () => {
        (window as Window & { __pdfSpikeSelectedEditorPointerSeen?: boolean }).__pdfSpikeSelectedEditorPointerSeen =
          true;
      },
      { once: true },
    );
    const rect = editor.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const afterPointerDown = await page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox);
  await page.mouse.up();

  expect(afterPointerDown).toBeNull();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __pdfSpikeSelectedEditorPointerSeen?: boolean }).__pdfSpikeSelectedEditorPointerSeen))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).toBeNull();
});

test("direct double-clicks on highlighter-intent ink annotations edit through the highlight path without toggling tools", async ({ page }) => {
  await loadFixture(page);

  const inkHighlights = await page.evaluate(async () => {
    return (await window.__pdfSpike!.annotationSummary())
      .flatMap((summary: { page?: unknown; annotations?: { id?: unknown; it?: unknown; subtype?: unknown }[] }) =>
        (summary.annotations ?? []).map((annotation) => ({
          id: String(annotation.id ?? ""),
          intent: annotation.it,
          page: Number(summary.page),
          subtype: annotation.subtype,
        })),
      )
      .filter(
        (annotation: { id: string; intent: unknown; page: number; subtype: unknown }) =>
          annotation.subtype === "Ink" && annotation.intent === "InkHighlight" && annotation.id,
      );
  });
  expect(inkHighlights.length).toBeGreaterThanOrEqual(2);
  const plainInks = await page.evaluate(async () => {
    return (await window.__pdfSpike!.annotationSummary())
      .flatMap((summary: { page?: unknown; annotations?: { id?: unknown; it?: unknown; subtype?: unknown }[] }) =>
        (summary.annotations ?? []).map((annotation) => ({
          id: String(annotation.id ?? ""),
          intent: annotation.it,
          page: Number(summary.page),
          subtype: annotation.subtype,
        })),
      )
      .filter(
        (annotation: { id: string; intent: unknown; page: number; subtype: unknown }) =>
          annotation.subtype === "Ink" && annotation.intent !== "InkHighlight" && annotation.id,
      );
  });
  expect(plainInks.length).toBeGreaterThanOrEqual(1);

  const doubleClickInkOnPage = async (entry: (typeof inkHighlights)[number]) => {
    const point = await page.evaluate(async ({ pageNumber, sourceId }) => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
      if (!pageElement) throw new Error(`Missing page ${pageNumber}`);
      const container = document.querySelector<HTMLElement>(".pdf-container");
      if (!container) throw new Error("Missing PDF container");
      container.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
      await sleep(400);

      const element = document.getElementById(`pdfjs_internal_id_${sourceId}`);
      if (!element) {
        throw new Error(`Missing ink annotation element ${sourceId}`);
      }
      let rect = element.getBoundingClientRect();
      for (let attempt = 0; (rect.width <= 0 || rect.height <= 0) && attempt < 10; attempt += 1) {
        await sleep(150);
        rect = element.getBoundingClientRect();
      }
      const entry = (window.__pdfSpike!.annotationSidebarSummary() as {
        bounds?: { left: number; right: number; top: number; bottom: number } | null;
        page: number;
        sourceId: string;
      }[]).find((candidate) => candidate.page === pageNumber && candidate.sourceId === sourceId);
      const pointFromBounds = () => {
        const pageRect = pageElement.getBoundingClientRect();
        return entry?.bounds && Number.isFinite(entry.bounds.left)
          ? {
              x: pageRect.left + ((entry.bounds.left + entry.bounds.right) / 2) * pageRect.width,
              y: pageRect.top + ((entry.bounds.top + entry.bounds.bottom) / 2) * pageRect.height,
            }
          : null;
      };
      let boundsPoint = pointFromBounds();
      if ((rect.width <= 0 || rect.height <= 0) && boundsPoint) {
        const containerRect = container.getBoundingClientRect();
        container.scrollTop += boundsPoint.y - (containerRect.top + containerRect.height / 2);
        await sleep(250);
        boundsPoint = pointFromBounds();
        if (!boundsPoint) throw new Error(`Missing bounds point for ${sourceId}`);
        return {
          hit: document.elementFromPoint(boundsPoint.x, boundsPoint.y)?.getAttribute("class") ?? "",
          usedBoundsFallback: true,
          ...boundsPoint,
        };
      }
      const containerRect = container.getBoundingClientRect();
      container.scrollTop += rect.top + rect.height / 2 - (containerRect.top + containerRect.height / 2);
      await sleep(250);
      rect = element.getBoundingClientRect();
      for (let attempt = 0; (rect.width <= 0 || rect.height <= 0) && attempt < 10; attempt += 1) {
        await sleep(150);
        rect = element.getBoundingClientRect();
      }
      const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
      const hitName = (hit: Element | null) => hit?.getAttribute("class") ?? "";
      for (const fx of fractions) {
        for (const fy of fractions) {
          const x = rect.left + rect.width * fx;
          const y = rect.top + rect.height * fy;
          const hit = document.elementFromPoint(x, y);
          const target = hit?.closest(`#${CSS.escape(element.id)}, .inkAnnotation, .highlightEditor`);
          if (target) {
            return { hit: target.id || hitName(target), usedBoundsFallback: false, x, y };
          }
        }
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const target = hit?.closest(`#${CSS.escape(element.id)}, .inkAnnotation, .highlightEditor`);
      return { hit: target ? target.id || hitName(target) : hitName(hit), usedBoundsFallback: false, x, y };
    }, { pageNumber: entry.page, sourceId: entry.id });

    const clickX = Number(point.x);
    const clickY = Number(point.y);
    if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) {
      throw new Error(`Invalid click point ${JSON.stringify(point)}`);
    }
    await page.mouse.dblclick(clickX, clickY);
    await page.waitForTimeout(900);
    return page.evaluate((sourceId) => {
      const stats = window.__pdfSpike!.stats();
      const container = document.querySelector<HTMLElement>(".pdf-container");
      const element = document.getElementById(`pdfjs_internal_id_${sourceId}`);
      if (!container || !element) {
        return { ...stats, visualShapeBox: null };
      }
      const shapeRects = [...element.querySelectorAll("path, polyline, polygon, line, rect, circle, ellipse")]
        .map((shape) => shape.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (shapeRects.length === 0) {
        return { ...stats, visualShapeBox: null };
      }
      const containerRect = container.getBoundingClientRect();
      const top = Math.min(...shapeRects.map((rect) => rect.top)) - containerRect.top + container.scrollTop - 3;
      const bottom = Math.max(...shapeRects.map((rect) => rect.bottom)) - containerRect.top + container.scrollTop + 3;
      return { ...stats, visualShapeBox: { top, height: bottom - top } };
    }, entry.id).then((stats) => ({ ...stats, clickPoint: point }));
  };

  const first = inkHighlights[0];
  const second = inkHighlights[1];
  const selectedPlainInkStats = await doubleClickInkOnPage(plainInks[0]);
  expect(selectedPlainInkStats.activeTool, JSON.stringify(selectedPlainInkStats)).toBe("none");
  expect(selectedPlainInkStats.selectedAnnotationKind, JSON.stringify(selectedPlainInkStats)).toBe("ink");

  const firstStats = await doubleClickInkOnPage(first);
  expect(firstStats.status, JSON.stringify(firstStats)).toBe("Selected highlight. Change color or delete it, then save.");
  expect(firstStats.activeTool, JSON.stringify(firstStats)).toBe("none");
  expect(firstStats.selectedAnnotationKind, JSON.stringify(firstStats)).toBe("highlight");
  expect(firstStats.selectedPersistedAnnotationKey, JSON.stringify(firstStats)).toBe(`${first.page}:${first.id}`);
  expect(firstStats.visibleEditorToolbars, JSON.stringify(firstStats)).toBe(1);

  await page.evaluate(() => {
    window.__pdfSpike!.recolorSelectedHighlight("green");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink-highlight-edit.pdf");
  await expect
    .poll(() =>
      page.evaluate(async ({ pageNumber, sourceId }) => {
        const summary = await window.__pdfSpike!.annotationSummary();
        return summary
          .find((entry: { page: number }) => entry.page === pageNumber)
          ?.annotations.find((annotation: { id?: string }) => annotation.id === sourceId);
      }, { pageNumber: first.page, sourceId: first.id }),
    )
    .toMatchObject({
      color: [124, 242, 170],
      it: "InkHighlight",
      subtype: "Ink",
    });

  const reselectedFirstStats = await doubleClickInkOnPage(first);
  expect(reselectedFirstStats.selectedAnnotationKind, JSON.stringify(reselectedFirstStats)).toBe("highlight");
  const deleted = await page.evaluate(() => window.__pdfSpike!.deleteSelected());
  expect(deleted).toBe(true);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink-highlight-edit.pdf");
  await expect
    .poll(() =>
      page.evaluate(async ({ pageNumber, sourceId }) => {
        const summary = await window.__pdfSpike!.annotationSummary();
        return Boolean(
          summary
            .find((entry: { page: number }) => entry.page === pageNumber)
            ?.annotations.some((annotation: { id?: string }) => annotation.id === sourceId),
        );
      }, { pageNumber: first.page, sourceId: first.id }),
    )
    .toBe(false);

  const secondStats = await doubleClickInkOnPage(second);
  expect(secondStats.status, JSON.stringify(secondStats)).toBe("Selected highlight. Change color or delete it, then save.");
  expect(secondStats.activeTool, JSON.stringify(secondStats)).toBe("none");
  expect(secondStats.selectedAnnotationKind, JSON.stringify(secondStats)).toBe("highlight");
  expect(secondStats.selectedPersistedAnnotationKey, JSON.stringify(secondStats)).toBe(`${second.page}:${second.id}`);
  expect(secondStats.visibleEditorToolbars, JSON.stringify(secondStats)).toBe(1);
});

test("annotation sidebar stays synced across load, click, delete, edit, and create", async ({ page }) => {
  const result = await page.evaluate(async () => {
    type SidebarEntry = AnnotationEntry & { source: "live" | "pdf"; sortTop: number; sourceId: string };

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
    const textInsideFocusBox = (pageNumber: number) => {
      const box = document.querySelector(".annotation-focus-box");
      if (!(box instanceof HTMLElement)) return "";
      const boxRect = box.getBoundingClientRect();
      const chunks: string[] = [];
      const pdfPage = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!(pdfPage instanceof HTMLElement)) return "";
      {
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
        const row = document.getElementById(`annotation-row-${entry.sourceId}`);
        if (!(row instanceof HTMLElement)) throw new Error(`Could not find annotation row for ${entry.detail}`);
        row.click();
        const expectedTokens = significantTokens(entry.detail);
        let focusText = "";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await sleep(150);
          focusText = textInsideFocusBox(entry.page);
          const matchingTokens = expectedTokens.filter((token) => focusText.includes(token));
          if (matchingTokens.length >= Math.min(2, expectedTokens.length)) {
            break;
          }
          if (attempt === 19) {
            throw new Error(`Annotation row points to wrong content; expected=${entry.detail}; focus=${focusText}`);
          }
        }
      }
    };
    const clickEntryAndWait = async (predicate: (entry: SidebarEntry) => boolean, selectedKind: string) => {
      const entry = entries().find(predicate);
      if (!entry) throw new Error(`Annotation entry not found; entries=${JSON.stringify(entries())}`);
      const expectedPersistedKey = entry.source === "pdf" ? `${entry.page}:${entry.sourceId}` : null;
      const activated = await window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId);
      if (!activated) throw new Error(`Could not activate annotation ${entry.id}`);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike!.stats();
        if (
          stats.selectedAnnotationKind === selectedKind &&
          (!expectedPersistedKey || stats.selectedPersistedAnnotationKey === expectedPersistedKey)
        ) {
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
