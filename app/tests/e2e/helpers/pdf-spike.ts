import { expect, type Page } from "@playwright/test";

export type PdfSpikeApi = {
  activateFirstAnnotationItem: () => Promise<boolean>;
  activateFirstOutlineItem: () => Promise<boolean>;
  annotationSidebarSummary: () => AnnotationEntry[];
  annotationSummary: () => Promise<PageAnnotationSummary[]>;
  bookmarkSummary: () => BookmarkEntry[];
  createBookmarkForCurrentPage: () => Promise<void>;
  createPageFreeText: (text?: string, pageNumber?: number) => Promise<boolean>;
  createSelectionHighlightInToolMode: () => Promise<boolean>;
  deleteSelected: () => boolean;
  debugSavedBytes: (path: string) => number[];
  editSelectedFreeText: (text: string) => Promise<boolean>;
  loadPath: (path: string) => Promise<void>;
  loadUrl: (url: string, label?: string) => Promise<void>;
  moveSelected: (x: number, y: number) => boolean;
  outlineSummary: () => { title: string }[];
  recolorSelectedFreeText: (color: string) => void;
  recolorSelectedHighlight: (color: string) => void;
  recolorSelectedInk: (color: string) => void;
  saveToPath: (path: string) => Promise<void>;
  selectFirstHighlight: () => Promise<boolean>;
  selectFirstText: () => string;
  setInkMarkerPreset: () => void;
  setInkThickness: (thickness: number) => void;
  setTool: (tool: "none" | "highlight" | "text" | "ink") => void;
  stats: () => Record<string, unknown>;
};

export type BookmarkEntry = {
  id: string;
  title: string;
  pageNumber: number;
  pageHeight: number;
  targetY: number;
  destinationY: number;
  color?: string | null;
};

export type AnnotationEntry = {
  id: string;
  detail: string;
  kind: "highlight" | "freetext" | "ink";
  page: number;
  intent?: string | null;
  sortTop?: number;
  source?: "live" | "pdf";
  sourceId?: string;
};

export type PageAnnotationSummary = {
  page: number;
  annotations: {
    borderStyle?: { rawWidth?: number; width?: number };
    color?: number[] | null;
    opacity?: number | null;
    rect?: number[] | null;
    subtype?: string | null;
    textContent?: string[] | null;
  }[];
};

export type PageAnnotation = PageAnnotationSummary["annotations"][number];

declare global {
  interface Window {
    __pdfSpike?: any;
  }
}

export async function openApp(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__pdfSpike));
}

export async function loadFixture(page: Page, url = "/sample.pdf", label = "sample.pdf") {
  await page.evaluate(
    async ([fixtureUrl, fixtureLabel]) => {
      await window.__pdfSpike!.loadUrl(fixtureUrl, fixtureLabel);
    },
    [url, label],
  );
  await waitForPageReady(page);
}

export async function waitForPageReady(page: Page) {
  await page.waitForFunction(() => {
    const stats = window.__pdfSpike?.stats();
    return (
      Number(stats?.pages ?? 0) > 0 &&
      document.querySelector(".page[data-page-number=\"1\"] canvas") instanceof HTMLCanvasElement
    );
  });
}

export async function expectCanvasHasContent(page: Page) {
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector(".page[data-page-number=\"1\"] canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Page canvas not found");
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Could not read page canvas");
    }
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let index = 0; index < data.length; index += 16) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhite += 1;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      ratio: nonWhite / (data.length / 16),
    };
  });
  expect(sample.width).toBeGreaterThan(0);
  expect(sample.height).toBeGreaterThan(0);
  expect(sample.ratio).toBeGreaterThan(0.005);
}

export async function getStats(page: Page) {
  return page.evaluate(() => window.__pdfSpike!.stats());
}

export async function annotationSummary(page: Page) {
  return page.evaluate(
    () => (window.__pdfSpike as PdfSpikeApi).annotationSummary() as Promise<PageAnnotationSummary[]>,
  );
}

export async function pageAnnotations(page: Page, pageNumber = 1): Promise<PageAnnotation[]> {
  const summary = await annotationSummary(page);
  const pageSummary = summary.find((entry) => entry.page === pageNumber);
  if (!pageSummary) {
    throw new Error(`Missing annotation summary for page ${pageNumber}`);
  }
  return pageSummary.annotations;
}

export async function saveAndReopen(page: Page, path: string) {
  await page.evaluate(async (targetPath) => {
    await window.__pdfSpike!.saveToPath(targetPath);
    await window.__pdfSpike!.loadPath(targetPath);
  }, path);
  await waitForPageReady(page);
}

export async function createHighlight(page: Page) {
  const result = await page.evaluate(async () => {
    const selected = window.__pdfSpike!.selectFirstText();
    const created = await window.__pdfSpike!.createSelectionHighlightInToolMode();
    window.__pdfSpike!.setTool("none");
    return { selected, created };
  });
  expect(result.selected.trim().length).toBeGreaterThan(0);
  expect(result.created).toBe(true);
  await page.waitForTimeout(300);
  return result.selected.trim();
}

export async function createFreeText(page: Page, text: string, pageNumber = 1) {
  const created = await page.evaluate(
    async ([content, targetPage]) => {
      const ok = await window.__pdfSpike!.createPageFreeText(content, Number(targetPage));
      return ok;
    },
    [text, String(pageNumber)],
  );
  expect(created).toBe(true);
  await page.waitForTimeout(300);
}

export async function createInkStroke(page: Page, placement: "default" | "top-edge" = "default") {
  const stats = await page.evaluate(async (strokePlacement) => {
    window.__pdfSpike!.setTool("ink");
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.__pdfSpike!.recolorSelectedInk("red");
    window.__pdfSpike!.setInkThickness(3);
    const layer = document.querySelector(".page[data-page-number=\"1\"] .annotationEditorLayer");
    if (!(layer instanceof HTMLElement)) {
      throw new Error("No annotation editor layer for ink test");
    }
    const rect = layer.getBoundingClientRect();
    const point = (x: number, y: number) => ({
      clientX: Math.round(rect.x + x),
      clientY: Math.round(rect.y + y),
    });
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
    const points = strokePlacement === "top-edge" ? [[140, 35], [200, 80], [260, 125]] : [[140, 220], [200, 270], [260, 320]];
    dispatch("pointerdown", 11, points[0][0], points[0][1], 1);
    dispatch("pointermove", 11, points[1][0], points[1][1], 1);
    dispatch("pointermove", 11, points[2][0], points[2][1], 1);
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        ...point(points[2][0], points[2][1]),
      }),
    );
    window.__pdfSpike!.setTool("none");
    await new Promise((resolve) => setTimeout(resolve, 700));
    return window.__pdfSpike!.stats();
  }, placement);
  expect(Number(stats.inkEditors ?? 0)).toBeGreaterThan(0);
}

export async function activateFirstAnnotationByKind(page: Page, kind: AnnotationEntry["kind"]) {
  await activateAnnotationByKind(page, kind, 0);
}

export async function activateAnnotationByKind(page: Page, kind: AnnotationEntry["kind"], index = 0) {
  await page.evaluate(() => window.__pdfSpike!.setTool("none"));
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("none");
  const activated = await page.evaluate(
    async ([targetKind, targetIndex]) => {
      const entries = (window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[]).filter(
        (entry) => entry.page === 1 && entry.kind === targetKind,
      );
      const entry = entries[Number(targetIndex)];
      if (!entry) {
        throw new Error(`Annotation target not found for ${targetKind}`);
      }
      return window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId);
    },
    [kind, String(index)],
  );
  expect(activated).toBe(true);

  const selected = await page.evaluate(() => {
    const stats = window.__pdfSpike!.stats();
    if (stats.hasSelectedHighlight) return "highlight";
    return window.__pdfSpike!.stats().selectedAnnotationKind;
  });
  expect(selected).toBe(kind);
}

export async function activateNthLiveHighlight(page: Page, index: number) {
  const point = await page.evaluate(async (targetIndex) => {
    const statsBefore = window.__pdfSpike!.stats();
    if (statsBefore.activeTool !== "none") {
      window.__pdfSpike!.setTool("none");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const targets = [...document.querySelectorAll(".highlightEditor.disabled")];
      const target = targets[Number(targetIndex)];
      if (target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect();
        return {
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Live highlight not found at index ${targetIndex}`);
  }, String(index));

  await page.mouse.dblclick(point.clientX, point.clientY);
  await page.waitForTimeout(300);
  await expect.poll(() => getStats(page)).toMatchObject({ activeTool: "none", selectedHighlightColor: /.+/ });
}

export async function expectNoVisibleAnnotationPopup(page: Page) {
  const visiblePopups = await page.evaluate(() => {
    return [...document.querySelectorAll(".popupAnnotation, .popup")].filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }).length;
  });
  expect(visiblePopups).toBe(0);
}

type ToolbarControlGeometry = {
  activeTabCount: number;
  color: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  deleteAccessibleName: string | null;
  deleteControl: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  deleteFocusable: boolean;
  deleteOffsetParentClassName: string | null;
  deletePosition: string;
  editor: { bottom: number; top: number };
  toolbar: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  toolbarCount: number;
};

export async function expectSelectedEditorToolbarControlsAdjacent(page: Page) {
  const readGeometry = () =>
    page.evaluate(() => {
        const displayedContainers = [...document.querySelectorAll<HTMLElement>(".pdf-container")].filter((container) => {
          const style = getComputedStyle(container);
          const rect = container.getBoundingClientRect();
          return style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
        const activeTabCount = window.__pdfSpike!.tabs.list().filter((tab: { active: boolean }) => tab.active).length;
        const container = displayedContainers[0];
        if (!container) return null;

        const toolbars = [...container.querySelectorAll<HTMLElement>(
          ".annotationEditorLayer .selectedEditor .editToolbar:not(.hidden)",
        )];
        const toolbar = toolbars[0];
        const editor = toolbar?.closest<HTMLElement>(".selectedEditor");
        const color = toolbar?.querySelector<HTMLElement>(".buttons .basicColorPicker");
        const deleteControl = toolbar?.querySelector<HTMLElement>(".buttons .deleteButton");
        if (!toolbar || !editor || !color || !deleteControl) return null;
        const colorRect = color.getBoundingClientRect();
        const deleteRect = deleteControl.getBoundingClientRect();
        if (colorRect.width <= 0 || colorRect.height <= 0 || deleteRect.width <= 0 || deleteRect.height <= 0) return null;

        return {
          activeTabCount,
          color: colorRect.toJSON(),
          deleteAccessibleName:
            deleteControl.getAttribute("aria-label") ??
            deleteControl.getAttribute("title") ??
            deleteControl.getAttribute("data-l10n-id"),
          deleteControl: deleteRect.toJSON(),
          deleteFocusable: !deleteControl.matches(":disabled") && deleteControl.tabIndex >= 0,
          deleteOffsetParentClassName:
            deleteControl.offsetParent instanceof HTMLElement ? deleteControl.offsetParent.className : null,
          deletePosition: getComputedStyle(deleteControl).position,
          editor: editor.getBoundingClientRect().toJSON(),
          toolbar: toolbar.getBoundingClientRect().toJSON(),
          toolbarCount: toolbars.length,
        };
    });
  await expect.poll(readGeometry).not.toBeNull();
  const snapshot = await readGeometry();
  if (!snapshot) throw new Error("Selected editor toolbar controls were not available");
  const geometry = snapshot as ToolbarControlGeometry;
  const contained = (inner: ToolbarControlGeometry["color"], outer: ToolbarControlGeometry["toolbar"]) =>
    inner.left >= outer.left - 2 &&
    inner.right <= outer.right + 2 &&
    inner.top >= outer.top - 2 &&
    inner.bottom <= outer.bottom + 2;

  expect(geometry.activeTabCount).toBe(1);
  expect(geometry.toolbarCount).toBe(1);
  // PDF.js 6.0.227 defines both controls as 28px. Keep a small rasterization
  // tolerance so a missing custom property cannot turn the row into a tall
  // but otherwise self-contained toolbar.
  expect(geometry.color.width).toBeGreaterThanOrEqual(26);
  expect(geometry.color.width).toBeLessThanOrEqual(30);
  expect(geometry.color.height).toBeGreaterThanOrEqual(26);
  expect(geometry.color.height).toBeLessThanOrEqual(30);
  expect(geometry.deleteControl.width).toBeGreaterThanOrEqual(26);
  expect(geometry.deleteControl.width).toBeLessThanOrEqual(30);
  expect(geometry.deleteControl.height).toBeGreaterThanOrEqual(26);
  expect(geometry.deleteControl.height).toBeLessThanOrEqual(30);
  expect(geometry.deleteFocusable).toBe(true);
  expect(geometry.deleteAccessibleName).toBeTruthy();
  expect(contained(geometry.color, geometry.toolbar)).toBe(true);
  expect(contained(geometry.deleteControl, geometry.toolbar)).toBe(true);
  expect(Math.abs(geometry.color.top + geometry.color.height / 2 - (geometry.deleteControl.top + geometry.deleteControl.height / 2))).toBeLessThanOrEqual(2);
  expect(geometry.deleteControl.left - geometry.color.right).toBeGreaterThanOrEqual(0);
  expect(geometry.deleteControl.left - geometry.color.right).toBeLessThanOrEqual(8);
  expect(geometry.deletePosition).not.toMatch(/absolute|fixed/);
  expect(geometry.deleteOffsetParentClassName).toContain("editToolbar");
  expect(geometry.toolbar.top - geometry.editor.bottom).toBeGreaterThanOrEqual(0);
  expect(geometry.toolbar.top - geometry.editor.bottom).toBeLessThanOrEqual(8);
  const hitTarget = await page.evaluate(() => {
    const displayedContainer = [...document.querySelectorAll<HTMLElement>(".pdf-container")].find((container) => {
      const style = getComputedStyle(container);
      const rect = container.getBoundingClientRect();
      return style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    const button = displayedContainer?.querySelector<HTMLElement>(
      ".annotationEditorLayer .selectedEditor .editToolbar:not(.hidden) .buttons .deleteButton",
    );
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || Boolean(hit && button.contains(hit));
  });
  expect(hitTarget).toBe(true);
}

export function collectPageErrors(page: Page, errors: string[]) {
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
}

export async function expectSidebarHasUsefulHighlight(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__pdfSpike!
          .annotationSidebarSummary()
          .filter((entry: AnnotationEntry) => entry.kind === "highlight")
          .map((entry: AnnotationEntry) => entry.detail),
      ),
    )
    .toContainEqual(expect.not.stringMatching(/^Persisted PDF annotation$/));
}
