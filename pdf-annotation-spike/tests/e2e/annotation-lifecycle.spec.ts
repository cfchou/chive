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

  await page.mouse.move(titleBox.left + 1, titleBox.top + titleBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(titleBox.left + titleBox.width, titleBox.top + titleBox.height * 0.55, { steps: 80 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("How Modern Browsers Work");

  await page.mouse.click(titleBox.left + 4, titleBox.top + titleBox.height + 42);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? "")).toBe("");
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
