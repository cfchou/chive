import type { PDFViewer, PDFLinkService } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { AnnotationEditorUIManager, EditorTool } from "$lib/pdf/pdfjs-quirks";
import type { OutlineEntry, PdfDestination } from "$lib/pdf/outline-tree";
import type { BookmarkEntry } from "$lib/pdf/bookmarks";
import type { AnnotationEntry } from "$lib/pdf/annotation-sidebar";
import type { HighlightColorName, FreeTextColorName, InkColorName } from "$lib/pdf/colors";
import type { BookmarkRailRect } from "$lib/pdf/bookmark-rail-geometry";

export type PdfDocument = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;
export type SelectedAnnotationKind = "highlight" | "freetext" | "ink" | null;
export type FocusBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export class DocumentSession {
  // ---- pdf.js quartet ----
  pdfViewer: PDFViewer | null = null;
  pdfLinkService: PDFLinkService | null = null;
  pdfDocument = $state<PdfDocument | null>(null);
  annotationEditorUIManager: AnnotationEditorUIManager | null = null;
  eventBus: EventBus | null = null;

  // ---- DOM refs ----
  containerEl!: HTMLDivElement;
  viewerEl!: HTMLDivElement;
  savedScrollTop = 0;

  // ---- Per-document reactive state ----
  currentPath = $state("");
  isDirty = $state(false);
  isBusy = $state(false);
  status = $state("Open a PDF, add highlight/text/ink annotations, then save.");
  activeTool = $state<EditorTool>("none");
  zoomPercent = $state(100);
  scaleLabel = $state("Fit Width");

  // ---- Outline state ----
  outlineEntries = $state<OutlineEntry[]>([]);
  outlineStatus = $state("Open a PDF to inspect its outline.");
  outlineColorMenuId = $state<string | null>(null);
  collapsedOutlineIds = $state<string[]>([]);
  activeOutlineEntryId = $state<string | null>(null);
  lastActivatedOutlineEntry: OutlineEntry | null = null;

  // ---- Bookmark state ----
  bookmarkEntries = $state<BookmarkEntry[]>([]);
  bookmarkStatus = $state("Open a PDF to inspect bookmarks.");
  editingBookmarkId = $state<string | null>(null);
  activeBookmarkId = $state<string | null>(null);
  bookmarkColorMenuId = $state<string | null>(null);
  pendingBookmarkRailMarkerRects: BookmarkRailRect[] = [];
  bookmarkRailHoverCue = $state<{
    pageNumber: number;
    focusLeft: number;
    focusTop: number;
    hintLeft: number;
    hintTop: number;
  } | null>(null);
  hoveredBookmarkId = $state<string | null>(null);
  bookmarkRailLayoutVersion = $state(0);

  // ---- Annotation state ----
  annotationEntries = $state<AnnotationEntry[]>([]);
  annotationStatus = $state("Open a PDF to inspect annotations.");
  selectedAnnotationEntryId = $state<string | null>(null);
  selectedPersistedAnnotationKey: string | null = null;
  annotationFocusBox = $state<FocusBox | null>(null);
  lastAnnotationPointerClick: {
    entryId: string;
    timeStamp: number;
    clientX: number;
    clientY: number;
  } | null = null;
  selectedAnnotationKind = $state<SelectedAnnotationKind>(null);
  selectedAnnotationColor = $state<string | null>(null);
  hasSelectedHighlight = $state(false);
  selectedHighlightColor = $state<HighlightColorName | null>(null);

  // ---- Selection state ----
  rememberedSelectionText = "";
  rememberedSelectionRanges: Range[] = [];

  // ---- Non-reactive caches ----
  annotationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  annotationDetailCache = new Map<string, string>();
  pendingDeletedPersistedAnnotationKeys = new Set<string>();
  persistedAnnotationKeyByEditorId = new Map<string, string>();
  persistedPositionByKey = new Map<string, { top: number; left: number }>();

  destroy() {
    this.pdfViewer?.setDocument(null as never);
    (this.pdfDocument as { destroy?: () => void } | null)?.destroy?.();
    this.pdfViewer = null;
    this.pdfLinkService = null;
    this.pdfDocument = null;
    this.annotationEditorUIManager = null;
    this.eventBus = null;
    this.outlineEntries = [];
    this.outlineStatus = "Open a PDF to inspect its outline.";
    this.collapsedOutlineIds = [];
    this.activeOutlineEntryId = null;
    this.bookmarkEntries = [];
    this.bookmarkStatus = "Open a PDF to inspect bookmarks.";
    this.editingBookmarkId = null;
    this.activeBookmarkId = null;
    this.annotationEntries = [];
    this.annotationStatus = "Open a PDF to inspect annotations.";
    this.selectedAnnotationEntryId = null;
    this.selectedPersistedAnnotationKey = null;
    this.selectedAnnotationKind = null;
    this.selectedAnnotationColor = null;
    this.hasSelectedHighlight = false;
    this.selectedHighlightColor = null;
    this.activeTool = "none";
    this.lastActivatedOutlineEntry = null;
    this.annotationFocusBox = null;
    this.annotationDetailCache.clear();
    this.pendingDeletedPersistedAnnotationKeys.clear();
    this.persistedAnnotationKeyByEditorId.clear();
    this.persistedPositionByKey.clear();
    if (this.annotationRefreshTimer) {
      clearTimeout(this.annotationRefreshTimer);
      this.annotationRefreshTimer = null;
    }
    this.viewerEl?.replaceChildren();
  }
}
