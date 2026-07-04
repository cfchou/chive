import { expect, test } from "@playwright/test";
import { collectPageErrors, getStats, loadFixture, openApp } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

function visualOrderFixtureUrl() {
  const stream = [
    "BT /F1 18 Tf 72 700 Td (Alpha) Tj ET",
    "BT /F1 18 Tf 240 700 Td (Gamma) Tj ET",
    "BT /F1 18 Tf 130 700 Td (Beta) Tj ET",
    "BT /F1 18 Tf 72 670 Td (Next) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(pdf, "binary").toString("base64")}`;
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("focuses the PDF cursor and moves to the next word", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
  });

  const initial = await getStats(page);
  expect(initial.pdfCursor).toMatchObject({
    pageNumber: 1,
    text: "How",
  });

  await page.keyboard.press("w");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
  });

  const moved = await getStats(page);
  expect(moved.pdfCursor).toMatchObject({
    pageNumber: 1,
    text: "Modern",
  });
  expect((moved.pdfCursor as { textOffset: number }).textOffset).toBeGreaterThan(
    (initial.pdfCursor as { textOffset: number }).textOffset,
  );
  expect((moved.pdfCursor as { left: number }).left).toBeGreaterThan(
    (initial.pdfCursor as { right: number }).right,
  );
  const visibleCaret = await page.evaluate(() => {
    const stats = window.__pdfSpike!.stats();
    const cursor = stats.pdfCursor as { left: number };
    const caret = document.querySelector<HTMLElement>(".pdf-text-caret");
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!caret) throw new Error("Missing PDF caret");
    if (!container) throw new Error("Missing PDF container");
    const caretRect = caret.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      dx: caretRect.left - (containerRect.left + cursor.left - container.scrollLeft),
      width: caretRect.width,
      left: caretRect.left,
    };
  });
  expect(Math.abs(visibleCaret.dx)).toBeLessThanOrEqual(3);
  expect(visibleCaret.width).toBeGreaterThanOrEqual(3);
});

test("keeps word-level cursor geometry when Range rects collapse to a full PDF text item", async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(() => {
    const originalGetClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function patchedGetClientRects() {
      const start = this.startContainer;
      if (
        start.nodeType === Node.TEXT_NODE &&
        start.parentElement?.closest(".textLayer") &&
        (start.textContent ?? "").trim().split(/\s+/).length > 1
      ) {
        const parentRect = start.parentElement.getBoundingClientRect();
        return {
          length: 1,
          item: (index: number) => (index === 0 ? parentRect : null),
          [Symbol.iterator]: function* () {
            yield parentRect;
          },
        } as unknown as DOMRectList;
      }
      return originalGetClientRects.call(this);
    };
  });

  await page.keyboard.press("p");
  const initial = await getStats(page);
  expect(initial.pdfCursor).toMatchObject({ text: "How" });

  await page.keyboard.press("w");
  const moved = await getStats(page);
  expect(moved.pdfCursor).toMatchObject({ text: "Modern" });
  expect((moved.pdfCursor as { left: number }).left).toBeGreaterThan(
    (initial.pdfCursor as { right: number }).right,
  );
});

test("sizes the caret from PDF.js text item font height", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "How" });

  const heights = await page.evaluate(() => {
    const caret = document.querySelector<HTMLElement>(".pdf-text-caret");
    const titleSpan = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='1'] .textLayer span")]
      .find((span) => span.getBoundingClientRect().width > 0 && span.textContent?.startsWith("How "));
    if (!caret || !titleSpan) throw new Error("Missing PDF caret or title span");
    const caretRect = caret.getBoundingClientRect();
    const fontHeight = Number.parseFloat(getComputedStyle(titleSpan).getPropertyValue("--font-height"));
    return {
      caretHeight: caretRect.height,
      fontHeight,
    };
  });

  expect(heights.caretHeight).toBeGreaterThanOrEqual(heights.fontHeight * 0.85);
});

test("moves by rendered visual word order instead of PDF text stream order", async ({ page }) => {
  await loadFixture(page, visualOrderFixtureUrl(), "visual-order.pdf");
  await expect.poll(async () => Number((await getStats(page)).textLayerSpans)).toBeGreaterThan(0);

  await page.keyboard.press("p");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "Alpha" });

  await page.keyboard.press("w");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "Beta" });

  await page.keyboard.press("w");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "Gamma" });

  await page.keyboard.press("w");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "Next" });
});

test("renders visual mode selection from word geometry instead of native DOM range", async ({ page }) => {
  await loadFixture(page, visualOrderFixtureUrl(), "visual-order.pdf");
  await expect.poll(async () => Number((await getStats(page)).textLayerSpans)).toBeGreaterThan(0);

  await page.keyboard.press("p");
  await page.keyboard.press("v");
  await page.keyboard.press("w");
  await expect.poll(async () => (await getStats(page)).pdfVisualSelectionText).toBe("Alpha Beta");

  const firstSelection = await getStats(page);
  expect(firstSelection.selectedText).toBe("Alpha Beta");
  expect(firstSelection.pdfVisualSelectionRects).toHaveLength(1);
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe("");

  await page.keyboard.press("w");
  await expect.poll(async () => (await getStats(page)).pdfVisualSelectionText).toBe("Alpha Beta Gamma");
});

test("keeps visual selection ordered when sample paragraph wraps to the next line", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const stats = await getStats(page);
    const cursor = stats.pdfCursor as { text?: string; top?: number } | null;
    if (cursor?.text === "modern" && Number(cursor.top) > 250) {
      break;
    }
    await page.keyboard.press("w");
  }
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "modern" });

  await page.keyboard.press("v");
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("w");
  }

  await expect
    .poll(async () => (await getStats(page)).pdfVisualSelectionText)
    .toBe("modern browsers work — focusing on Chromium's architecture and");
  const stats = await getStats(page);
  const rects = stats.pdfVisualSelectionRects as { left: number; top: number; width: number }[];
  expect(rects).toHaveLength(2);
  expect(rects[1].top).toBeGreaterThan(rects[0].top);
  expect(rects[0].left).toBeGreaterThan(rects[1].left);
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe("");
  const caretPosition = await page.evaluate(() => {
    const stats = window.__pdfSpike!.stats();
    const cursor = stats.pdfCursor as { left: number };
    const caret = document.querySelector<HTMLElement>(".pdf-text-caret");
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!caret) throw new Error("Missing PDF caret");
    if (!container) throw new Error("Missing PDF container");
    const caretRect = caret.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return caretRect.left - (containerRect.left + cursor.left - container.scrollLeft);
  });
  expect(Math.abs(caretPosition)).toBeLessThanOrEqual(3);
});

test("aligns the PDF caret to the current rendered word", async ({ page }) => {
  await loadFixture(page, visualOrderFixtureUrl(), "visual-order.pdf");
  await expect.poll(async () => Number((await getStats(page)).textLayerSpans)).toBeGreaterThan(0);

  await page.keyboard.press("p");
  await expect.poll(async () => (await getStats(page)).pdfCursor).toMatchObject({ text: "Alpha" });

  const alignment = await page.evaluate(() => {
    const stats = window.__pdfSpike!.stats();
    const cursor = stats.pdfCursor as {
      nodeIndex: number;
      nodeOffset: number;
      text: string;
    };
    const caret = document.querySelector<HTMLElement>(".pdf-text-caret");
    const textLayer = document.querySelector<HTMLElement>(".page[data-page-number=\"1\"] .textLayer");
    if (!caret || !textLayer) throw new Error("Missing caret or text layer");

    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    for (let index = 0; index <= cursor.nodeIndex; index += 1) {
      textNode = walker.nextNode() as Text | null;
    }
    if (!textNode) throw new Error("Missing cursor text node");

    const range = document.createRange();
    range.setStart(textNode, cursor.nodeOffset);
    range.setEnd(textNode, cursor.nodeOffset + cursor.text.length);
    const wordRect = range.getBoundingClientRect();
    range.detach();
    const caretRect = caret.getBoundingClientRect();
    return {
      dx: caretRect.left - wordRect.left,
      centerDy: caretRect.top + caretRect.height / 2 - (wordRect.top + wordRect.height / 2),
      caretHeight: caretRect.height,
      wordHeight: wordRect.height,
      caretWidth: caretRect.width,
    };
  });

  expect(Math.abs(alignment.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(alignment.centerDy)).toBeLessThanOrEqual(3);
  expect(alignment.caretHeight).toBeGreaterThanOrEqual(alignment.wordHeight);
  expect(alignment.caretWidth).toBeGreaterThanOrEqual(3);
});

test("extends a PDF text selection in visual mode", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
  });

  await page.keyboard.press("v");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "visualText",
  });

  await page.keyboard.press("w");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "visualText",
    selectedText: expect.any(String),
  });

  const stats = await getStats(page);
  expect(String(stats.selectedText).trim().length).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
    selectedText: "",
  });
});

test("scrolls half page and recenters the PDF cursor", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
  });

  const initial = await getStats(page);
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        code: "KeyD",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
    pdfCursor: expect.any(Object),
  });

  const moved = await getStats(page);
  expect(Number(moved.pdfScrollTop)).toBeGreaterThan(Number(initial.pdfScrollTop));
  expect((moved.pdfCursor as { pageNumber: number }).pageNumber).toBeGreaterThanOrEqual(1);
  expect(Number(moved.pdfCursorViewportTop)).toBeGreaterThanOrEqual(0);
  expect(Number(moved.pdfCursorViewportTop)).toBeLessThan(Number(moved.pdfViewportHeight));
});

test("creates a highlight from PDF visual mode selection", async ({ page }) => {
  await loadFixture(page);

  await page.keyboard.press("p");
  await page.keyboard.press("v");
  await page.keyboard.press("w");
  await page.keyboard.press("w");
  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "visualText",
    selectedText: expect.any(String),
  });
  await expect.poll(async () => String((await getStats(page)).selectedText).trim().length).toBeGreaterThan(0);

  const before = await getStats(page);
  await page.keyboard.press("Enter");

  await expect.poll(() => getStats(page)).toMatchObject({
    focusScope: "pdf",
    pdfMode: "normal",
  });
  await expect
    .poll(async () => Number((await getStats(page)).liveHighlightEditors))
    .toBeGreaterThan(Number(before.liveHighlightEditors));
});
