import { expect, test, type Page } from "./coverage";
import { PNG } from "pngjs";
import { FREE_TEXT_MOVE_GRIP_INSET_PX, FREE_TEXT_MOVE_GRIP_SIZE_PX } from "../../src/lib/pdf/free-text-move";
import {
  activateAnnotationByKind,
  activateFirstAnnotationByKind,
  activateNthLiveHighlight,
  collectPageErrors,
  createFreeText,
  createHighlight,
  createInkStroke,
  expectNoVisibleAnnotationPopup,
  loadFixture,
  openApp,
  pageAnnotations,
  saveAndReopen,
} from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
  await loadFixture(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

type EditableFreeTextSnapshot = {
  editorId: string;
  freeTextEditorCount: number;
  internalText: string;
  isEditable: boolean;
  isFocused: boolean;
  isSelected: boolean;
  rect: { height: number; left: number; top: number; width: number };
};

async function editableFreeTextSnapshot(page: Page, expectedText?: string): Promise<EditableFreeTextSnapshot | null> {
  return page.evaluate((text) => {
    const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
    const internal = [...document.querySelectorAll<HTMLElement>(".freeTextEditor .internal")].find(
      (element) => element.isContentEditable && (!text || normalizeText(element.innerText).includes(text)),
    );
    const editor = internal?.closest<HTMLElement>(".freeTextEditor");
    if (!editor?.id || !internal) return null;
    const rect = editor.getBoundingClientRect();
    return {
      editorId: editor.id,
      freeTextEditorCount: document.querySelectorAll(".freeTextEditor").length,
      internalText: normalizeText(internal.innerText),
      isEditable: internal.isContentEditable,
      isFocused: internal.contains(document.activeElement),
      isSelected: editor.classList.contains("selectedEditor"),
      rect: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
    };
  }, expectedText);
}

async function selectedEditableFreeText(page: Page, expectedText?: string): Promise<EditableFreeTextSnapshot> {
  const snapshot = await editableFreeTextSnapshot(page, expectedText);
  if (!snapshot) throw new Error("Selected free-text editor in edit mode not found");
  return snapshot;
}

async function activeDocumentDirty(page: Page) {
  return page.evaluate(() => {
    const tab = window.__pdfSpike!.tabs.list().find((candidate: { active: boolean; dirty: boolean }) => candidate.active);
    if (!tab) throw new Error("Active Document Tab not found");
    return tab.dirty;
  });
}

async function enterNewFreeTextEditing(page: Page, text: string) {
  await createFreeText(page, text);
  await activateFirstAnnotationByKind(page, "freetext");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".freeTextEditor.selectedEditor, .freeTextEditor");
    if (!editor) throw new Error("Selected live free-text editor root not found");
    editor.focus();
  });
  await page.keyboard.press("Enter");
  await expect
    .poll(() => editableFreeTextSnapshot(page, text))
    .toMatchObject({ internalText: text, isEditable: true, isFocused: true, isSelected: true });
  return selectedEditableFreeText(page, text);
}

async function setZoomTo100Percent(page: Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const label = await page.locator(".zoom-value").innerText();
    if (label === "100%") return;
    const percent = Number.parseInt(label, 10);
    if (!Number.isFinite(percent)) throw new Error(`Unexpected zoom label: ${label}`);
    await page.getByRole("button", { name: percent > 100 ? "Zoom out" : "Zoom in" }).click();
  }
  await expect(page.locator(".zoom-value")).toHaveText("100%");
}

async function setZoomToIssue13Scale(page: Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const percent = Number.parseInt(await page.locator(".zoom-value").innerText(), 10);
    if (percent >= 180) break;
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  const zoomPercent = Number.parseInt(await page.locator(".zoom-value").innerText(), 10);
  expect(zoomPercent).toBeGreaterThanOrEqual(180);
  expect(zoomPercent).toBeLessThanOrEqual(190);
}

async function expectDeleteGlyphPaintedAndHitTested(page: Page, selector: string) {
  const deleteButton = page.locator(selector);
  await expect(deleteButton).toBeVisible();
  const screenshot = PNG.sync.read(await deleteButton.screenshot());
  const colorCounts = new Map<string, number>();
  for (let offset = 0; offset < screenshot.data.length; offset += 4) {
    const [red, green, blue, alpha] = screenshot.data.subarray(offset, offset + 4);
    if (alpha < 200) continue;
    const key = `${red},${green},${blue}`;
    colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
  }
  const background = [...colorCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (!background) throw new Error("Delete control screenshot had no opaque background pixels");
  const [backgroundRed, backgroundGreen, backgroundBlue] = background.split(",").map(Number);
  const glyphPixels: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < screenshot.height; y += 1) {
    for (let x = 0; x < screenshot.width; x += 1) {
      const offset = (y * screenshot.width + x) * 4;
      const [red, green, blue, alpha] = screenshot.data.subarray(offset, offset + 4);
      const contrast =
        Math.abs(red - backgroundRed) + Math.abs(green - backgroundGreen) + Math.abs(blue - backgroundBlue);
      if (alpha >= 200 && contrast > 120 && x >= 4 && x <= 23 && y >= 4 && y <= 23) {
        glyphPixels.push({ x, y });
      }
    }
  }
  expect(glyphPixels.length).toBeGreaterThan(30);
  expect(glyphPixels.length).toBeLessThan(200);

  const hitBounds = await deleteButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hits: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < window.innerHeight; y += 2) {
      for (let x = Math.max(0, Math.floor(rect.left) - 16); x <= Math.min(window.innerWidth, Math.ceil(rect.right) + 16); x += 2) {
        const hit = document.elementFromPoint(x, y);
        if (hit === button || button.contains(hit)) hits.push({ x, y });
      }
    }
    return {
      button: rect.toJSON(),
      hit: {
        bottom: Math.max(...hits.map(({ y }) => y)),
        left: Math.min(...hits.map(({ x }) => x)),
        right: Math.max(...hits.map(({ x }) => x)),
        top: Math.min(...hits.map(({ y }) => y)),
      },
      centerTargetsDelete:
        document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".deleteButton") ===
        button,
    };
  });
  expect(hitBounds.centerTargetsDelete).toBe(true);
  expect(hitBounds.hit.left).toBeGreaterThanOrEqual(Math.floor(hitBounds.button.left));
  expect(hitBounds.hit.right).toBeLessThanOrEqual(Math.ceil(hitBounds.button.right));
  expect(hitBounds.hit.top).toBeGreaterThanOrEqual(Math.floor(hitBounds.button.top));
  expect(hitBounds.hit.bottom).toBeLessThanOrEqual(Math.ceil(hitBounds.button.bottom));
}

function freeTextGripPoint(snapshot: EditableFreeTextSnapshot) {
  // The full grip is outside the editor's DOM box. Its event target is
  // therefore the PDF page/editor layer rather than the editable surface;
  // the central surface remains reserved for caret and text selection.
  const offset = FREE_TEXT_MOVE_GRIP_INSET_PX + FREE_TEXT_MOVE_GRIP_SIZE_PX / 2;
  return { x: Math.round(snapshot.rect.left + offset), y: Math.round(snapshot.rect.top + offset) };
}

async function dragFreeTextGrip(
  page: Page,
  snapshot: EditableFreeTextSnapshot,
  delta: { x: number; y: number },
) {
  const start = freeTextGripPoint(snapshot);
  await expect
    .poll(() =>
      page.evaluate(({ editorId, x, y }) => {
        return document.elementFromPoint(x, y)?.closest<HTMLElement>(".freeTextEditor")?.id !== editorId;
      }, { editorId: snapshot.editorId, ...start }),
    )
    .toBe(true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
  await page.mouse.up();
}

function expectMovedByClientDelta(
  before: EditableFreeTextSnapshot,
  after: EditableFreeTextSnapshot,
  delta: { x: number; y: number },
) {
  expect(after.rect.left - before.rect.left).toBeCloseTo(delta.x, 0);
  expect(after.rect.top - before.rect.top).toBeCloseTo(delta.y, 0);
}

test("creates, recolors, saves, reopens, and deletes a highlight", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Highlight").length;

  await createHighlight(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight.pdf");

  let annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "Highlight")).toHaveLength(baseline + 1);

  await activateFirstAnnotationByKind(page, "highlight");

  await page.evaluate(() => {
    window.__pdfSpike!.recolorSelectedHighlight("green");
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight.pdf");

  annotations = await pageAnnotations(page);
  expect(
    annotations.some((entry) => entry.subtype === "Highlight" && entry.color?.join(",") === "124,242,170"),
  ).toBe(true);

  await activateFirstAnnotationByKind(page, "highlight");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.deleteSelected()) {
      throw new Error("Delete selected highlight returned false");
    }
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight.pdf");

  annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "Highlight")).toHaveLength(baseline);
});

test("paints and hit-tests the persisted Highlight Annotation delete glyph inside its toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1643, height: 654 });
  await page.reload();
  await openApp(page);
  await loadFixture(page);

  await createHighlight(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-issue-13-highlight.pdf");

  await setZoomToIssue13Scale(page);

  const highlight = page.locator(".page[data-page-number='1'] .highlightAnnotation").last();
  const highlightRect = await highlight.boundingBox();
  if (!highlightRect) throw new Error("Persisted Highlight Annotation was not rendered");
  await page.mouse.dblclick(highlightRect.x + highlightRect.width / 2, highlightRect.y + highlightRect.height / 2);
  await expectDeleteGlyphPaintedAndHitTested(
    page,
    ".pdf-container:not([style*='display: none']) .highlightEditor.selectedEditor .editToolbar:not(.hidden) .deleteButton",
  );
});

test("keeps the Free Text Annotation delete glyph visible and clickable at a scrolled page edge", async ({ page }) => {
  await page.setViewportSize({ width: 1643, height: 654 });
  await page.reload();
  await openApp(page);
  await loadFixture(page);
  await createFreeText(page, "Issue 13 Free Text toolbar");
  await activateFirstAnnotationByKind(page, "freetext");
  await setZoomToIssue13Scale(page);
  const moved = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".freeTextEditor.selectedEditor");
    const pdfPage = editor?.closest<HTMLElement>(".page");
    if (!editor || !pdfPage) throw new Error("Selected Free Text Annotation editor was not rendered");
    const editorRect = editor.getBoundingClientRect();
    const pageRect = pdfPage.getBoundingClientRect();
    return window.__pdfSpike!.moveSelected(0, pageRect.top + 12 - editorRect.top);
  });
  expect(moved).toBe(true);
  const scrollTop = await page.evaluate(() => {
    const container = [...document.querySelectorAll<HTMLElement>(".pdf-container")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return getComputedStyle(candidate).display !== "none" && rect.width > 0 && rect.height > 0;
    });
    if (!container) throw new Error("Displayed Active Document Tab container not found");
    container.scrollTop = Math.min(20, container.scrollHeight - container.clientHeight);
    return container.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await expectDeleteGlyphPaintedAndHitTested(
    page,
    ".pdf-container:not([style*='display: none']) .freeTextEditor.selectedEditor .editToolbar:not(.hidden) .deleteButton",
  );
});

test("keeps the Ink Annotation delete glyph visible and clickable after zooming and scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1643, height: 654 });
  await page.reload();
  await openApp(page);
  await loadFixture(page);
  await createInkStroke(page);
  await activateFirstAnnotationByKind(page, "ink");
  await setZoomToIssue13Scale(page);
  const scrollTop = await page.evaluate(() => {
    const container = [...document.querySelectorAll<HTMLElement>(".pdf-container")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return getComputedStyle(candidate).display !== "none" && rect.width > 0 && rect.height > 0;
    });
    if (!container) throw new Error("Displayed Active Document Tab container not found");
    container.scrollTop = Math.min(250, container.scrollHeight - container.clientHeight);
    return container.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await expectDeleteGlyphPaintedAndHitTested(
    page,
    ".pdf-container:not([style*='display: none']) .inkEditor.selectedEditor .editToolbar:not(.hidden) .deleteButton",
  );
});

test("keeps multiple live highlights independently selectable and colored", async ({ page }) => {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const selectTextChunk = async (index: number) => {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const nodes: Node[] = [];
        for (const layer of document.querySelectorAll(".textLayer")) {
          const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent ?? "";
            if (text.trim().length >= 12) nodes.push(node);
          }
        }
        const node =
          nodes.find((candidate) => (candidate.textContent ?? "").trim().length >= 12 + index * 30) ??
          nodes[index] ??
          nodes[0];
        if (node?.textContent) {
          const text = node.textContent;
          const firstNonSpace = Math.max(0, text.search(/\S/));
          const start = Math.min(text.length - 2, firstNonSpace + index * 30);
          const end = Math.min(text.length, start + 24);
          node.parentElement?.scrollIntoView({ block: "center" });
          await sleep(200);
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          const selection = document.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
        await sleep(200);
      }
      throw new Error(`Selectable text chunk not found at index ${index}`);
    };
    const clickHighlight = (pointerId: number) => {
      // Mode buttons are icon-only in the official app; find by aria-label.
      const button = document.querySelector<HTMLElement>('button[aria-label="Highlight"]');
      if (!(button instanceof HTMLElement)) {
        throw new Error("Highlight button not found");
      }
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
      button.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    };

    await selectTextChunk(0);
    document.querySelector<HTMLElement>("[aria-label=\"Green\"]")?.click();
    clickHighlight(21);
    await sleep(400);
    window.__pdfSpike!.setTool("none");
    await sleep(200);

    await selectTextChunk(1);
    document.querySelector<HTMLElement>("[aria-label=\"Blue\"]")?.click();
    clickHighlight(22);
    await sleep(400);
    window.__pdfSpike!.setTool("none");
  });

  const liveHighlightColors = await page.evaluate(() =>
    window.__pdfSpike!
      .annotationSidebarSummary()
      .filter((entry: { kind: string; source: string }) => entry.kind === "highlight" && entry.source === "live")
      .map((entry: { color: string | number[] | null }) => entry.color),
  );
  expect(liveHighlightColors).toContain("#7cf2aa");
  expect(liveHighlightColors).toContain("#8ecbff");

  await activateNthLiveHighlight(page, 0);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("none");
});

test("highlighting selected text after ink mode creates only a highlight", async ({ page }) => {
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforeHighlights = before.filter((entry: { kind: string }) => entry.kind === "highlight").length;
  const beforeInk = before.filter((entry: { kind: string }) => entry.kind === "ink").length;
  await page.evaluate(() => {
    window.__pdfSpike!.setTool("ink");
    window.__pdfSpike!.selectFirstText();
  });

  await page.getByRole("button", { name: "Highlight", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(
        ({ previousHighlights, previousInk }) => {
          const entries = window.__pdfSpike!.annotationSidebarSummary();
          return {
            activeTool: window.__pdfSpike!.stats().activeTool,
            newHighlights:
              entries.filter((entry: { kind: string }) => entry.kind === "highlight").length - previousHighlights,
            newInk: entries.filter((entry: { kind: string }) => entry.kind === "ink").length - previousInk,
          };
        },
        { previousHighlights: beforeHighlights, previousInk: beforeInk },
      ),
    )
    .toEqual({ activeTool: "highlight", newHighlights: 1, newInk: 0 });
});

test("toolbar highlight creates an annotation from selected text", async ({ page }) => {
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforePageOneHighlights = before.filter(
    (entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1,
  ).length;
  const selected = await page.evaluate(() => window.__pdfSpike!.selectFirstText());
  expect(selected.trim().length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect(page.getByRole("button", { name: "Highlight", exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Highlight", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate((previousPageOneHighlights) => {
        const entries = window.__pdfSpike!.annotationSidebarSummary();
        return {
          activeTool: window.__pdfSpike!.stats().activeTool,
          newPageOneHighlights:
            entries.filter((entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1)
              .length - previousPageOneHighlights,
          selectedText: window.getSelection()?.toString() ?? "",
        };
      }, beforePageOneHighlights),
    )
    .toEqual({ activeTool: "highlight", newPageOneHighlights: 1, selectedText: "" });
});

test("highlight button ignores text that was deselected by clicking back into the PDF", async ({ page }) => {
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforePageOneHighlights = before.filter(
    (entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1,
  ).length;
  const titleBox = await page.evaluate(() => {
    const titleSpan = [...document.querySelectorAll<HTMLElement>(".textLayer span")].find(
      (span) =>
        span.textContent?.includes("How Modern Browsers Work") &&
        span.getBoundingClientRect().width > 0,
    );
    if (!titleSpan) throw new Error("Could not find selectable title text");
    const rect = titleSpan.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });

  const selected = await page.evaluate(() => window.__pdfSpike!.selectFirstText());
  expect(selected.trim().length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);

  await page.mouse.click(titleBox.left + 4, titleBox.top + titleBox.height + 42);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? "")).toBe("");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate((previousPageOneHighlights) => {
        const entries = window.__pdfSpike!.annotationSidebarSummary();
        return {
          activeTool: window.__pdfSpike!.stats().activeTool,
          newPageOneHighlights:
            entries.filter((entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1)
              .length - previousPageOneHighlights,
        };
      }, beforePageOneHighlights),
    )
    .toEqual({ activeTool: "highlight", newPageOneHighlights: 0 });
});

test("selected text is only consumed by the highlight tool", async ({ page }) => {
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforeHighlights = before.filter((entry: { kind: string }) => entry.kind === "highlight").length;
  const beforeFreeText = before.filter((entry: { kind: string }) => entry.kind === "freetext").length;
  const beforeInk = before.filter((entry: { kind: string }) => entry.kind === "ink").length;

  await page.evaluate(() => {
    window.__pdfSpike!.selectFirstText();
  });
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    window.__pdfSpike!.setTool("none");
    window.__pdfSpike!.selectFirstText();
  });
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  expect(after.filter((entry: { kind: string }) => entry.kind === "highlight")).toHaveLength(beforeHighlights);
  expect(after.filter((entry: { kind: string }) => entry.kind === "freetext")).toHaveLength(beforeFreeText);
  expect(after.filter((entry: { kind: string }) => entry.kind === "ink")).toHaveLength(beforeInk);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("text");
});

test("highlight mode does not create freehand highlights on blank page areas", async ({ page }) => {
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("highlight");

  const baseline = await page.evaluate(() => ({
    unsavedHighlights: window
      .__pdfSpike!.editorSummary()
      .filter(
        (editor: { editorType: string; annotationElementId: string | null }) =>
          editor.editorType === "highlight" && !editor.annotationElementId,
      ).length,
    annotationStorageSize: window.__pdfSpike!.stats().annotationStorageSize,
  }));
  const blankPoint = await page.evaluate(() => {
    const textLayer = document.querySelector<HTMLElement>(".page[data-page-number='1'] .textLayer");
    if (!textLayer) throw new Error("Page 1 text layer missing");
    const rect = textLayer.getBoundingClientRect();
    for (let y = rect.top + 40; y < rect.bottom - 40; y += 24) {
      for (let x = rect.left + 40; x < rect.right - 40; x += 24) {
        if (document.elementFromPoint(x, y) === textLayer) {
          return { x, y };
        }
      }
    }
    throw new Error("Could not find blank text-layer point");
  });

  await page.mouse.move(blankPoint.x, blankPoint.y);
  await page.mouse.down();
  await page.mouse.move(blankPoint.x + 140, blankPoint.y + 20, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    unsavedHighlights: window
      .__pdfSpike!.editorSummary()
      .filter(
        (editor: { editorType: string; annotationElementId: string | null }) =>
          editor.editorType === "highlight" && !editor.annotationElementId,
      ).length,
    annotationStorageSize: window.__pdfSpike!.stats().annotationStorageSize,
  }));
  expect(after).toEqual(baseline);
});

test("highlight toggles off with one click after creating a text highlight", async ({ page }) => {
  const highlightButton = page.getByRole("button", { name: "Highlight", exact: true });
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforePageOneHighlights = before.filter(
    (entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1,
  ).length;

  await highlightButton.click();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("highlight");

  const created = await page.evaluate(async () => ({
    selected: window.__pdfSpike!.selectFirstText(),
    created: await window.__pdfSpike!.createSelectionHighlightInToolMode(),
  }));
  expect(created.selected.trim().length).toBeGreaterThan(0);
  expect(created.created).toBe(true);

  await expect
    .poll(() =>
      page.evaluate((previousPageOneHighlights) => {
        const entries = window.__pdfSpike!.annotationSidebarSummary();
        return entries.filter(
          (entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1,
        ).length - previousPageOneHighlights;
      }, beforePageOneHighlights),
    )
    .toBe(1);

  await highlightButton.click();

  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("none");
});

test("creates, recolors, and deletes through highlight tool mode", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Highlight").length;

  await page.evaluate(() => {
    window.__pdfSpike!.selectFirstText();
  });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  // Rose lives on the color plate, not the default header slots: long-press /
  // right-click a slot to open the plate, choosing rewrites that slot.
  await page.getByRole("radio", { name: "Red" }).click({ button: "right" });
  await page.getByRole("button", { name: "Rose" }).click();
  await page.evaluate(async () => {
    const created = await window.__pdfSpike!.createSelectionHighlightInToolMode();
    if (!created) throw new Error("Highlight tool create helper returned false");
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight-tool.pdf");

  let annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "Highlight")).toHaveLength(baseline + 1);
  expect(annotations.some((entry) => entry.subtype === "Highlight" && entry.color?.join(",") === "255,182,222")).toBe(
    true,
  );

  await activateFirstAnnotationByKind(page, "highlight");
  await page.getByRole("radio", { name: "Yellow" }).click();
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight-tool.pdf");

  annotations = await pageAnnotations(page);
  expect(annotations.some((entry) => entry.subtype === "Highlight" && entry.color?.join(",") === "255,243,92")).toBe(
    true,
  );

  await activateFirstAnnotationByKind(page, "highlight");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.deleteSelected()) {
      throw new Error("Delete selected returned false for highlight-tool flow");
    }
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-highlight-tool.pdf");

  annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "Highlight")).toHaveLength(baseline);
});

test("creates, edits, moves, saves, and deletes free text", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "FreeText").length;

  await createFreeText(page, "Regression free text");
  await page.evaluate(async () => {
    const edited = await window.__pdfSpike!.editSelectedFreeText("Regression edited free text");
    if (!edited) throw new Error("Edit selected free text returned false");
    window.__pdfSpike!.recolorSelectedFreeText("blue");
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-freetext.pdf");

  let annotations = await pageAnnotations(page);
  const freeText = annotations.find((entry) =>
    entry.subtype === "FreeText" && (entry.textContent ?? []).join(" ").includes("Regression edited free text"),
  );
  expect(freeText).toBeTruthy();
  expect(annotations.filter((entry) => entry.subtype === "FreeText")).toHaveLength(baseline + 1);

  await activateFirstAnnotationByKind(page, "freetext");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.moveSelected(40, 30)) {
      throw new Error("Move selected free text returned false");
    }
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-freetext.pdf");

  annotations = await pageAnnotations(page);
  const movedFreeText = annotations.find((entry) =>
    entry.subtype === "FreeText" && (entry.textContent ?? []).join(" ").includes("Regression edited free text"),
  );
  expect(movedFreeText?.rect).toBeTruthy();
  expect(freeText?.rect).toBeTruthy();
  expect(
    Math.abs((movedFreeText!.rect![0] ?? 0) - (freeText!.rect![0] ?? 0)) > 1 ||
      Math.abs((movedFreeText!.rect![1] ?? 0) - (freeText!.rect![1] ?? 0)) > 1,
  ).toBe(true);
  expect(annotations.filter((entry) => entry.subtype === "FreeText")).toHaveLength(baseline + 1);

  await activateFirstAnnotationByKind(page, "freetext");
  const freeTextPoint = await page.evaluate(() => {
    const target = document.querySelector(".page[data-page-number=\"1\"] .freeTextEditor, .page[data-page-number=\"1\"] .freeTextAnnotation");
    if (!(target instanceof HTMLElement)) throw new Error("Free text target not found for hover test");
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.move(freeTextPoint.x, freeTextPoint.y);
  await page.waitForTimeout(500);
  await expectNoVisibleAnnotationPopup(page);

  await activateFirstAnnotationByKind(page, "freetext");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.deleteSelected()) {
      throw new Error("Delete selected free text returned false");
    }
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-freetext.pdf");

  annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "FreeText")).toHaveLength(baseline);
});

test("selected editable free text renders a full exterior upper-left move grip", async ({ page }) => {
  const editor = await enterNewFreeTextEditing(page, "Visible free-text move grip");
  const grip = await page.evaluate((editorId) => {
    const root = document.getElementById(editorId);
    if (!(root instanceof HTMLElement)) throw new Error("Selected free-text editor root not found");
    const style = getComputedStyle(root, "::after");
    const internal = root.querySelector<HTMLElement>(".internal[contenteditable='true'], [contenteditable='true']");
    if (!internal) throw new Error("Selected free-text editor content not found");
    const rootRect = root.getBoundingClientRect();
    const internalRect = internal.getBoundingClientRect();
    const left = rootRect.left + Number.parseFloat(style.left);
    const top = rootRect.top + Number.parseFloat(style.top);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    const center = { x: Math.round(left + width / 2), y: Math.round(top + height / 2) };
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopColor: style.borderTopColor,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      clipPath: style.clipPath,
      content: style.content,
      height: style.height,
      left: style.left,
      pointerEvents: style.pointerEvents,
      position: style.position,
      top: style.top,
      width: style.width,
      doesNotCoverEditableText: left + width <= internalRect.left && top + height <= internalRect.top,
      exteriorTarget: document.elementFromPoint(center.x, center.y)?.closest<HTMLElement>(".freeTextEditor")?.id !== root.id,
    };
  }, editor.editorId);
  expect(grip.content).toBe('""');
  expect(grip.height).toBe("14px");
  expect(grip.left).toBe("-14px");
  expect(grip.pointerEvents).toBe("none");
  expect(grip.position).toBe("absolute");
  expect(grip.top).toBe("-14px");
  expect(grip.width).toBe("14px");
  expect(grip.clipPath).toBe("none");
  expect(grip.borderTopStyle).toBe("solid");
  expect(grip.borderTopWidth).toBe("1px");
  expect(grip.borderTopColor).toBe("rgb(35, 135, 216)");
  expect(grip.backgroundImage).toContain("radial-gradient");
  expect(grip.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(grip.doesNotCoverEditableText).toBe(true);
  expect(grip.exteriorTarget).toBe(true);

  await page.emulateMedia({ forcedColors: "active" });
  await expect.poll(() => page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  const forcedColorsGrip = await page.evaluate((editorId) => {
    const root = document.getElementById(editorId);
    if (!(root instanceof HTMLElement)) throw new Error("Selected free-text editor root not found");
    const style = getComputedStyle(root, "::after");
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      height: style.height,
      width: style.width,
    };
  }, editor.editorId);
  expect(forcedColorsGrip.height).toBe("14px");
  expect(forcedColorsGrip.width).toBe("14px");
  expect(forcedColorsGrip.borderTopStyle).toBe("solid");
  expect(forcedColorsGrip.borderTopWidth).toBe("2px");
  expect(forcedColorsGrip.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(forcedColorsGrip.backgroundImage).toBe("none");
  expect(forcedColorsGrip.boxShadow).toBe("none");
});

test("free-text exterior grip stays visible and draggable at the upper-left page edge", async ({ page }) => {
  const initialText = "Upper-left page edge grip";
  const before = await enterNewFreeTextEditing(page, initialText);
  const edgeDelta = await page.evaluate(({ editorId, size }) => {
    const root = document.getElementById(editorId);
    const pageElement = root?.closest<HTMLElement>(".page");
    if (!(root instanceof HTMLElement) || !pageElement) throw new Error("Selected free-text page edge target not found");
    const rootRect = root.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const gap = size + 2;
    return {
      x: Math.round(pageRect.left + gap - rootRect.left),
      y: Math.round(pageRect.top + gap - rootRect.top),
    };
  }, { editorId: before.editorId, size: FREE_TEXT_MOVE_GRIP_SIZE_PX });

  await dragFreeTextGrip(page, before, edgeDelta);
  await expect
    .poll(() => editableFreeTextSnapshot(page, initialText))
    .toMatchObject({ editorId: before.editorId, internalText: initialText, isEditable: true, isFocused: true, isSelected: true });

  const atEdge = await page.evaluate((editorId) => {
    const root = document.getElementById(editorId);
    const pageElement = root?.closest<HTMLElement>(".page");
    if (!(root instanceof HTMLElement) || !pageElement) throw new Error("Selected free-text page edge target not found");
    const rootRect = root.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const style = getComputedStyle(root, "::after");
    const grip = {
      left: rootRect.left + Number.parseFloat(style.left),
      top: rootRect.top + Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
    const center = { x: Math.round(grip.left + grip.width / 2), y: Math.round(grip.top + grip.height / 2) };
    return {
      gripFullyWithinPage:
        grip.left >= pageRect.left &&
        grip.top >= pageRect.top &&
        grip.left + grip.width <= pageRect.right &&
        grip.top + grip.height <= pageRect.bottom,
      gripFullyWithinViewport:
        grip.left >= 0 && grip.top >= 0 && grip.left + grip.width <= innerWidth && grip.top + grip.height <= innerHeight,
      gripTargetsEditor: document.elementFromPoint(center.x, center.y)?.closest<HTMLElement>(".freeTextEditor")?.id === editorId,
      rootLeftGap: rootRect.left - pageRect.left,
      rootTopGap: rootRect.top - pageRect.top,
    };
  }, before.editorId);
  expect(atEdge.rootLeftGap).toBeGreaterThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX);
  expect(atEdge.rootLeftGap).toBeLessThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX + 4);
  expect(atEdge.rootTopGap).toBeGreaterThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX);
  expect(atEdge.rootTopGap).toBeLessThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX + 4);
  expect(atEdge.gripFullyWithinPage).toBe(true);
  expect(atEdge.gripFullyWithinViewport).toBe(true);
  expect(atEdge.gripTargetsEditor).toBe(false);

  const edgeSnapshot = await selectedEditableFreeText(page, initialText);
  const nudge = { x: 8, y: 8 };
  await dragFreeTextGrip(page, edgeSnapshot, nudge);
  await expect
    .poll(() => editableFreeTextSnapshot(page, initialText))
    .toMatchObject({ editorId: before.editorId, internalText: initialText, isEditable: true, isFocused: true, isSelected: true });
  expectMovedByClientDelta(edgeSnapshot, await selectedEditableFreeText(page, initialText), nudge);
});

test("moves an editable live free text from its grip at 100% without losing editing state", async ({ page }) => {
  await setZoomTo100Percent(page);
  const initialText = "Live grip move at 100%";
  const before = await enterNewFreeTextEditing(page, initialText);
  const delta = { x: 42, y: 28 };

  await dragFreeTextGrip(page, before, delta);

  await expect
    .poll(() => editableFreeTextSnapshot(page, initialText))
    .toMatchObject({ editorId: before.editorId, internalText: initialText, isEditable: true, isFocused: true, isSelected: true });
  const moved = await selectedEditableFreeText(page, initialText);
  expectMovedByClientDelta(before, moved, delta);
  expect(moved.freeTextEditorCount).toBe(before.freeTextEditorCount);

  await page.keyboard.type(" plus persisted text");
  await page.keyboard.press("Enter");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-live-grip-100.pdf");

  const saved = (await pageAnnotations(page)).filter(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("plus persisted text"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]?.rect).toBeTruthy();
  const savedGeometry = saved[0]?.rect;
  await saveAndReopen(page, "/tmp/pdfspike-playwright-live-grip-100.pdf");
  const reopened = (await pageAnnotations(page)).filter(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("plus persisted text"),
  );
  expect(reopened).toHaveLength(1);
  expect(reopened[0]?.rect).toEqual(savedGeometry);
});

test("moves an editable live free text from its grip at a non-default zoom without double scaling", async ({ page }) => {
  await setZoomTo100Percent(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".zoom-value")).not.toHaveText("100%");

  const initialText = "Live grip move after zoom";
  const before = await enterNewFreeTextEditing(page, initialText);
  const delta = { x: 38, y: 24 };
  await dragFreeTextGrip(page, before, delta);

  await expect
    .poll(() => editableFreeTextSnapshot(page, initialText))
    .toMatchObject({ editorId: before.editorId, internalText: initialText, isEditable: true, isFocused: true, isSelected: true });
  const moved = await selectedEditableFreeText(page, initialText);
  expectMovedByClientDelta(before, moved, delta);

  await page.keyboard.type(" plus persisted text");
  await page.keyboard.press("Enter");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-live-grip-zoom.pdf");

  const saved = (await pageAnnotations(page)).filter(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("plus persisted text"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]?.rect).toBeTruthy();
  const savedGeometry = saved[0]?.rect;
  await saveAndReopen(page, "/tmp/pdfspike-playwright-live-grip-zoom.pdf");
  const reopened = (await pageAnnotations(page)).filter(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("plus persisted text"),
  );
  expect(reopened).toHaveLength(1);
  expect(reopened[0]?.rect).toEqual(savedGeometry);
});

test("moves a persisted free text from its grip after converting it to a live editor", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((annotation) => annotation.subtype === "FreeText").length;
  const initialText = "Persisted grip move";
  await createFreeText(page, initialText);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-persisted-grip.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const originalPdfGeometry = (await pageAnnotations(page)).find(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes(initialText),
  )?.rect;
  expect(originalPdfGeometry).toBeTruthy();

  const point = await page.evaluate((text) => {
    const annotation = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")].at(-1);
    if (!annotation) throw new Error("Persisted free text annotation not found");
    if (!annotation.innerText.includes(text)) throw new Error("Newest persisted free text annotation has unexpected text");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, initialText);
  await page.mouse.dblclick(point.x, point.y);

  await expect
    .poll(() => editableFreeTextSnapshot(page))
    .toMatchObject({ isEditable: true, isFocused: true });
  const before = await selectedEditableFreeText(page);
  expect(before.internalText).toContain(initialText);
  const delta = { x: 36, y: 26 };
  await dragFreeTextGrip(page, before, delta);

  await expect
    .poll(() => editableFreeTextSnapshot(page))
    .toMatchObject({ editorId: before.editorId, isEditable: true, isFocused: true, isSelected: true });
  const moved = await selectedEditableFreeText(page);
  expectMovedByClientDelta(before, moved, delta);

  await page.keyboard.type(" and edited");
  await page.keyboard.press("Enter");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-persisted-grip.pdf");

  const saved = (await pageAnnotations(page)).filter(
    (annotation) => annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("and edited"),
  );
  expect(saved).toHaveLength(1);
  expect((await pageAnnotations(page)).filter((annotation) => annotation.subtype === "FreeText")).toHaveLength(baseline + 1);
  expect(saved[0]?.rect).toBeTruthy();
  expect(saved[0]?.rect).not.toEqual(originalPdfGeometry);
});

test("central free-text editing drag selects text without moving the annotation", async ({ page }) => {
  await createFreeText(page, "Central drag selects this editable free text without moving it");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-central-drag-guard.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const point = await page.evaluate(() => {
    const annotation = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")].at(-1);
    if (!annotation) throw new Error("Persisted free text annotation not found");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => editableFreeTextSnapshot(page)).toMatchObject({ isEditable: true, isFocused: true });
  const before = await selectedEditableFreeText(page);
  const drag = await page.evaluate(() => {
    const internal = [...document.querySelectorAll<HTMLElement>(".freeTextEditor .internal")].find(
      (element) => element.isContentEditable,
    );
    if (!internal) throw new Error("Editable free text content not found");
    const rect = internal.getBoundingClientRect();
    return {
      start: { x: Math.round(rect.left + rect.width * 0.2), y: Math.round(rect.top + rect.height / 2) },
      end: { x: Math.round(rect.left + rect.width * 0.8), y: Math.round(rect.top + rect.height / 2) },
    };
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 6 });
  await page.mouse.up();

  expect(await page.evaluate(() => document.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "")).not.toBe("");
  const after = await selectedEditableFreeText(page);
  expect(after.editorId).toBe(before.editorId);
  expect(after.rect.left).toBeCloseTo(before.rect.left, 0);
  expect(after.rect.top).toBeCloseTo(before.rect.top, 0);
});

test("sub-threshold free-text grip gesture does not move or commit", async ({ page }) => {
  await createFreeText(page, "Sub-threshold free-text grip guard");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-sub-threshold-guard.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const point = await page.evaluate(() => {
    const annotation = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")].at(-1);
    if (!annotation) throw new Error("Persisted free text annotation not found");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => editableFreeTextSnapshot(page)).toMatchObject({ isEditable: true, isFocused: true });
  const before = await selectedEditableFreeText(page);
  const grip = freeTextGripPoint(before);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 2, grip.y + 2);
  await page.mouse.up();

  const after = await selectedEditableFreeText(page);
  expect(after.editorId).toBe(before.editorId);
  expect(after.isEditable).toBe(true);
  expect(after.rect.left).toBeCloseTo(before.rect.left, 0);
  expect(after.rect.top).toBeCloseTo(before.rect.top, 0);
});

test("free-text grip pointercancel rolls back applied movement and preserves dirty state", async ({ page }) => {
  await createFreeText(page, "Pointercancel free-text grip guard");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-pointercancel-guard.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const point = await page.evaluate(() => {
    const annotation = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")].at(-1);
    if (!annotation) throw new Error("Persisted free text annotation not found");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => editableFreeTextSnapshot(page)).toMatchObject({ isEditable: true, isFocused: true });
  const before = await selectedEditableFreeText(page);
  expect(await activeDocumentDirty(page)).toBe(false);
  const grip = freeTextGripPoint(before);
  const delta = { x: 28, y: 20 };
  await page.evaluate(({ x, y, movement }) => {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error("Grip coordinate has no target");
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        composed: true,
        isPrimary: true,
        pointerId: 93,
        pointerType: "mouse",
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: x + movement.x,
        clientY: y + movement.y,
        composed: true,
        isPrimary: true,
        pointerId: 93,
        pointerType: "mouse",
      }),
    );
  }, { ...grip, movement: delta });

  await expect.poll(() => editableFreeTextSnapshot(page)).toMatchObject({
    editorId: before.editorId,
    internalText: before.internalText,
    isEditable: true,
    isFocused: true,
  });
  const moved = await selectedEditableFreeText(page);
  expectMovedByClientDelta(before, moved, delta);
  expect(await activeDocumentDirty(page)).toBe(true);

  await page.evaluate(({ x, y, movement }) => {
    window.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        clientX: x + movement.x,
        clientY: y + movement.y,
        composed: true,
        isPrimary: true,
        pointerId: 93,
        pointerType: "mouse",
      }),
    );
  }, { ...grip, movement: delta });

  const after = await selectedEditableFreeText(page);
  expect(after.editorId).toBe(before.editorId);
  expect(after.isEditable).toBe(true);
  expect(after.isFocused).toBe(true);
  expect(after.internalText).toBe(before.internalText);
  expect(after.rect.left).toBeCloseTo(before.rect.left, 0);
  expect(after.rect.top).toBeCloseTo(before.rect.top, 0);
  expect(await activeDocumentDirty(page)).toBe(false);

  await page.evaluate(({ x, y, movement }) => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: x + movement.x * 2,
        clientY: y + movement.y * 2,
        composed: true,
        isPrimary: true,
        pointerId: 93,
        pointerType: "mouse",
      }),
    );
  }, { ...grip, movement: delta });
  const afterStrayMove = await selectedEditableFreeText(page);
  expect(afterStrayMove.rect.left).toBeCloseTo(before.rect.left, 0);
  expect(afterStrayMove.rect.top).toBeCloseTo(before.rect.top, 0);

  expect(await page.evaluate(() => window.__pdfSpike!.moveSelected(1, 0))).toBe(true);
  const dirtyBeforeCancel = await selectedEditableFreeText(page);
  expect(await activeDocumentDirty(page)).toBe(true);
  const dirtyGrip = freeTextGripPoint(dirtyBeforeCancel);
  await page.evaluate(({ x, y, movement }) => {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error("Dirty grip coordinate has no target");
    const event = (type: string, clientX: number, clientY: number, buttons: number) =>
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons,
        clientX,
        clientY,
        composed: true,
        isPrimary: true,
        pointerId: 94,
        pointerType: "mouse",
      });
    target.dispatchEvent(event("pointerdown", x, y, 1));
    window.dispatchEvent(event("pointermove", x + movement.x, y + movement.y, 1));
    window.dispatchEvent(event("pointercancel", x + movement.x, y + movement.y, 0));
  }, { ...dirtyGrip, movement: delta });

  const dirtyAfterCancel = await selectedEditableFreeText(page);
  expect(dirtyAfterCancel.editorId).toBe(dirtyBeforeCancel.editorId);
  expect(dirtyAfterCancel.rect.left).toBeCloseTo(dirtyBeforeCancel.rect.left, 0);
  expect(dirtyAfterCancel.rect.top).toBeCloseTo(dirtyBeforeCancel.rect.top, 0);
  expect(await activeDocumentDirty(page)).toBe(true);
});

test("free text editing uses Enter to finish and Shift+Enter for a new line", async ({ page }) => {
  await createFreeText(page, "Keyboard free text");
  await activateFirstAnnotationByKind(page, "freetext");
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".freeTextEditor");
    if (!editor) throw new Error("Free text editor root missing");
    editor.focus();
  });

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>(".freeTextEditor .internal");
        return {
          activeInsideEditor: Boolean(editor?.contains(document.activeElement)),
          isEditable: editor?.isContentEditable ?? false,
        };
      }),
    )
    .toEqual({ activeInsideEditor: true, isEditable: true });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Line one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Line two");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>(".freeTextEditor .internal")?.innerText ?? ""),
    )
    .toContain("Line one\nLine two");

  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>(".freeTextEditor .internal");
        return {
          activeInsideEditor: Boolean(editor?.contains(document.activeElement)),
          isEditable: editor?.isContentEditable ?? false,
          text: editor?.innerText ?? "",
        };
      }),
    )
    .toEqual({ activeInsideEditor: false, isEditable: false, text: "Line one\nLine two" });
});

test("shift+enter line added to persisted free text survives commit and save without merging", async ({ page }) => {
  await createFreeText(page, "PersistedBase");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-freetext-multiline.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));

  const point = await page.evaluate(() => {
    const annotations = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")];
    const annotation = annotations.at(-1);
    if (!annotation) throw new Error("Missing persisted free text annotation");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const internal = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal");
        return internal?.isContentEditable ?? false;
      }),
    )
    .toBe(true);

  // macOS Chromium's End key scrolls instead of moving the caret, so place
  // the caret at the end of the existing text explicitly.
  await page.evaluate(() => {
    const internal = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal");
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
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("AddedLine");
  await page.keyboard.press("Enter");

  // The committed editor must hold pdf.js's canonical one-div-per-line DOM;
  // a <br> left inside a line div means #extractText merged the lines.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const internal = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal");
        if (!internal) return null;
        return {
          childDivs: [...internal.children].filter((child) => child.tagName === "DIV").length,
          brCount: internal.querySelectorAll("br").length,
          text: internal.innerText,
        };
      }),
    )
    .toEqual({ childDivs: 2, brCount: 0, text: "PersistedBase\nAddedLine" });

  await saveAndReopen(page, "/tmp/pdfspike-playwright-freetext-multiline-2.pdf");
  // pdf.js renders reopened free text with one span per stored content line,
  // so the span list is the persisted line structure.
  const reopenedLines = await page.evaluate(() => {
    const annotations = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")];
    const annotation = annotations.at(-1);
    if (!annotation) throw new Error("Missing reopened free text annotation");
    return [...annotation.querySelectorAll(".annotationTextContent span")].map((line) => line.textContent);
  });
  expect(reopenedLines).toEqual(["PersistedBase", "AddedLine"]);
});

test("preselected free-text color applies to newly created text", async ({ page }) => {
  await page.getByRole("radio", { name: "Green" }).click();
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("text");

  const point = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".page[data-page-number='1'] .annotationEditorLayer");
    if (!layer) throw new Error("Annotation editor layer missing");
    const rect = layer.getBoundingClientRect();
    return { x: Math.round(rect.left + 190), y: Math.round(rect.top + 260) };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.type("Green text");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>(".freeTextEditor .internal");
        if (!editor) return null;
        return {
          color: getComputedStyle(editor).color,
          text: editor.innerText.trim(),
        };
      }),
    )
    .toEqual({ color: "rgb(64, 157, 72)", text: "Green text" });
});

test("selected free text keeps recolored value after clicking inside it", async ({ page }) => {
  await createFreeText(page, "Free text recolor click");
  await page.waitForTimeout(700);
  const target = await page.evaluate(() => {
    const selected = window.__pdfSpike!
      .editorSummary()
      .find((editor: { isFirstSelectedEditor?: unknown }) => editor.isFirstSelectedEditor);
    if (!selected?.id) throw new Error("Missing selected free text editor summary");
    const editor = document.getElementById(String(selected.id));
    if (!editor) throw new Error("Missing selected free text editor");
    const colorInput = editor.querySelector<HTMLInputElement>(".editToolbar:not(.hidden) .basicColorPicker");
    if (!colorInput) throw new Error("Missing free text floating color picker");
    colorInput.focus();
    colorInput.value = "#2f6ecb";
    colorInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));
    const rect = editor.getBoundingClientRect();
    return { id: String(selected.id), x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });

  await expect
    .poll(() =>
      page.evaluate((editorId) => {
        const editor = document.getElementById(editorId);
        return {
          selectedPersistedAnnotationKey: window.__pdfSpike!.stats().selectedPersistedAnnotationKey,
          selectedEditorColor: window.__pdfSpike!.stats().selectedEditorColor,
          styleColor: getComputedStyle(editor!.querySelector<HTMLElement>(".internal")!).color,
        };
      }, target.id),
    )
    .toEqual({
      selectedPersistedAnnotationKey: null,
      selectedEditorColor: "#2f6ecb",
      styleColor: "rgb(47, 110, 203)",
    });

  await page.mouse.click(target.x, target.y);

  await expect
    .poll(() =>
      page.evaluate((editorId) => {
        const editor = document.getElementById(editorId);
        return {
          selectedPersistedAnnotationKey: window.__pdfSpike!.stats().selectedPersistedAnnotationKey,
          selectedEditorColor: window.__pdfSpike!.stats().selectedEditorColor,
          styleColor: getComputedStyle(editor!.querySelector<HTMLElement>(".internal")!).color,
        };
      }, target.id),
    )
    .toEqual({
      selectedPersistedAnnotationKey: null,
      selectedEditorColor: "#2f6ecb",
      styleColor: "rgb(47, 110, 203)",
    });
});

test("creates, moves, recolors, and deletes ink annotation", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Ink").length;

  await createInkStroke(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink.pdf");

  let annotations = await pageAnnotations(page);
  let inks = annotations.filter((entry) => entry.subtype === "Ink");
  expect(inks).toHaveLength(baseline + 1);
  expect(inks.some((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 3)).toBe(true);
  const createdInk = inks.find((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 3);
  expect(createdInk?.rect).toBeTruthy();

  await activateFirstAnnotationByKind(page, "ink");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.moveSelected(45, 25)) {
      throw new Error("Move selected ink returned false");
    }
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink.pdf");

  annotations = await pageAnnotations(page);
  inks = annotations.filter((entry) => entry.subtype === "Ink");
  const movedInk = inks.find((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 3);
  expect(movedInk?.rect).toBeTruthy();
  expect(
    Math.abs((movedInk!.rect![0] ?? 0) - (createdInk!.rect![0] ?? 0)) > 1 ||
      Math.abs((movedInk!.rect![1] ?? 0) - (createdInk!.rect![1] ?? 0)) > 1,
  ).toBe(true);

  await activateFirstAnnotationByKind(page, "ink");
  await page.evaluate(() => {
    window.__pdfSpike!.recolorSelectedInk("blue");
    window.__pdfSpike!.setInkThickness(8);
    window.__pdfSpike!.setTool("none");
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink.pdf");

  annotations = await pageAnnotations(page);
  inks = annotations.filter((entry) => entry.subtype === "Ink");
  expect(inks).toHaveLength(baseline + 1);
  expect(inks.some((entry) => entry.color?.join(",") === "50,128,221")).toBe(true);
  expect(inks.some((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 8)).toBe(true);

  await activateFirstAnnotationByKind(page, "ink");
  await page.evaluate(() => {
    if (!window.__pdfSpike!.deleteSelected()) {
      throw new Error("Delete selected ink returned false");
    }
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink.pdf");

  annotations = await pageAnnotations(page);
  expect(annotations.filter((entry) => entry.subtype === "Ink")).toHaveLength(baseline);
});

test("selected ink keeps recolored value after clicking inside it", async ({ page }) => {
  await createInkStroke(page);
  const point = await page.evaluate(() => {
    const selected = window.__pdfSpike!
      .editorSummary()
      .find(
        (editor: { annotationElementId?: unknown; editorType?: unknown }) =>
          editor.editorType === "ink" && !editor.annotationElementId,
      );
    if (!selected?.id) throw new Error("Missing created ink editor summary");
    const editor = document.getElementById(String(selected.id));
    if (!editor) throw new Error("Missing ink editor");
    const rect = editor.getBoundingClientRect();
    return { id: String(selected.id), x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().selectedAnnotationKind)).toBe("ink");
  await page.waitForTimeout(700);
  await page.evaluate((editorId) => {
    const editor = document.getElementById(editorId);
    if (!editor) throw new Error("Missing selected ink editor");
    const colorInput = editor.querySelector<HTMLInputElement>(".editToolbar:not(.hidden) .basicColorPicker");
    if (!colorInput) throw new Error("Missing ink floating color picker");
    colorInput.focus();
    colorInput.value = "#2f6ecb";
    colorInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, point.id);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        selectedPersistedAnnotationKey: window.__pdfSpike!.stats().selectedPersistedAnnotationKey,
        selectedEditorColor: window.__pdfSpike!.stats().selectedEditorColor,
      })),
    )
    .toEqual({ selectedPersistedAnnotationKey: null, selectedEditorColor: "#2f6ecb" });

  await page.mouse.click(point.x, point.y);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        selectedPersistedAnnotationKey: window.__pdfSpike!.stats().selectedPersistedAnnotationKey,
        selectedEditorColor: window.__pdfSpike!.stats().selectedEditorColor,
      })),
    )
    .toEqual({ selectedPersistedAnnotationKey: null, selectedEditorColor: "#2f6ecb" });
});

test("active annotation tool creates over empty existing ink editor bounds", async ({ page }) => {
  await createInkStroke(page);
  await activateFirstAnnotationByKind(page, "ink");

  await page.getByRole("button", { name: "Free text", exact: true }).click();
  const inkBoxPoint = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .inkEditor");
    if (!editor) throw new Error("Missing ink editor");
    const editorRect = editor.getBoundingClientRect();
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.2, 0.8, 0.9]) {
        const x = Math.round(editorRect.left + editorRect.width * fx);
        const y = Math.round(editorRect.top + editorRect.height * fy);
        if (!document.elementFromPoint(x, y)?.closest(".inkEditor, .inkAnnotation")) {
          return { x, y };
        }
      }
    }
    throw new Error("Could not find empty ink editor bounds point");
  });

  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => ({
          activeTool: window.__pdfSpike!.stats().activeTool,
          hitExistingInk: Boolean(document.elementFromPoint(x, y)?.closest(".inkEditor, .inkAnnotation")),
        }),
        inkBoxPoint,
      ),
    )
    .toEqual({ activeTool: "text", hitExistingInk: false });

  await page.mouse.click(inkBoxPoint.x, inkBoxPoint.y);
  await page.keyboard.type("Ink box should not block");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
        freeText: document.querySelector<HTMLElement>(".freeTextEditor .internal")?.innerText.trim() ?? "",
      })),
    )
    .toMatchObject({
      activeTool: "text",
      selectedAnnotationKind: "freetext",
      freeText: expect.stringContaining("box should not block"),
    });
});

test("ink tool draws a new stroke starting inside an existing highlight region", async ({ page }) => {
  await createHighlight(page);
  await page.keyboard.press("Escape");
  const start = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .highlightEditor");
    if (!editor) throw new Error("Missing highlight editor");
    const rect = editor.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.evaluate(() => window.__pdfSpike!.setTool("ink"));
  await page.waitForTimeout(200);
  const before = await page.evaluate(
    () => document.querySelectorAll(".page[data-page-number='1'] .inkEditor").length,
  );

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 24, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));

  await expect
    .poll(() =>
      page.evaluate(() => document.querySelectorAll(".page[data-page-number='1'] .inkEditor").length),
    )
    .toBe(before + 1);
});

test("free text tool creates inside an existing highlight region", async ({ page }) => {
  await createHighlight(page);
  await page.keyboard.press("Escape");
  const point = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .highlightEditor");
    if (!editor) throw new Error("Missing highlight editor");
    const rect = editor.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.evaluate(() => window.__pdfSpike!.setTool("text"));
  await page.waitForTimeout(200);

  await page.mouse.click(point.x, point.y);
  await page.keyboard.type("Over the highlight");

  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal")].some(
          (editor) => editor.innerText.includes("Over the highlight"),
        ),
      ),
    )
    .toBe(true);
});

test("active annotation tool double-click edits visible annotations without switching tools", async ({ page }) => {
  await createFreeText(page, "Clickable visible text");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__pdfSpike!.setTool("text"));
  const freeTextPoint = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal");
    if (!editor) throw new Error("Missing free text editor content");
    const rect = editor.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  const beforeFreeTextEditors = await page.evaluate(() => window.__pdfSpike!.stats().freeTextEditors);
  await page.mouse.click(freeTextPoint.x, freeTextPoint.y);
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        freeTextEditors: window.__pdfSpike!.stats().freeTextEditors,
        hasAnnotationFocusBox: Boolean(window.__pdfSpike!.stats().annotationFocusBox),
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ freeTextEditors: beforeFreeTextEditors, hasAnnotationFocusBox: false, selectedAnnotationKind: null });
  await page.mouse.click(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        hasAnnotationFocusBox: Boolean(window.__pdfSpike!.stats().annotationFocusBox),
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "text", hasAnnotationFocusBox: false, selectedAnnotationKind: "freetext" });

  await createInkStroke(page);
  await page.evaluate(() => window.__pdfSpike!.setTool("text"));
  const inkPoint = await page.evaluate(() => {
    const polyline = document.querySelector<SVGGeometryElement>(".page[data-page-number='1'] .inkEditor .ink-hit-area polyline");
    if (!polyline) throw new Error("Missing ink hit area");
    const rect = polyline.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit?.closest(".inkEditor")) {
      throw new Error(`Expected visible ink point to hit ink editor, hit=${hit?.nodeName ?? "null"}`);
    }
    return { x, y };
  });
  await page.mouse.dblclick(inkPoint.x, inkPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "text", selectedAnnotationKind: "ink" });
});

test("selection mode double-click edits existing free text and ink annotations without toggling tools", async ({ page }) => {
  await createFreeText(page, "Direct click text");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const freeTextPoint = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor");
    if (!editor) throw new Error("Missing free text editor");
    const rect = editor.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        hasAnnotationFocusBox: Boolean(window.__pdfSpike!.stats().annotationFocusBox),
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "none", hasAnnotationFocusBox: false, selectedAnnotationKind: "freetext" });

  await createInkStroke(page);
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const inkPoint = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .inkEditor");
    if (!editor) throw new Error("Missing ink editor");
    const rect = editor.getBoundingClientRect();
    for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) {
        const x = Math.round(rect.left + rect.width * fx);
        const y = Math.round(rect.top + rect.height * fy);
        if (document.elementFromPoint(x, y)?.closest(".inkEditor")) {
          return { x, y };
        }
      }
    }
    throw new Error("Could not find clickable ink point");
  });
  await page.mouse.dblclick(inkPoint.x, inkPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "none", selectedAnnotationKind: "ink" });
});

test("selection mode double-click puts caret inside existing free text", async ({ page }) => {
  await createFreeText(page, "Caret direct click text");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const freeTextPoint = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .freeTextEditor .internal");
    if (!editor) throw new Error("Missing free text editor");
    const rect = editor.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });

  await page.mouse.dblclick(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>(".freeTextEditor .internal");
        return {
          activeInsideEditor: Boolean(editor?.contains(document.activeElement)),
          activeTool: window.__pdfSpike!.stats().activeTool,
          isEditable: editor?.isContentEditable ?? false,
          selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
        };
      }),
    )
    .toEqual({
      activeInsideEditor: true,
      activeTool: "none",
      isEditable: true,
      selectedAnnotationKind: "freetext",
    });

  await page.mouse.click(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>(".freeTextEditor .internal");
        return {
          activeInsideEditor: Boolean(editor?.contains(document.activeElement)),
          isEditable: editor?.isContentEditable ?? false,
        };
      }),
    )
    .toEqual({ activeInsideEditor: true, isEditable: true });
});

test("direct double-click editing an annotation does not scroll the PDF viewport", async ({ page }) => {
  await createFreeText(page, "No scroll direct edit", 2);
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const target = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='2'] .freeTextEditor");
    if (!container || !editor) throw new Error("Missing PDF container or page 2 free text editor");
    const containerRect = container.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const absoluteTop = editorRect.top - containerRect.top + container.scrollTop;
    container.scrollTop = Math.max(0, absoluteTop - 36);
    await sleep(150);
    const rect = editor.getBoundingClientRect();
    return {
      beforeScrollTop: container.scrollTop,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  });

  await page.mouse.dblclick(target.x, target.y);

  await expect
    .poll(() =>
      page.evaluate(
        (beforeScrollTop) => ({
          activeTool: window.__pdfSpike!.stats().activeTool,
          scrollDelta: Math.abs(
            (document.querySelector<HTMLElement>(".pdf-container")?.scrollTop ?? 0) - beforeScrollTop,
          ),
          selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
        }),
        target.beforeScrollTop,
      ),
    )
    .toEqual({ activeTool: "none", scrollDelta: 0, selectedAnnotationKind: "freetext" });
});

test("direct double-click editing a persisted annotation does not scroll the PDF viewport", async ({ page }) => {
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  const target = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const entry = (window.__pdfSpike!.annotationSidebarSummary() as {
      bounds?: { left: number; right: number; top: number; bottom: number } | null;
      kind: string;
      page: number;
    }[]).find((candidate) => candidate.kind === "freetext" && candidate.bounds);
    if (!container) throw new Error("Missing PDF container");
    if (!entry?.bounds) throw new Error("Missing persisted free text entry");

    const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
    if (!pageElement) throw new Error(`Missing page ${entry.page}`);
    container.scrollTop = Math.max(0, pageElement.offsetTop - 20);
    await sleep(400);

    const containerRect = container.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const absoluteTop = pageRect.top - containerRect.top + container.scrollTop + entry.bounds.top * pageRect.height;
    container.scrollTop = Math.max(0, absoluteTop - 36);
    await sleep(150);
    const updatedPageRect = pageElement.getBoundingClientRect();
    return {
      beforeScrollTop: container.scrollTop,
      x: Math.round(updatedPageRect.left + ((entry.bounds.left + entry.bounds.right) / 2) * updatedPageRect.width),
      y: Math.round(updatedPageRect.top + ((entry.bounds.top + entry.bounds.bottom) / 2) * updatedPageRect.height),
    };
  });

  await page.mouse.dblclick(target.x, target.y);

  await expect
    .poll(() =>
      page.evaluate(
        (beforeScrollTop) => ({
          activeTool: window.__pdfSpike!.stats().activeTool,
          scrollDelta: Math.abs(
            (document.querySelector<HTMLElement>(".pdf-container")?.scrollTop ?? 0) - beforeScrollTop,
          ),
          selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
        }),
        target.beforeScrollTop,
      ),
    )
    .toEqual({ activeTool: "none", scrollDelta: 0, selectedAnnotationKind: "freetext" });
});

test("single-click on persisted free text does not locate, double-click edits without toggling tools", async ({ page }) => {
  await createFreeText(page, "Persisted direct click text");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-persisted-free-text-direct-click.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));

  const freeTextPoint = await page.evaluate(() => {
    const annotations = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .freeTextAnnotation")];
    const annotation = annotations.at(-1);
    if (!annotation) throw new Error("Missing persisted free text annotation");
    const rect = annotation.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.click(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        hasAnnotationFocusBox: Boolean(window.__pdfSpike!.stats().annotationFocusBox),
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "none", hasAnnotationFocusBox: false, selectedAnnotationKind: null });

  await page.mouse.dblclick(freeTextPoint.x, freeTextPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "none", selectedAnnotationKind: "freetext" });
});

test("selection mode double-click edits persisted ink annotation without toggling tools", async ({ page }) => {
  await createInkStroke(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-persisted-ink-direct-click.pdf");
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));

  const inkPoint = await page.evaluate(() => {
    const inkMarks = [
      ...document.querySelectorAll<SVGGeometryElement>(
        ".page[data-page-number='1'] .inkAnnotation svg :is(path, polyline, polygon, line)",
      ),
    ];
    const mark =
      inkMarks
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .find(({ rect }) => rect.width > 0 && rect.height > 0 && rect.top < 500)?.element ?? inkMarks.at(-1);
    if (!mark) throw new Error("Missing persisted ink annotation");
    const rect = mark.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.dblclick(inkPoint.x, inkPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeTool: window.__pdfSpike!.stats().activeTool,
        selectedAnnotationKind: window.__pdfSpike!.stats().selectedAnnotationKind,
      })),
    )
    .toEqual({ activeTool: "none", selectedAnnotationKind: "ink" });
});

test("editing one ink annotation does not arm single-click editing for another ink", async ({ page }) => {
  await createInkStroke(page);

  const firstInk = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".page[data-page-number='1'] .inkEditor");
    if (!editor) throw new Error("Missing live ink editor");
    const rect = editor.getBoundingClientRect();
    return {
      id: editor.id,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  });

  await page.mouse.dblclick(firstInk.x, firstInk.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = window.__pdfSpike!.stats();
        const selected = window.__pdfSpike!
          .editorSummary()
          .find((editor: { isFirstSelectedEditor?: unknown }) => editor.isFirstSelectedEditor);
        const inkLayer = document.querySelector<HTMLElement>(".annotationEditorLayer.inkEditing");
        return {
          activeTool: stats.activeTool,
          inkLayerCursor: inkLayer ? getComputedStyle(inkLayer).cursor : null,
          selectedAnnotationKind: stats.selectedAnnotationKind,
          selectedEditorId: selected?.id ?? null,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        };
      }),
    )
    .toEqual({
      activeTool: "none",
      inkLayerCursor: "auto",
      selectedAnnotationKind: "ink",
      selectedEditorId: firstInk.id,
      selectedPersistedAnnotationKey: null,
    });

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
      )
      .slice(0, 1);
  });
  expect(plainInks.length).toBeGreaterThanOrEqual(1);

  const secondInk = await page.evaluate(async ({ pageNumber, sourceId }) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!pageElement || !container) throw new Error(`Missing page/container for ${sourceId}`);
    container.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
    await sleep(300);
    const entry = (window.__pdfSpike!.annotationSidebarSummary() as {
      bounds?: { left: number; right: number; top: number; bottom: number } | null;
      page: number;
      sourceId: string;
    }[]).find((candidate) => candidate.page === pageNumber && candidate.sourceId === sourceId);
    if (!entry?.bounds) throw new Error(`Missing ink bounds ${sourceId}`);
    const pageRect = pageElement.getBoundingClientRect();
    return {
      x: Math.round(pageRect.left + ((entry.bounds.left + entry.bounds.right) / 2) * pageRect.width),
      y: Math.round(pageRect.top + ((entry.bounds.top + entry.bounds.bottom) / 2) * pageRect.height),
    };
  }, { pageNumber: plainInks[0].page, sourceId: plainInks[0].id });

  await page.mouse.move(secondInk.x, secondInk.y);
  await page.mouse.click(secondInk.x, secondInk.y);
  await page.waitForTimeout(300);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = window.__pdfSpike!.stats();
        const selected = window.__pdfSpike!
          .editorSummary()
          .find((editor: { isFirstSelectedEditor?: unknown }) => editor.isFirstSelectedEditor);
        return {
          activeTool: stats.activeTool,
          selectedAnnotationKind: stats.selectedAnnotationKind,
          selectedEditorId: selected?.id ?? null,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        };
      }),
    )
    .toEqual({
      activeTool: "none",
      selectedAnnotationKind: "ink",
      selectedEditorId: firstInk.id,
      selectedPersistedAnnotationKey: null,
    });
});

test("selection mode can drag-select text starting inside highlight and ink visuals", async ({ page }) => {
  const dragTarget = async (kind: "highlight" | "ink") =>
    page.evaluate(async (targetKind) => {
      window.__pdfSpike!.setTool("none");
      document.getSelection()?.removeAllRanges();

      type Point = { x: number; y: number };
      type Rect = { left: number; right: number; top: number; bottom: number };
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const overlaps = (left: Rect, right: Rect) =>
        left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      const rectFromDom = (rect: DOMRect): Rect => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
      const center = (rect: Rect): Point => ({
        x: Math.round((rect.left + rect.right) / 2),
        y: Math.round((rect.top + rect.bottom) / 2),
      });
      const textDragForVisualRect = (visualRect: Rect, pageElement: HTMLElement) => {
        const textLayer = pageElement.querySelector(".textLayer") ?? pageElement;
        const chars: { rect: Rect; text: string }[] = [];
        const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          for (let offset = 0; offset < text.length; offset += 1) {
            if (!text[offset]?.trim()) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            range.detach();
            if (rect.width > 0 && rect.height > 0) {
              chars.push({ rect: rectFromDom(rect), text: text[offset] });
            }
          }
        }
        const startIndex = chars.findIndex((char) => overlaps(char.rect, visualRect));
        if (startIndex < 0) return null;
        const start = center(chars[startIndex].rect);
        const end = center(chars[Math.min(chars.length - 1, startIndex + 12)].rect);
        return { start, end };
      };

      if (targetKind === "highlight") {
        const highlight = document.querySelector<HTMLElement>(".highlightAnnotation, .highlightEditor.disabled");
        if (!highlight) throw new Error("Missing visible highlight annotation");
        highlight.scrollIntoView({ block: "center", inline: "center" });
        await sleep(400);
        const highlightPage = highlight.closest<HTMLElement>(".page");
        if (!highlightPage) throw new Error("Missing highlight page");
        const drag = textDragForVisualRect(rectFromDom(highlight.getBoundingClientRect()), highlightPage);
        if (!drag) throw new Error("Could not find text inside highlight visual rect");
        return drag;
      }

      const inkShapes = [...document.querySelectorAll<SVGGraphicsElement>(".inkAnnotation svg :is(path, polyline, polygon, line)")];
      for (const shape of inkShapes) {
        shape.scrollIntoView({ block: "center", inline: "center" });
        await sleep(250);
        const pageElement = shape.closest<HTMLElement>(".page");
        const rect = rectFromDom(shape.getBoundingClientRect());
        if (!pageElement || (rect.right <= rect.left && rect.bottom <= rect.top)) continue;
        const padded = { left: rect.left - 8, right: rect.right + 8, top: rect.top - 8, bottom: rect.bottom + 8 };
        const drag = textDragForVisualRect(padded, pageElement);
        if (drag) return drag;
      }
      throw new Error("Could not find text under an ink visual shape");
    }, kind);

  const dragAndReadSelection = async (target: Awaited<ReturnType<typeof dragTarget>>) => {
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    await page.mouse.move(target.start.x, target.start.y);
    await page.mouse.down();
    await page.mouse.move(target.end.x, target.end.y, { steps: 8 });
    await page.mouse.up();
    return page.evaluate(() => document.getSelection()?.toString().trim() ?? "");
  };

  await expect.poll(async () => dragAndReadSelection(await dragTarget("highlight"))).not.toBe("");
  await expect.poll(async () => dragAndReadSelection(await dragTarget("ink"))).not.toBe("");
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().selectedAnnotationKind)).toBeNull();
  await expect.poll(() => page.evaluate(() => Boolean(window.__pdfSpike!.stats().annotationFocusBox))).toBe(false);
});

test("creates marker ink with preset color, thickness, and opacity", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Ink").length;

  await page.evaluate(async () => {
    window.__pdfSpike!.setTool("ink");
    window.__pdfSpike!.setInkMarkerPreset();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const layer = document.querySelector(".page[data-page-number=\"1\"] .annotationEditorLayer");
    if (!(layer instanceof HTMLElement)) throw new Error("No annotation editor layer for marker ink test");
    const rect = layer.getBoundingClientRect();
    const point = (x: number, y: number) => ({ clientX: Math.round(rect.x + x), clientY: Math.round(rect.y + y) });
    const dispatch = (type: string, id: number, x: number, y: number, buttons: number) => {
      layer.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: id,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons,
          ...point(x, y),
        }),
      );
    };
    dispatch("pointerdown", 12, 260, 420, 1);
    dispatch("pointermove", 12, 420, 430, 1);
    dispatch("pointermove", 12, 620, 440, 1);
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 12,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        ...point(620, 440),
      }),
    );
    window.__pdfSpike!.setTool("none");
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink-marker.pdf");

  const inks = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Ink");
  expect(inks).toHaveLength(baseline + 1);
  const marker = inks.find((entry) => {
    const width = entry.borderStyle?.rawWidth ?? entry.borderStyle?.width;
    return entry.color?.join(",") === "255,243,92" && width === 14;
  });
  expect(marker).toBeTruthy();
  expect(marker!.opacity === null || Math.abs(marker!.opacity! - 0.45) <= 0.01).toBe(true);
});
