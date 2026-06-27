import { expect, test } from "@playwright/test";
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
    const clickHighlightSelection = (pointerId: number) => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.textContent?.trim() === "Highlight Selection",
      );
      if (!(button instanceof HTMLElement)) {
        throw new Error("Highlight Selection button not found");
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
    document.querySelector<HTMLElement>("[aria-label=\"Set highlight color to green\"]")?.click();
    clickHighlightSelection(21);
    await sleep(400);
    window.__pdfSpike!.setTool("none");
    await sleep(200);

    await selectTextChunk(1);
    document.querySelector<HTMLElement>("[aria-label=\"Set highlight color to blue\"]")?.click();
    clickHighlightSelection(22);
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
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("highlight");
});

test("creates, recolors, and deletes through highlight tool mode", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Highlight").length;

  await page.evaluate(() => {
    window.__pdfSpike!.selectFirstText();
  });
  await page.locator(".segmented").getByRole("button", { name: "Highlight", exact: true }).click();
  await page.getByRole("button", { name: "Set highlight color to pink" }).click();
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
  await page.getByRole("button", { name: "Set highlight color to yellow" }).click();
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
  expect(inks.some((entry) => entry.color?.join(",") === "47,110,203")).toBe(true);
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
