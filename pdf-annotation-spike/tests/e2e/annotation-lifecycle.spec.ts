import { expect, test } from "@playwright/test";
import {
  activateFirstAnnotationByKind,
  createFreeText,
  createHighlight,
  createInkStroke,
  loadFixture,
  openApp,
  pageAnnotations,
  saveAndReopen,
} from "./helpers/pdf-spike";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadFixture(page);
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
  expect(annotations.filter((entry) => entry.subtype === "FreeText")).toHaveLength(baseline + 1);

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

test("creates and persists ink annotation", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Ink").length;

  await createInkStroke(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-ink.pdf");

  const annotations = await pageAnnotations(page);
  const inks = annotations.filter((entry) => entry.subtype === "Ink");
  expect(inks).toHaveLength(baseline + 1);
  expect(inks.some((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 3)).toBe(true);
});
