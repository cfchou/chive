import type { AnnotationEntry } from "../pdf/annotation-sidebar";
import type { BookmarkEntry } from "../pdf/bookmarks";
import type { FreeTextColorName, HighlightColorName, InkColorName } from "../pdf/colors";
import type { OutlineEntry } from "../pdf/outline-tree";
import type { EditorTool } from "../pdf/pdfjs-quirks";

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
  /** Undo/redo on the active tab's editor manager (verifies per-tab history). */
  undo: () => void;
  redo: () => void;
  /** Test-only native drop-path driver; production uses the Tauri drop event. */
  openDroppedFilesForTest: (paths: string[]) => Promise<void>;
  settings: {
    open: (options?: { fixture?: boolean }) => void;
  };
  tabs: TabsDebugApi;
};

// Multi-tab driving surface for the test suites. Existing members above always
// target the active tab; these expose the tab list and let specs open, switch,
// close, and reorder Document Tabs.
export type TabDebugSummary = {
  id: string;
  label: string;
  path: string | null;
  dirty: boolean;
  active: boolean;
};
export type TabsDebugApi = {
  list: () => TabDebugSummary[];
  /** Open a path in a new tab (Tauri), focusing an existing tab with that path. */
  open: (path: string) => Promise<string>;
  /** Open raw bytes in a new tab; pass a path to enable dedupe/focus. */
  openBytes: (bytes: number[] | Uint8Array, label: string, path?: string | null) => Promise<string>;
  activate: (id: string) => Promise<void>;
  /** Force-close by default; pass force: false to exercise the unsaved-changes UI flow. */
  close: (id: string, options?: { force?: boolean }) => Promise<"closed" | "prompted">;
  reorder: (from: number, to: number) => void;
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
