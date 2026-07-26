import { numbersFromUnknown } from "../pdf/annotation-sidebar";
import type { AnnotationEditorUIManager, EditorTool } from "../pdf/pdfjs-quirks";
import type { SpikeDebugApi } from "./spike-api";

type DebugPdfDocument = {
  numPages: number;
  annotationStorage?: {
    size?: number;
    serializable?: { map?: Map<unknown, unknown> | null };
  };
  getPage: (
    pageNumber: number,
  ) => Promise<{
    getAnnotations: () => Promise<Record<string, unknown>[]>;
  }>;
};

type DebugPdfViewer = {
  currentPageNumber?: number;
};

export type DebugStatsSnapshot = {
  status: string;
  outlineStatus: string;
  activeTool: EditorTool;
  defaultHighlightColor: string;
  defaultFreeTextColor: string;
  defaultInkColor: string;
  defaultInkThickness: number;
  defaultInkOpacity: number;
  selectedAnnotationKind: string | null;
  selectedPersistedAnnotationKey: string | null;
  pendingDeletedPersistedAnnotationKeys: string[];
  selectedAnnotationColor: string | null;
  hasSelectedHighlight: boolean;
  selectedHighlightColor: string | null;
  annotationFocusBox: unknown;
};

type SpikeDebugHarnessDeps = {
  getPdfDocument: () => DebugPdfDocument | null;
  getPdfViewer: () => DebugPdfViewer | null;
  getAnnotationEditorUIManager: () => AnnotationEditorUIManager | null;
  getDomDocument: () => Document;
  getWindow: () => Window;
  getStatsSnapshot: () => DebugStatsSnapshot;
  persistPdf: (path: string) => Promise<void>;
  loadPdf: (path: string) => Promise<void>;
  loadPdfBytes: (bytes: Uint8Array, label: string) => Promise<void>;
  savePdfDocumentBytes: () => Promise<Uint8Array>;
  refreshAnnotationSidebar: () => Promise<void>;
  setCurrentPath: (path: string) => void;
  setDirty: (dirty: boolean) => void;
  setBusy: (busy: boolean) => void;
  setActiveTool: (tool: EditorTool) => void;
  setStatus: (status: string) => void;
  fetchUrl?: typeof fetch;
};

export type SpikeDebugHarness = Pick<
  SpikeDebugApi,
  "annotationSummary" | "editorSummary" | "loadPath" | "loadUrl" | "saveToPath" | "debugSavedBytes" | "stats"
>;

export function createSpikeDebugHarness(deps: SpikeDebugHarnessDeps): SpikeDebugHarness {
  const debugFileStore = new Map<string, Uint8Array>();

  function isTauriRuntime() {
    return "__TAURI_INTERNALS__" in deps.getWindow();
  }

  async function saveToPath(path: string) {
    if (isTauriRuntime()) {
      await deps.persistPdf(path);
      return;
    }
    if (!deps.getPdfDocument()) {
      throw new Error("No PDF loaded");
    }
    const saved = await deps.savePdfDocumentBytes();
    debugFileStore.set(path, saved);
    deps.setCurrentPath(path);
    deps.setDirty(false);
    await deps.refreshAnnotationSidebar();
    deps.setStatus(`Saved debug snapshot ${path}`);
  }

  function debugSavedBytes(path: string) {
    const bytes = debugFileStore.get(path);
    if (!bytes) throw new Error(`No debug snapshot stored for ${path}`);
    return Array.from(bytes);
  }

  async function loadPath(path: string) {
    if (isTauriRuntime()) {
      await deps.loadPdf(path);
      return;
    }
    const bytes = debugFileStore.get(path);
    if (!bytes) {
      throw new Error(`No debug snapshot stored for ${path}`);
    }
    await deps.loadPdfBytes(bytes.slice(), path);
    deps.setCurrentPath(path);
    deps.setDirty(false);
    deps.setActiveTool("none");
    await deps.refreshAnnotationSidebar();
    deps.setStatus(`Loaded debug snapshot ${path}`);
  }

  async function loadUrl(url: string, label = url) {
    deps.setBusy(true);
    deps.setStatus(`Loading ${label}...`);
    try {
      const response = await (deps.fetchUrl ?? fetch)(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await deps.loadPdfBytes(new Uint8Array(await response.arrayBuffer()), label);
      deps.setCurrentPath(label);
      deps.setDirty(false);
      deps.setActiveTool("none");
      await deps.refreshAnnotationSidebar();
      deps.setStatus(`Loaded ${label}`);
    } finally {
      deps.setBusy(false);
    }
  }

  async function annotationSummary() {
    const pdfDocument = deps.getPdfDocument();
    if (!pdfDocument) {
      return [];
    }
    const pages: Record<string, unknown>[] = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      const page = await pdfDocument.getPage(pageIndex + 1);
      const annotations = await page.getAnnotations();
      pages.push({
        page: pageIndex + 1,
        annotations: annotations.map((annotation: Record<string, unknown>) => ({
          annotationType: annotation.annotationType,
          borderStyle: "borderStyle" in annotation ? annotation.borderStyle : null,
          color: "color" in annotation ? numbersFromUnknown(annotation.color) : null,
          contentsObj: "contentsObj" in annotation ? annotation.contentsObj : null,
          defaultAppearanceData:
            "defaultAppearanceData" in annotation ? annotation.defaultAppearanceData : null,
          id: annotation.id,
          opacity: "opacity" in annotation ? annotation.opacity : null,
          popupRef: "popupRef" in annotation ? annotation.popupRef : null,
          quadPoints: "quadPoints" in annotation ? numbersFromUnknown(annotation.quadPoints) : null,
          rect: "rect" in annotation ? numbersFromUnknown(annotation.rect) : null,
          subtype: "subtype" in annotation ? annotation.subtype : null,
          it: "it" in annotation ? annotation.it : null,
          textContent: "textContent" in annotation ? annotation.textContent : null,
        })),
      });
    }
    return pages;
  }

  function editorSummary() {
    const annotationEditorUIManager = deps.getAnnotationEditorUIManager();
    const pdfDocument = deps.getPdfDocument();
    if (!annotationEditorUIManager || !pdfDocument) {
      return [];
    }
    const selectedEditorId = deps.getDomDocument().querySelector<HTMLElement>(".selectedEditor")?.id ?? null;
    const entries: Record<string, unknown>[] = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        entries.push({
          color: editor.color ?? null,
          annotationElementId: editor.annotationElementId ?? null,
          deleted: editor.deleted ?? false,
          editorType: editor.editorType,
          hasBeenModified: editor.hasBeenModified ?? false,
          id: editor.id,
          isDomSelected: editor.id === selectedEditorId,
          isFirstSelectedEditor: annotationEditorUIManager.firstSelectedEditor?.id === editor.id,
          page: pageIndex + 1,
          pageIndex: editor.pageIndex ?? null,
        });
      }
    }
    return entries;
  }

  function stats() {
    const pdfDocument = deps.getPdfDocument();
    const storage = pdfDocument?.annotationStorage;
    const selectedEditor = deps.getAnnotationEditorUIManager()?.firstSelectedEditor;
    const document = deps.getDomDocument();
    return {
      pages: pdfDocument?.numPages ?? 0,
      currentPageNumber: deps.getPdfViewer()?.currentPageNumber ?? null,
      ...deps.getStatsSnapshot(),
      selectedEditorType: selectedEditor?.editorType ?? null,
      selectedEditorColor: selectedEditor?.color ?? null,
      selectedText: document.getSelection()?.toString() ?? "",
      canvases: document.querySelectorAll(".page canvas").length,
      textLayerSpans: document.querySelectorAll(".textLayer span").length,
      annotationEditorLayers: document.querySelectorAll(".annotationEditorLayer").length,
      highlightEditors: document.querySelectorAll(".highlightEditor").length,
      freeTextEditors: document.querySelectorAll(".freeTextEditor").length,
      inkEditors: document.querySelectorAll(".inkEditor").length,
      visibleEditorToolbars: document.querySelectorAll(".editToolbar:not(.hidden)").length,
      annotationStorageSize: storage?.size ?? 0,
      annotationStorageKeys: storage?.serializable?.map ? [...storage.serializable.map.keys()] : [],
    };
  }

  return {
    annotationSummary,
    debugSavedBytes,
    editorSummary,
    loadPath,
    loadUrl,
    saveToPath,
    stats,
  };
}
