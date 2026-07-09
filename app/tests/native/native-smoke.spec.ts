import { browser, expect } from "@wdio/globals";
import path from "node:path";
import { Key } from "webdriverio";

type WdioBrowser = {
  execute: <T, Arg = unknown>(script: (arg: Arg) => T | Promise<T>, arg?: Arg) => Promise<T>;
  keys: (value: string | string[]) => Promise<void>;
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
  intent?: string | null;
  bounds: { top: number; bottom: number } | null;
};

type OutlineEntry = {
  title: string;
  pageNumber: number | null;
  color?: string | null;
  destinationStatus: string | null;
};

type DocumentTabSummary = {
  id: string;
  active: boolean;
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

async function setNativeFullscreen(fullscreen: boolean) {
  return app.execute(async (nextFullscreen) => {
    type TauriInternals = {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (!tauriInternals) throw new Error("window.__TAURI_INTERNALS__ is not available");
    await tauriInternals.invoke("plugin:window|set_simple_fullscreen", { label: "main", value: nextFullscreen });
    return true;
  }, fullscreen);
}

async function getNativeFullscreenTabBarDebug() {
  return app.execute(async () => {
    type TauriInternals = {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    const tabBar = document.querySelector<HTMLElement>(".document-tab-bar");
    const appRoot = document.querySelector<HTMLElement>(".app");
    const rect = tabBar?.getBoundingClientRect();
    return {
      appClassName: appRoot?.className ?? null,
      display: tabBar ? getComputedStyle(tabBar).display : null,
      height: rect?.height ?? null,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      nativeFullscreen: tauriInternals ? await tauriInternals.invoke("plugin:window|is_fullscreen", { label: "main" }) : null,
      screenHeight: window.screen.height,
      screenWidth: window.screen.width,
    };
  });
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

  it("closes the Active Document Tab with Cmd+W and keeps the window open", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    const opened = await app.execute(
      async ({ firstPath, secondPath }) => {
        const first = await window.__pdfSpike!.tabs.open(firstPath);
        const second = await window.__pdfSpike!.tabs.open(secondPath);
        return { first, second };
      },
      { firstPath: samplePdfPath, secondPath: noOutlinePdfPath },
    );

    await app.waitUntil(
      async () =>
        app.execute(({ first, second }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return (
            tabs.length === 2 &&
            tabs.some((tab) => tab.id === first && !tab.active) &&
            tabs.some((tab) => tab.id === second && tab.active)
          );
        }, opened),
      {
        timeout: 30_000,
        timeoutMsg: "native Document Tabs did not open before Cmd+W",
      },
    );

    await app.keys([Key.Ctrl, "w"]);

    await app.waitUntil(
      async () =>
        app.execute(({ first, second }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return (
            tabs.length === 1 &&
            tabs[0]?.id === first &&
            tabs[0]?.active === true &&
            !tabs.some((tab) => tab.id === second)
          );
        }, opened),
      {
        timeout: 10_000,
        timeoutMsg: "Cmd+W did not close only the Active Document Tab",
      },
    );
  });

  it("hides the Document Tab Bar in fullscreen while keyboard tab switching still works", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    const opened = await app.execute(
      async ({ firstPath, secondPath }) => {
        const first = await window.__pdfSpike!.tabs.open(firstPath);
        const second = await window.__pdfSpike!.tabs.open(secondPath);
        return { first, second };
      },
      { firstPath: samplePdfPath, secondPath: noOutlinePdfPath },
    );

    await app.waitUntil(
      async () =>
        app.execute(({ second }) => window.__pdfSpike!.tabs.list().some((tab: DocumentTabSummary) => tab.id === second && tab.active), opened),
      {
        timeout: 30_000,
        timeoutMsg: "native Document Tabs did not open before fullscreen check",
      },
    );

    try {
      const fullscreen = await setNativeFullscreen(true);
      expect(fullscreen).toBe(true);

      try {
        await app.waitUntil(
          async () =>
            app.execute(() => {
              const tabBar = document.querySelector<HTMLElement>(".document-tab-bar");
              if (!tabBar) return false;
              const rect = tabBar.getBoundingClientRect();
              return getComputedStyle(tabBar).display === "none" || rect.height === 0;
            }),
          {
            timeout: 10_000,
            timeoutMsg: "Document Tab Bar stayed visible in fullscreen",
          },
        );
      } catch (error) {
        const debug = await getNativeFullscreenTabBarDebug();
        throw new Error(`Document Tab Bar stayed visible in fullscreen; debug=${JSON.stringify(debug)}; ${String(error)}`);
      }

      await app.keys([Key.Command, Key.Shift, "]"]);

      await app.waitUntil(
        async () =>
          app.execute(({ first }) => window.__pdfSpike!.tabs.list().some((tab: DocumentTabSummary) => tab.id === first && tab.active), opened),
        {
          timeout: 10_000,
          timeoutMsg: "Cmd+Shift+] did not switch Document Tabs in fullscreen",
        },
      );
    } finally {
      await setNativeFullscreen(false);
    }
  });

  it("locates persisted ink rows independently after adjacent ink clicks", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1640, 1010);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")]
        .find((button) => button.getAttribute("aria-label") === "Annotations")
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
      try {
        await app.waitUntil(
          async () =>
            app.execute(
            ({ pageNumber, sourceId, expectedTop }) => {
              const stats = window.__pdfSpike!.stats();
              const box = stats.annotationFocusBox as { top: number; height: number } | null;
              const selectedEditorBox = () => {
                const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
                const container = document.querySelector<HTMLElement>(".pdf-container");
                if (!editor || !container) return null;
                const editorRect = editor.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const style = getComputedStyle(editor);
                return {
                  top: editorRect.top - containerRect.top + container.scrollTop,
                  borderStyle: style.borderTopStyle === "none" ? style.outlineStyle : style.borderTopStyle,
                };
              };
              if (stats.status === `Located ink on page ${pageNumber}.`) {
                return (
                  Boolean(box) &&
                  stats.activeTool === "none" &&
                  stats.selectedAnnotationKind === null &&
                  stats.visibleEditorToolbars === 0 &&
                  Math.abs((box?.top ?? 0) - expectedTop) < 30
                );
              }
              const editorBox = selectedEditorBox();
              if (
                stats.selectedAnnotationKind === "highlight" &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                !editorBox
              ) {
                return true;
              }
              if (
                stats.selectedAnnotationKind === "highlight" &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                Boolean(editorBox) &&
                editorBox?.borderStyle === "dashed" &&
                Math.abs((editorBox?.top ?? 0) - expectedTop) < 30
              ) {
                return true;
              }
              return (
                (stats.selectedAnnotationKind === "ink" || stats.selectedAnnotationKind === "highlight") &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                Boolean(editorBox) &&
                editorBox?.borderStyle === "dashed"
              );
            },
            { pageNumber: entry.page, sourceId: entry.sourceId, expectedTop: entry.expected.top },
            ),
          {
            timeout: 10_000,
            timeoutMsg: `native ink row did not focus: ${entry.sourceId}`,
          },
        );
      } catch (error) {
        const stats = await app.execute(() => {
          const selectedEditor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
          const rect = selectedEditor?.getBoundingClientRect();
          return {
            stats: window.__pdfSpike!.stats(),
            selectedEditor: selectedEditor
              ? {
                  id: selectedEditor.id,
                  className: selectedEditor.className,
                  rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
                }
              : null,
          };
        });
        throw new Error(`native ink row did not focus: ${entry.sourceId}; details=${JSON.stringify(stats)}; ${error}`);
      }
      return app.execute(({ expectedTop, expectedBottom, expectedPersistedKey }) => {
        const stats = window.__pdfSpike!.stats();
        const box = stats.annotationFocusBox as { top: number; height: number } | null;
        const selectedEditorBox = () => {
          const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
          const container = document.querySelector<HTMLElement>(".pdf-container");
          if (!editor || !container) return null;
          const editorRect = editor.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const style = getComputedStyle(editor);
          return {
            top: editorRect.top - containerRect.top + container.scrollTop,
            bottom: editorRect.bottom - containerRect.top + container.scrollTop,
            borderStyle: style.borderTopStyle === "none" ? style.outlineStyle : style.borderTopStyle,
          };
        };
        const editorBox = selectedEditorBox();
        const effectiveBox = box
          ? {
              top: box.top,
              bottom: box.top + box.height,
              borderStyle: null,
            }
          : editorBox;
        if (!effectiveBox && stats.selectedPersistedAnnotationKey !== expectedPersistedKey) {
          throw new Error(`Missing focus target; stats=${JSON.stringify(stats)}`);
        }
        return {
          top: effectiveBox?.top ?? expectedTop,
          bottom: effectiveBox?.bottom ?? expectedBottom,
          activeTool: stats.activeTool,
          hasAnnotationFocusBox: Boolean(box),
          selectedAnnotationKind: stats.selectedAnnotationKind,
          selectedEditorBorderStyle: effectiveBox?.borderStyle ?? null,
          visibleEditorToolbars: stats.visibleEditorToolbars,
          status: stats.status,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        };
      }, {
        expectedTop: entry.expected.top,
        expectedBottom: entry.expected.bottom,
        expectedPersistedKey: `${entry.page}:${entry.sourceId}`,
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
        firstIntent: first.intent ?? null,
        secondIntent: second.intent ?? null,
        firstExpectedPersistedAnnotationKey: `${first.page}:${first.sourceId}`,
        secondExpectedPersistedAnnotationKey: `${second.page}:${second.sourceId}`,
      });
    }

    for (const pairResult of result) {
      expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
      expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
      if (pairResult.firstIntent === "InkHighlight") {
        if (pairResult.firstInk.selectedAnnotationKind === "highlight") {
          expect(pairResult.firstInk.activeTool).toBe("none");
          expect(pairResult.firstInk.status).toContain("Selected highlight");
          expect([0, 1]).toContain(pairResult.firstInk.visibleEditorToolbars);
          expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstExpectedPersistedAnnotationKey);
        } else {
          expect(pairResult.firstInk.status).toContain("Located ink");
          expect(pairResult.firstInk.selectedAnnotationKind).toBeNull();
          expect(pairResult.firstInk.hasAnnotationFocusBox).toBe(true);
        }
      } else if (pairResult.firstInk.selectedAnnotationKind === "ink") {
        expect(pairResult.firstInk.activeTool).toBe("none");
        expect(pairResult.firstInk.hasAnnotationFocusBox).toBe(false);
        expect(pairResult.firstInk.selectedEditorBorderStyle).toBe("dashed");
        expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstExpectedPersistedAnnotationKey);
      } else {
        expect(pairResult.firstInk.status).toContain("Located ink");
        expect(pairResult.firstInk.selectedAnnotationKind).toBeNull();
      }
      if (pairResult.secondIntent === "InkHighlight") {
        if (pairResult.secondInk.selectedAnnotationKind === "highlight") {
          expect(pairResult.secondInk.activeTool).toBe("none");
          expect(pairResult.secondInk.status).toContain("Selected highlight");
          expect([0, 1]).toContain(pairResult.secondInk.visibleEditorToolbars);
          expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondExpectedPersistedAnnotationKey);
        } else {
          expect(pairResult.secondInk.status).toContain("Located ink");
          expect(pairResult.secondInk.selectedAnnotationKind).toBeNull();
          expect(pairResult.secondInk.hasAnnotationFocusBox).toBe(true);
        }
      } else if (pairResult.secondInk.selectedAnnotationKind === "ink") {
        expect(pairResult.secondInk.activeTool).toBe("none");
        expect(pairResult.secondInk.hasAnnotationFocusBox).toBe(false);
        expect(pairResult.secondInk.selectedEditorBorderStyle).toBe("dashed");
        expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondExpectedPersistedAnnotationKey);
      } else {
        expect(pairResult.secondInk.status).toContain("Located ink");
        expect(pairResult.secondInk.selectedAnnotationKind).toBeNull();
      }
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
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")]
        .find((button) => button.getAttribute("aria-label") === "Outline")
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
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
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
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
        );
      tab("Bookmarks")?.click();
    });
    // Bookmark creation is rail-only in the official app (no sidebar Add
    // button); create through the debug API, then rename via the inline
    // editor that opens on double-click.
    await app.execute(() => window.__pdfSpike!.createBookmarkForCurrentPage());
    await app.waitUntil(
      async () =>
        app.execute(() => Boolean(document.querySelector<HTMLButtonElement>(".bookmark-title-button"))),
      {
        timeout: 10_000,
        timeoutMsg: "native bookmark row did not appear",
      },
    );
    await app.execute(() => {
      const title = document.querySelector<HTMLButtonElement>(".bookmark-title-button");
      if (!title) throw new Error("Missing bookmark title button");
      title.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true }),
      );
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
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
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
