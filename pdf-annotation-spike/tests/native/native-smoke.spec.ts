import { browser, expect } from "@wdio/globals";
import path from "node:path";

type WdioBrowser = {
  execute: <T, Arg = unknown>(script: (arg: Arg) => T | Promise<T>, arg?: Arg) => Promise<T>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  waitUntil: (
    condition: () => Promise<boolean>,
    options?: { timeout?: number; timeoutMsg?: string },
  ) => Promise<boolean>;
};

type AnnotationEntry = {
  detail: string;
  kind: "highlight" | "freetext" | "ink";
  page: number;
  sourceId: string;
  bounds: { top: number; bottom: number } | null;
};

const app = browser as unknown as WdioBrowser;
const samplePdfPath = path.resolve(process.cwd(), "static/sample.pdf");

async function waitForPdfSpike() {
  await app.waitUntil(
    async () => app.execute(() => Boolean((window as Window & { __pdfSpike?: unknown }).__pdfSpike)),
    {
      timeout: 30_000,
      timeoutMsg: "window.__pdfSpike was not initialized in native WKWebView",
    },
  );
}

describe("native WKWebView PDF smoke", () => {
  it("loads a PDF, extracts sidebar text, and creates annotation state", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, samplePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && String(stats.status ?? "").startsWith("Rendered ");
        }),
      {
        timeout: 30_000,
        timeoutMsg: await app.execute(() => {
          const stats = window.__pdfSpike?.stats();
          return `sample PDF did not render in native WKWebView: ${JSON.stringify(stats)}`;
        }),
      },
    );

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
          return entries.some((entry) => entry.kind === "highlight" && entry.detail !== "Persisted PDF annotation");
        }),
      {
        timeout: 30_000,
        timeoutMsg: await app.execute(() => {
          const entries = window.__pdfSpike?.annotationSidebarSummary() ?? [];
          return `native sidebar did not extract real annotation text: ${JSON.stringify(entries)}`;
        }),
      },
    );

    const annotationState = await app.execute(() => {
      const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
      return {
        usefulHighlight: entries.some(
          (entry) =>
            entry.kind === "highlight" &&
            entry.detail !== "Persisted PDF annotation" &&
            entry.detail.trim().length > 8,
        ),
        highlightCount: entries.filter((entry) => entry.kind === "highlight").length,
        freeTextCount: entries.filter((entry) => entry.kind === "freetext").length,
        inkCount: entries.filter((entry) => entry.kind === "ink").length,
      };
    });

    expect(annotationState.highlightCount).toBeGreaterThan(0);
    expect(annotationState.freeTextCount).toBeGreaterThan(0);
    expect(annotationState.inkCount).toBeGreaterThan(0);
    expect(annotationState.usefulHighlight).toBe(true);
  });

  it("locates persisted ink rows independently after adjacent ink clicks", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1640, 1010);

    const result = await app.execute(async (filePath) => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const entries = () => window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
      const clickAnnotationsTab = () => {
        [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")]
          .find((button) => button.textContent?.trim() === "Annotations")
          ?.click();
      };
      const pageBounds = (entry: AnnotationEntry) => {
        const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
        if (!pageElement || !entry.bounds) throw new Error(`Missing page bounds for ${entry.sourceId}`);
        return {
          top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight,
          bottom: pageElement.offsetTop + entry.bounds.bottom * pageElement.offsetHeight,
        };
      };
      const clickEntry = async (entry: AnnotationEntry) => {
        const rowIndex = entries().findIndex((candidate) => candidate.sourceId === entry.sourceId);
        const row = [...document.querySelectorAll(".annotation-item")][rowIndex];
        if (!(row instanceof HTMLElement)) throw new Error(`Annotation row not found for ${entry.sourceId}`);
        row.click();
        await sleep(1200);
        const stats = window.__pdfSpike!.stats();
        const box = stats.annotationFocusBox as { top: number; height: number } | null;
        if (!box) throw new Error(`Missing focus box for ${entry.sourceId}; stats=${JSON.stringify(stats)}`);
        return {
          top: box.top,
          bottom: box.top + box.height,
          activeTool: stats.activeTool,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
          expectedPersistedAnnotationKey: `${entry.page}:${entry.sourceId}`,
        };
      };
      const runPair = async (pageNumber: number, firstIndex: number, secondIndex: number) => {
        await window.__pdfSpike!.loadPath(filePath);
        await sleep(500);
        clickAnnotationsTab();
        await sleep(300);
        const inks = entries().filter((entry) => entry.page === pageNumber && entry.kind === "ink");
        if (inks.length <= Math.max(firstIndex, secondIndex)) {
          throw new Error(`Expected enough page ${pageNumber} ink rows; entries=${JSON.stringify(inks)}`);
        }
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
    }, samplePdfPath);

    for (const pairResult of result) {
      expect(pairResult.secondInk.top).toBeGreaterThan(pairResult.firstInk.top);
      expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
      expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
      expect(pairResult.firstInk.activeTool).toBe("none");
      expect(pairResult.secondInk.activeTool).toBe("none");
      expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(
        pairResult.firstInk.expectedPersistedAnnotationKey,
      );
      expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(
        pairResult.secondInk.expectedPersistedAnnotationKey,
      );
    }
  });
});
