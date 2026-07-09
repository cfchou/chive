import type { AnnotationEntry } from "../pdf/annotation-sidebar";
import type { BookmarkEntry } from "../pdf/bookmarks";
import type { FreeTextColorName, HighlightColorName, InkColorName } from "../pdf/colors";
import type { OutlineEntry } from "../pdf/outline-tree";
import type { EditorTool } from "../pdf/pdfjs-quirks";

export type DocumentTabDebugSummary = {
  id: string;
  label: string;
  path: string | null;
  dirty: boolean;
  active: boolean;
};

// The app's automated tests (Playwright in tests/e2e, native WKWebView in
// tests/native) run against the real UI but cannot reach into Svelte component
// state from outside the page. The page therefore publishes this API on
// window.__pdfSpike, and specs drive it via page.evaluate()/execute() to load
// fixtures, create annotations, and read back what the sidebar derived.
//
// Treat every member name and signature as a public contract: the test suites
// are the consumers, so renaming or removing a member breaks tests/e2e and
// tests/native even though the app itself never calls this API.
export type SpikeDebugApi = {
  annotationSummary: () => Promise<Record<string, unknown>[]>;
  annotationSidebarSummary: () => AnnotationEntry[];
  bookmarkSummary: () => BookmarkEntry[];
  outlineSummary: () => OutlineEntry[];
  activateFirstOutlineItem: () => Promise<boolean>;
  activateFirstAnnotationItem: () => Promise<boolean>;
  activateAnnotationBySourceId: (sourceId: string) => Promise<boolean>;
  createBookmarkForCurrentPage: () => Promise<void>;
  createPageFreeText: (text?: string, pageNumber?: number) => Promise<boolean>;
  createSelectionHighlightInToolMode: () => Promise<boolean>;
  editorSummary: () => Record<string, unknown>[];
  loadSample: () => Promise<void>;
  loadPath: (path: string) => Promise<void>;
  loadUrl: (url: string, label?: string) => Promise<void>;
  saveToPath: (path: string) => Promise<void>;
  selectFirstHighlight: () => Promise<boolean>;
  selectFirstText: () => string;
  recolorSelectedHighlight: (color: HighlightColorName) => void;
  recolorSelectedFreeText: (color: FreeTextColorName) => void;
  recolorSelectedInk: (color: InkColorName) => void;
  setInkThickness: (thickness: number) => void;
  setFreeTextFontSize: (size: number) => void;
  setInkMarkerPreset: () => void;
  moveSelected: (x: number, y: number) => boolean;
  editSelectedFreeText: (text: string) => Promise<boolean>;
  deleteSelected: () => boolean;
  debugSavedBytes: (path: string) => number[];
  stats: () => Record<string, unknown>;
  setTool: (tool: EditorTool) => void;
  requestWindowCloseForTest: () => Promise<"closed" | "prompted">;
  openDroppedFilesForTest: (paths: string[]) => Promise<void>;
  tabs: {
    list: () => DocumentTabDebugSummary[];
    open: (path: string) => Promise<string>;
    openBytes: (bytes: Uint8Array, label: string) => Promise<string>;
    activate: (id: string) => Promise<void>;
    close: (id: string, opts?: { force?: boolean }) => Promise<"closed" | "prompted">;
    reorder: (from: number, to: number) => void;
  };
};

export type SpikeDebugTarget = {
  __pdfSpike?: SpikeDebugApi;
};

// Publishes the api on the target (the real window in the app, a plain object
// in unit tests) and returns the teardown the page calls when the component is
// destroyed, so a stale api can never outlive the state it closes over. The
// parameter is typed `object` rather than SpikeDebugTarget because TypeScript
// rejects passing `window` to a type whose only property is optional (the
// "weak type" rule); casting once here keeps every caller cast-free.
export function installSpikeDebugApi(target: object, api: SpikeDebugApi) {
  const debugTarget = target as SpikeDebugTarget;
  debugTarget.__pdfSpike = api;
  return () => {
    delete debugTarget.__pdfSpike;
  };
}
