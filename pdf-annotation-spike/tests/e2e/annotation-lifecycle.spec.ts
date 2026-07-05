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
    const clickHighlight = (pointerId: number) => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.textContent?.trim() === "Highlight",
      );
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
    document.querySelector<HTMLElement>("[aria-label=\"Set highlight color to green\"]")?.click();
    clickHighlight(21);
    await sleep(400);
    window.__pdfSpike!.setTool("none");
    await sleep(200);

    await selectTextChunk(1);
    document.querySelector<HTMLElement>("[aria-label=\"Set highlight color to blue\"]")?.click();
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
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("highlight");
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

test("toolbar highlight creates an annotation from mouse-selected text", async ({ page }) => {
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

  await page.mouse.move(titleBox.left + 1, titleBox.top + titleBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(titleBox.left + titleBox.width, titleBox.top + titleBox.height * 0.55, { steps: 80 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("How Modern Browsers Work");
  await expect(page.getByRole("button", { name: "Highlight", exact: true })).toHaveCount(1);

  await page.locator(".segmented").getByRole("button", { name: "Highlight", exact: true }).click();

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
  const highlightButton = page.locator(".segmented").getByRole("button", { name: "Highlight", exact: true });
  const before = await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary());
  const beforePageOneHighlights = before.filter(
    (entry: { kind: string; page: number }) => entry.kind === "highlight" && entry.page === 1,
  ).length;

  await highlightButton.click();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().activeTool)).toBe("highlight");

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

  await page.mouse.move(titleBox.left + 1, titleBox.top + titleBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(titleBox.left + titleBox.width, titleBox.top + titleBox.height * 0.55, { steps: 80 });
  await page.mouse.up();

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

test("preselected free-text color applies to newly created text", async ({ page }) => {
  await page.getByRole("button", { name: "Set free-text color to green" }).click();
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
    .toEqual({ color: "rgb(79, 122, 41)", text: "Green text" });
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
