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

type OutlineEntry = {
  title: string;
  pageNumber: number | null;
  color?: string | null;
  destinationStatus: string | null;
};

const app = browser as unknown as WdioBrowser;
const samplePdfPath = path.resolve(process.cwd(), "static/sample.pdf");
const noOutlinePdfPath = path.resolve(process.cwd(), "static/no-outline.pdf");
const brokenOutlinePdfPath = path.resolve(process.cwd(), "static/broken-outline.pdf");
const coloredOutlinePdfPath = path.resolve(process.cwd(), "static/colored-outline.pdf");
const bookmarkPdfPath = "/tmp/pdfspike-native-bookmark.pdf";

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

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")]
        .find((button) => button.textContent?.trim() === "Annotations")
        ?.click();
    }, samplePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
          return (
            entries.filter((entry) => entry.page === 2 && entry.kind === "ink").length >= 3 &&
            entries.filter((entry) => entry.page === 3 && entry.kind === "ink").length >= 2
          );
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native sample PDF did not expose enough persisted ink rows",
      },
    );

    const inks = await app.execute(() => {
      const pageBounds = (entry: AnnotationEntry) => {
        const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
        if (!pageElement || !entry.bounds) throw new Error(`Missing page bounds for ${entry.sourceId}`);
        return {
          top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight,
          bottom: pageElement.offsetTop + entry.bounds.bottom * pageElement.offsetHeight,
        };
      };
      return (window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[])
        .filter((entry) => entry.kind === "ink" && (entry.page === 2 || entry.page === 3))
        .map((entry) => ({
          ...entry,
          expected: pageBounds(entry),
        }));
    });

    const activateInk = async (entry: (typeof inks)[number]) => {
      const activated = await app.execute(
        async (sourceId) => window.__pdfSpike!.activateAnnotationBySourceId(sourceId),
        entry.sourceId,
      );
      expect(activated).toBe(true);
      await app.waitUntil(
        async () =>
          app.execute(
            ({ pageNumber, sourceId }) => {
              const stats = window.__pdfSpike!.stats();
              const box = stats.annotationFocusBox as { top: number; height: number } | null;
              return Boolean(
                box &&
                  stats.activeTool === "none" &&
                  stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}`,
              );
            },
            { pageNumber: entry.page, sourceId: entry.sourceId },
          ),
        {
          timeout: 10_000,
          timeoutMsg: `native ink row did not focus: ${entry.sourceId}`,
        },
      );
      return app.execute(() => {
        const stats = window.__pdfSpike!.stats();
        const box = stats.annotationFocusBox as { top: number; height: number } | null;
        if (!box) throw new Error(`Missing focus box; stats=${JSON.stringify(stats)}`);
        return {
          top: box.top,
          bottom: box.top + box.height,
          activeTool: stats.activeTool,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        };
      });
    };

    const inkAt = (pageNumber: number, index: number) => {
      const entry = inks.filter((candidate) => candidate.page === pageNumber)[index];
      if (!entry) throw new Error(`Missing page ${pageNumber} ink row ${index + 1}; entries=${JSON.stringify(inks)}`);
      return entry;
    };

    const pairs = [
      [inkAt(2, 0), inkAt(2, 1)],
      [inkAt(2, 1), inkAt(2, 2)],
      [inkAt(3, 0), inkAt(3, 1)],
    ] as const;

    const result = [];
    for (const [first, second] of pairs) {
      result.push({
        firstInk: await activateInk(first),
        secondInk: await activateInk(second),
        firstExpected: first.expected,
        secondExpected: second.expected,
        firstExpectedPersistedAnnotationKey: `${first.page}:${first.sourceId}`,
        secondExpectedPersistedAnnotationKey: `${second.page}:${second.sourceId}`,
      });
    }

    for (const pairResult of result) {
      expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
      expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
      expect(pairResult.firstInk.activeTool).toBe("none");
      expect(pairResult.secondInk.activeTool).toBe("none");
      expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(
        pairResult.firstExpectedPersistedAnnotationKey,
      );
      expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(
        pairResult.secondExpectedPersistedAnnotationKey,
      );
    }
  });

  it("handles missing and broken outline destinations in native WKWebView", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, noOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && window.__pdfSpike!.outlineSummary().length === 0;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native no-outline PDF did not render with an empty outline",
      },
    );

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, brokenOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && String(stats.status ?? "").startsWith("Rendered ");
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native broken-outline PDF did not render",
      },
    );

    const state = await app.execute(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")]
        .find((button) => button.textContent?.trim() === "Outline")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const entries = window.__pdfSpike!.outlineSummary() as OutlineEntry[];
      const brokenEntry = entries.find((entry) => entry.title === "How Modern Browsers Work");
      const validEntry = entries.find((entry) => entry.title === "1. Networking and Resource Loading");
      const validButton = [...document.querySelectorAll<HTMLButtonElement>(".outline-item")].find((button) =>
        button.textContent?.includes("1. Networking and Resource Loading"),
      );
      validButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      return {
        entries,
        emptyStateText: document.querySelector(".empty-state")?.textContent?.trim() ?? null,
        brokenStatus: brokenEntry?.destinationStatus ?? null,
        hasValidOutlineItem: Boolean(validButton && !validButton.disabled),
        validPageNumber: validEntry?.pageNumber ?? null,
        currentPageNumber: window.__pdfSpike!.stats().currentPageNumber,
      };
    });

    if (state.hasValidOutlineItem) {
      if (state.brokenStatus !== null) {
        expect(state.brokenStatus).toBe("Destination unavailable");
      }
      expect(state.validPageNumber).toBeGreaterThan(0);
      expect(state.currentPageNumber).toBeGreaterThan(0);
    } else {
      expect(state.entries).toHaveLength(0);
      expect(state.emptyStateText === "This PDF has no outline." || state.emptyStateText === null).toBe(true);
    }

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, coloredOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const redEntry = (window.__pdfSpike!.outlineSummary() as OutlineEntry[]).find(
            (entry) => entry.title === "Red Outline",
          );
          return redEntry?.color === "#f04444";
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native colored outline PDF did not expose outline /C color",
      },
    );
  });

  it("creates, reloads, and navigates PDF-native bookmarks in native WKWebView", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (samplePath) => {
      await window.__pdfSpike!.loadPath(samplePath);
    }, samplePdfPath);
    await app.waitUntil(
      async () =>
        app.execute(
          () => Number(window.__pdfSpike!.stats().pages ?? 0) > 0 && window.__pdfSpike!.outlineSummary().length > 0,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "native sample PDF did not render with outline",
      },
    );

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")].find(
          (button) => button.textContent?.trim() === label,
        );
      tab("Outline")?.click();
      const outlineButton = [...document.querySelectorAll<HTMLButtonElement>(".outline-item")].find((button) =>
        button.textContent?.includes("JIT tiers table"),
      );
      if (!outlineButton) throw new Error("Missing JIT tiers table outline button");
      outlineButton.click();
    });
    await app.waitUntil(async () => app.execute(() => window.__pdfSpike!.stats().currentPageNumber === 13), {
      timeout: 30_000,
      timeoutMsg: "native outline navigation failed",
    });

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")].find(
          (button) => button.textContent?.trim() === label,
        );
      tab("Bookmarks")?.click();
    });
    await app.waitUntil(
      async () => app.execute(() => Boolean(document.querySelector<HTMLButtonElement>("[aria-label='Add bookmark']"))),
      {
        timeout: 10_000,
        timeoutMsg: "native add bookmark button did not appear",
      },
    );
    await app.execute(() => {
      document.querySelector<HTMLButtonElement>("[aria-label='Add bookmark']")?.click();
    });
    await app.waitUntil(
      async () =>
        app.execute(() => Boolean(document.querySelector<HTMLInputElement>("input[aria-label='Bookmark title']"))),
      {
        timeout: 10_000,
        timeoutMsg: "native bookmark title input did not appear",
      },
    );
    await app.execute(() => {
      const input = document.querySelector<HTMLInputElement>("input[aria-label='Bookmark title']");
      if (!input) throw new Error("Missing bookmark title input");
      input.value = "Native bookmark";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: "Native bookmark",
          inputType: "insertText",
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
        }),
      );
    });
    await app.execute(async (outputPath) => {
      await window.__pdfSpike!.saveToPath(outputPath);
    }, bookmarkPdfPath);
    await app.execute(async (outputPath) => {
      await window.__pdfSpike!.loadPath(outputPath);
    }, bookmarkPdfPath);
    await app.waitUntil(async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0), {
      timeout: 30_000,
      timeoutMsg: "native bookmark PDF did not reload",
    });

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")].find(
          (button) => button.textContent?.trim() === label,
        );
      tab("Bookmarks")?.click();
    });
    await app.waitUntil(
      async () =>
        app.execute(() =>
          Boolean(
            [...document.querySelectorAll<HTMLButtonElement>(".bookmark-item")].find((button) =>
              button.textContent?.includes("Native bookmark"),
            ),
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "native bookmark row did not appear after reload",
      },
    );

    const state = await app.execute(() => {
      const bookmarkButton = [...document.querySelectorAll<HTMLButtonElement>(".bookmark-title-button")].find((button) =>
        button.textContent?.includes("Native bookmark"),
      );
      bookmarkButton?.click();
      return {
        hasBookmarkRow: Boolean(bookmarkButton),
      };
    });
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const container = document.querySelector<HTMLElement>(".pdf-container");
          const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
          if (!container || !pageElement) return false;
          const containerRect = container.getBoundingClientRect();
          const pageRect = pageElement.getBoundingClientRect();
          return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native bookmark navigation failed",
      },
    );

    expect(state.hasBookmarkRow).toBe(true);
    expect(
      await app.execute(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
        if (!container || !pageElement) return false;
        const containerRect = container.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
      }),
    ).toBe(true);
  });
});
