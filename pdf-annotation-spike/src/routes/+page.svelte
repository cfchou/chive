<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount, tick } from "svelte";
  import AnnotationsSidebar from "$lib/pdf/AnnotationsSidebar.svelte";
  import * as pdfjsLib from "pdfjs-dist";
  import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
  import inkCursorUrl from "pdfjs-dist/web/images/cursor-editorInk.svg?url";
  import {
    EventBus,
    PDFLinkService,
    PDFViewer,
  } from "pdfjs-dist/web/pdf_viewer.mjs";
  import "pdfjs-dist/web/pdf_viewer.css";
  import {
    annotationKindForSubtype,
    boundsOverlapRatio,
    buildLiveAnnotationEntries,
    buildPdfAnnotationEntries,
    numbersFromNumericRecord,
    numbersFromUnknown,
    rectCenterDistance,
    rectLikesOverlap,
    rectToPagePercent,
    type AnnotationEntry,
    type RectLike,
  } from "$lib/pdf/annotation-sidebar";
  import { sortBookmarkEntries, type BookmarkEntry } from "$lib/pdf/bookmarks";
  import {
    createEditorTypeGuards,
    editorBelongsToManager,
    editorHasValidManagerSignal,
    isUsableAbortSignal,
    managerHasValidSignal,
    selectEditorIgnoringPdfjsSignalBug,
    unselectAllIgnoringPdfjsSignalBug as unselectAllForManagerIgnoringSignalBug,
    type AnnotationEditor,
    type AnnotationEditorLayerRef,
    type AnnotationEditorUIManager,
    type EditorTool,
  } from "$lib/pdf/pdfjs-quirks";
  import { installSpikeDebugApi } from "$lib/debug/spike-api";
  import {
    annotationCountLabel,
    bookmarkCountLabel,
    firstWords,
    formatError,
  } from "$lib/format";
  import { writePdfOutlineState } from "$lib/pdf/outline-byte-writer";
  import {
    countOutlineEntries,
    countUnavailableOutlineEntries,
    explicitDestinationRef,
    flattenOutlineEntries,
    isOutlineEntryNavigable,
    outlineDestinationStatus,
    pdfRefString,
    updateOutlineEntryColor,
    visibleActiveOutlineEntryId,
    type OutlineEntry,
    type PdfDestination,
  } from "$lib/pdf/outline-tree";
  import {
    pdfAnnotationElementId,
    persistedAnnotationKey,
    persistedAnnotationKeyParts,
    sourceIdFromPdfAnnotationElementId,
  } from "$lib/pdf/annotation-keys";
  import {
    bookmarkPalette,
    defaultBookmarkColor,
    freeTextColorNameForValue,
    freeTextColors,
    hexToRgba,
    highlightColorNameForValue,
    highlightColors,
    inkColorNameForValue,
    inkColors,
    normalizeOutlineColor,
    outlinePalette,
    type FreeTextColorName,
    type HighlightColorName,
    type InkColorName,
  } from "$lib/pdf/colors";
  import {
    bookmarkAnchorInsetForScale,
    bookmarkAnchorYForInset,
    bookmarkDestinationYForInset,
    bookmarkRailAddCueOffsetPx,
    bookmarkRailAddCueSizePx,
    bookmarkRailAnchorHeightPx,
    bookmarkRailAnchorWidthPx,
    bookmarkRailFocusCueSizePx,
    bookmarkRailRectsConflict,
    offsetIntoPageForTargetY,
    railMarkerContentRectForOffset,
    railMarkerRectAt,
    renderedPageScale,
    targetYForOffsetIntoPage,
    withinSquareCue,
    type BookmarkRailRect,
  } from "$lib/pdf/bookmark-rail-geometry";

  if (import.meta.env.VITE_WDIO_TAURI === "1" && typeof window !== "undefined") {
    void import("@wdio/tauri-plugin");
  }

  type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
  type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
  type NavigationTab = "outline" | "bookmarks" | "annotations";
  type SelectedAnnotationKind = "highlight" | "freetext" | "ink" | null;
  type PdfOutlineRaw = {
    title?: string;
    dest?: PdfDestination;
    url?: string | null;
    color?: Uint8ClampedArray | number[];
    bold?: boolean;
    italic?: boolean;
    items?: PdfOutlineRaw[];
  };
  type FocusBox = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type SwatchOption = {
    name: string;
    color: string;
  };

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdfjsWasmUrl = "/pdfjs-wasm/";
  const bookmarkRootTitle = "My Bookmarks";
  const bookmarkTitleSnapTolerancePdfPoints = 4;
  const bookmarkTitleLookaheadPdfPoints = 180;
  const bookmarkTitleWordCount = 4;

  let containerEl: HTMLDivElement;
  let viewerEl: HTMLDivElement;
  let pdfViewer: PDFViewer | null = null;
  let pdfLinkService: PDFLinkService | null = null;
  let pdfDocument = $state<PdfDocument | null>(null);
  let annotationEditorUIManager: AnnotationEditorUIManager | null = null;
  let outlineEntries = $state<OutlineEntry[]>([]);
  let outlineStatus = $state("Open a PDF to inspect its outline.");
  let outlineColorMenuId = $state<string | null>(null);
  let collapsedOutlineIds = $state<string[]>([]);
  let activeOutlineEntryId = $state<string | null>(null);
  let navigationTab = $state<NavigationTab>("outline");
  let bookmarkEntries = $state<BookmarkEntry[]>([]);
  let bookmarkStatus = $state("Open a PDF to inspect bookmarks.");
  let editingBookmarkId = $state<string | null>(null);
  let activeBookmarkId = $state<string | null>(null);
  let bookmarkColorMenuId = $state<string | null>(null);
  let pendingBookmarkRailMarkerRects: BookmarkRailRect[] = [];
  let bookmarkRailHoverCue = $state<{
    pageNumber: number;
    focusLeft: number;
    focusTop: number;
    hintLeft: number;
    hintTop: number;
  } | null>(null);
  let hoveredBookmarkId = $state<string | null>(null);
  let bookmarkRailLayoutVersion = $state(0);
  let annotationEntries = $state<AnnotationEntry[]>([]);
  let annotationStatus = $state("Open a PDF to inspect annotations.");
  let selectedAnnotationEntryId = $state<string | null>(null);
  let selectedPersistedAnnotationKey: string | null = null;
  let annotationFocusBox = $state<FocusBox | null>(null);
  let lastAnnotationPointerClick:
    | { entryId: string; timeStamp: number; clientX: number; clientY: number }
    | null = null;
  let currentPath = $state("");
  let status = $state("Open a PDF, add highlight/text/ink annotations, then save.");
  let activeTool = $state<EditorTool>("none");
  let defaultHighlightColor = $state<HighlightColorName>("yellow");
  let defaultFreeTextColor = $state<FreeTextColorName>("black");
  let defaultInkColor = $state<InkColorName>("red");
  let defaultInkThickness = $state(3);
  let defaultInkOpacity = $state(1);
  let selectedAnnotationKind = $state<SelectedAnnotationKind>(null);
  let selectedAnnotationColor = $state<string | null>(null);
  let lastActivatedOutlineEntry: OutlineEntry | null = null;
  let hasSelectedHighlight = $state(false);
  let selectedHighlightColor = $state<HighlightColorName | null>(null);
  let scaleLabel = $state("Fit Width");
  let isBusy = $state(false);
  let isDirty = $state(false);
  let rememberedSelectionText = "";
  let rememberedSelectionRanges: Range[] = [];
  let annotationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const debugFileStore = new Map<string, Uint8Array>();
  const annotationDetailCache = new Map<string, string>();
  const pendingDeletedPersistedAnnotationKeys = new Set<string>();
  const persistedAnnotationKeyByEditorId = new Map<string, string>();

  const inkThicknesses = [1, 3, 8, 14] as const;
  const highlightSwatches: SwatchOption[] = Object.entries(highlightColors).map(([name, color]) => ({
    name,
    color,
  }));
  const freeTextSwatches: SwatchOption[] = Object.entries(freeTextColors).map(([name, color]) => ({
    name,
    color,
  }));
  const inkSwatches: SwatchOption[] = Object.entries(inkColors).map(([name, color]) => ({
    name,
    color,
  }));

  const editorModes = {
    none: pdfjsLib.AnnotationEditorType.NONE,
    highlight: pdfjsLib.AnnotationEditorType.HIGHLIGHT,
    text: pdfjsLib.AnnotationEditorType.FREETEXT,
    ink: pdfjsLib.AnnotationEditorType.INK,
  } as const;
  const { isHighlightEditor, isFreeTextEditor, isInkEditor, annotationKindForEditor } =
    createEditorTypeGuards(editorModes);

  onMount(() => {
    document.documentElement.style.setProperty(
      "--pdf-spike-ink-cursor",
      `url("${inkCursorUrl}") 1 14, pointer`,
    );
    const rememberSelection = () => {
      const selection = document.getSelection();
      const selectionText = selection?.toString().trim() ?? "";
      if (!selectionText || !selection || selection.rangeCount === 0) {
        return;
      }
      const anchorNode = selection.anchorNode;
      const anchorElement =
        anchorNode?.nodeType === Node.TEXT_NODE
          ? anchorNode.parentElement
          : anchorNode instanceof Element
            ? anchorNode
            : null;
      if (!anchorElement?.closest(".textLayer")) {
        return;
      }
      rememberedSelectionText = selectionText;
      rememberedSelectionRanges = Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      );
    };
    document.addEventListener("selectionchange", rememberSelection);
    document.addEventListener("pointerdown", handleDocumentPointerDown, { capture: true });
    document.addEventListener("keydown", handleAnnotationEscapeKey, { capture: true });
    document.addEventListener("keydown", handleAnnotationDeleteKey, { capture: true });
    document.addEventListener("keydown", handleFreeTextEditorKeydown, { capture: true });
    containerEl?.addEventListener("pointerdown", handleHighlightTextLayerPointerDown, { capture: true });
    containerEl?.addEventListener("pointerdown", handlePdfPointerDown, { capture: true });
    containerEl?.addEventListener("dblclick", handlePdfDoubleClick, { capture: true });
    let activeOutlineFrame = 0;
    const handlePdfScroll = () => {
      if (activeOutlineFrame) return;
      activeOutlineFrame = requestAnimationFrame(() => {
        activeOutlineFrame = 0;
        refreshActiveOutlineFromScroll();
      });
    };
    const handleRailClick = (event: MouseEvent) => void handlePdfContainerClick(event);
    const clearRailHoverCue = () => (bookmarkRailHoverCue = null);
    containerEl?.addEventListener("click", handleRailClick);
    containerEl?.addEventListener("scroll", handlePdfScroll);
    containerEl?.addEventListener("mousemove", handlePdfContainerMouseMove);
    containerEl?.addEventListener("mouseleave", clearRailHoverCue);
    const teardownSpikeDebugApi = installSpikeDebugApi(window, {
      annotationSummary: getAnnotationSummary,
      annotationSidebarSummary: () => annotationEntries,
      bookmarkSummary: () => bookmarkEntries,
      outlineSummary: () => outlineEntries,
      activateFirstOutlineItem,
      activateFirstAnnotationItem,
      activateAnnotationBySourceId,
      createBookmarkForCurrentPage,
      createPageFreeText,
      createSelectionHighlightInToolMode,
      editorSummary: getEditorSummary,
      loadSample: loadSamplePdf,
      loadPath: debugLoadPath,
      loadUrl: debugLoadUrl,
      saveToPath: debugSaveToPath,
      selectFirstHighlight: () => selectFirstHighlight(),
      selectFirstText,
      recolorSelectedHighlight: applyHighlightColor,
      recolorSelectedFreeText: applyFreeTextColor,
      recolorSelectedInk: applyInkColor,
      setInkThickness: applyInkThickness,
      setInkMarkerPreset: applyInkMarkerPreset,
      moveSelected: moveSelectedAnnotation,
      editSelectedFreeText,
      deleteSelected: deleteSelectedAnnotation,
      debugSavedBytes,
      stats: getDebugStats,
      setTool,
    });
    return () => {
      containerEl?.removeEventListener("mouseleave", clearRailHoverCue);
      containerEl?.removeEventListener("mousemove", handlePdfContainerMouseMove);
      containerEl?.removeEventListener("scroll", handlePdfScroll);
      containerEl?.removeEventListener("click", handleRailClick);
      containerEl?.removeEventListener("dblclick", handlePdfDoubleClick, { capture: true });
      containerEl?.removeEventListener("pointerdown", handlePdfPointerDown, { capture: true });
      containerEl?.removeEventListener("pointerdown", handleHighlightTextLayerPointerDown, { capture: true });
      if (activeOutlineFrame) cancelAnimationFrame(activeOutlineFrame);
      document.removeEventListener("keydown", handleFreeTextEditorKeydown, { capture: true });
      document.removeEventListener("keydown", handleAnnotationDeleteKey, { capture: true });
      document.removeEventListener("keydown", handleAnnotationEscapeKey, { capture: true });
      document.removeEventListener("pointerdown", handleDocumentPointerDown, { capture: true });
      document.removeEventListener("selectionchange", rememberSelection);
      teardownSpikeDebugApi();
    };
  });

  function clearAnnotationFocusSelection(resetTool = false) {
    if (resetTool && activeTool !== "none") {
      setTool("none");
    }
    annotationFocusBox = null;
    selectedAnnotationEntryId = null;
    selectedPersistedAnnotationKey = null;
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    unselectAllIgnoringPdfjsSignalBug();
    setPdfjsEditorMode(activeTool);
  }

  function blurFocusedAnnotationRow() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains("annotation-item")) {
      active.blur();
    }
  }

  function handleAnnotationEscapeKey(event: KeyboardEvent) {
    if (event.repeat || event.key !== "Escape" || isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (!annotationFocusBox && !selectedAnnotationEntryId && !selectedPersistedAnnotationKey && !selectedAnnotationKind) {
      return;
    }
    clearAnnotationFocusSelection(true);
    blurFocusedAnnotationRow();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      (!annotationFocusBox && !selectedAnnotationEntryId && !selectedPersistedAnnotationKey && !selectedAnnotationKind)
    ) {
      return;
    }
    if (!target.closest(".viewer-shell")) {
      return;
    }
    if (target.closest(".highlightAnnotation, .freeTextAnnotation, .inkAnnotation, .highlightEditor, .freeTextEditor, .inkEditor")) {
      return;
    }
    clearAnnotationFocusSelection(true);
  }

  function handleAnnotationDeleteKey(event: KeyboardEvent) {
    if (event.repeat || (event.key !== "Delete" && event.key !== "Backspace")) {
      return;
    }
    if (!selectedAnnotationKind || isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (deleteSelectedAnnotation()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function isEditableKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function handleFreeTextEditorKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const textElement = target.closest<HTMLElement>(
      ".freeTextEditor .internal, .freeTextEditor [contenteditable='true']",
    );
    if (!textElement?.isContentEditable) {
      return;
    }
    const editorElement = textElement.closest<HTMLElement>(".freeTextEditor");
    if (!editorElement?.id) {
      return;
    }
    const editor = findFreeTextEditorById(editorElement.id);
    if (!editor) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.commit?.();
    isDirty = true;
    syncSelectedEditorState();
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(150, 500);
    status = "Edited selected free text. Save to persist it into the PDF.";
  }

  async function openPdf() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!selected || Array.isArray(selected)) return;

    await loadPdf(selected);
  }

  async function loadPdf(path: string) {
    isBusy = true;
    status = "Loading PDF...";
    try {
      const rawBytes = await invoke<number[]>("read_pdf", { path });
      await loadPdfBytes(new Uint8Array(rawBytes), path);
      currentPath = path;
      isDirty = false;
      activeTool = "none";
      status = `Loaded ${path}`;
    } catch (error) {
      status = `Open failed: ${formatError(error)}`;
    } finally {
      isBusy = false;
    }
  }

  async function loadSamplePdf() {
    isBusy = true;
    status = "Loading bundled sample PDF...";
    try {
      const response = await fetch("/sample.pdf");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadPdfBytes(new Uint8Array(await response.arrayBuffer()), "sample.pdf");
      currentPath = "sample.pdf";
      isDirty = false;
      activeTool = "none";
      rememberedSelectionText = "";
      rememberedSelectionRanges = [];
      status = "Loaded bundled sample PDF.";
    } catch (error) {
      status = `Sample load failed: ${formatError(error)}`;
    } finally {
      isBusy = false;
    }
  }

  async function loadPdfBytes(bytes: Uint8Array, label: string) {
    const loadingTask = pdfjsLib.getDocument({ data: bytes, wasmUrl: pdfjsWasmUrl });
    const nextDocument = await loadingTask.promise;

    teardownViewer();
    rememberedSelectionText = "";
    rememberedSelectionRanges = [];

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    pdfLinkService = linkService;
    eventBus.on("annotationeditoruimanager", (event: { uiManager: AnnotationEditorUIManager }) => {
      annotationEditorUIManager = event.uiManager;
    });

    pdfViewer = new PDFViewer({
      container: containerEl,
      viewer: viewerEl,
      eventBus,
      linkService,
      annotationEditorMode: editorModes.none,
      enableHighlightFloatingButton: false,
      annotationEditorHighlightColors:
        "yellow=#fff35c,green=#7cf2aa,blue=#8ecbff,pink=#ffb6de",
    } as ConstructorParameters<typeof PDFViewer>[0] & { enableHighlightFloatingButton: boolean });
    linkService.setViewer(pdfViewer);
    pdfViewer.setDocument(nextDocument);
    linkService.setDocument(nextDocument, null);
    pdfDocument = nextDocument;
    void loadOutline(nextDocument);

    eventBus.on("pagesinit", () => {
      if (!pdfViewer) return;
      pdfViewer.currentScaleValue = "page-width";
      pdfViewer.update();
      pdfViewer.forceRendering(undefined);
      requestAnimationFrame(() => {
        pdfViewer?.update();
        pdfViewer?.forceRendering(undefined);
      });
      scaleLabel = "Fit Width";
      status = `Rendered ${label}`;
      refreshBookmarkRailLayout();
      queueAnnotationSidebarRefresh(0);
      queueAnnotationSidebarRefresh(300);
      queueAnnotationSidebarRefresh(1000);
    });
    for (const eventName of [
      "pagerendered",
      "textlayerrendered",
      "annotationlayerrendered",
      "annotationeditorlayerrendered",
    ]) {
      eventBus.on(eventName, () => {
        refreshBookmarkRailLayout();
        scheduleAnnotationSidebarRefresh(120);
      });
    }
    eventBus.on("editingstateschanged", () => syncSelectedEditorState());
    eventBus.on("annotationeditorparamschanged", () => syncSelectedEditorState());
  }

  function scheduleAnnotationSidebarRefresh(delay = 120) {
    if (annotationRefreshTimer) {
      clearTimeout(annotationRefreshTimer);
    }
    annotationRefreshTimer = setTimeout(() => {
      annotationRefreshTimer = null;
      void refreshAnnotationSidebar();
    }, delay);
  }

  function queueAnnotationSidebarRefresh(delay = 0) {
    setTimeout(() => void refreshAnnotationSidebar(), delay);
  }

  function queueEditorStateRefresh(...delays: number[]) {
    for (const delay of delays) {
      setTimeout(() => {
        syncSelectedEditorState();
        void refreshAnnotationSidebar();
      }, delay);
    }
  }

  async function refreshAnnotationSidebar() {
    if (!pdfDocument) {
      annotationEntries = [];
      annotationStatus = "Open a PDF to inspect annotations.";
      return;
    }
    try {
      const pdfEntries = await getPdfAnnotationEntries();
      const liveEntries = getLiveAnnotationEntries(pdfEntries);
      const merged = [...liveEntries, ...pdfEntries].sort(
        (left, right) =>
          left.page - right.page ||
          left.sortTop - right.sortTop ||
          left.sortLeft - right.sortLeft ||
          left.label.localeCompare(right.label),
      );
      annotationEntries = merged;
      annotationStatus = annotationCountLabel(merged.length);
    } catch (error) {
      annotationStatus = `Annotation scan failed: ${formatError(error)}`;
    }
  }

  async function getPdfAnnotationEntries() {
    const pages = await getAnnotationSummary();
    return buildPdfAnnotationEntries({
      pdfDocument,
      pages,
      detailCache: annotationDetailCache,
      isHidden: isPersistedAnnotationHidden,
      fallbackText: textForAnnotationDom,
      fallbackPosition: annotationTargetPosition,
    });
  }

  function getLiveAnnotationEntries(persistedEntries: AnnotationEntry[]) {
    if (!annotationEditorUIManager || !pdfDocument) return [];
    return buildLiveAnnotationEntries({
      pageCount: pdfDocument.numPages,
      persistedEntries,
      detailCache: annotationDetailCache,
      getEditors: (pageIndex) => annotationEditorUIManager?.getEditors(pageIndex) ?? [],
      editorId: (editor) => editor.id,
      editorColor: (editor) => editor.color ?? null,
      isDeleted: (editor) => Boolean(editor.deleted),
      kindForEditor: annotationKindForEditor,
      isUnmodifiedMirrorOfPersistedAnnotation: isUnmodifiedEditorMirrorOfPersistedAnnotation,
      targetIndexForEditor: (pageNumber, kind, editor, fallbackTargetIndex) =>
        targetIndexForEditor(pageNumber, kind, editor.id, fallbackTargetIndex),
      positionForEditor: (pageNumber, kind, targetIndex, editor) =>
        annotationTargetPosition(pageNumber, kind, targetIndex, editor.id),
      boundsForEditor: (pageNumber, kind, targetIndex, editor) =>
        annotationTargetBounds(pageNumber, kind, targetIndex, editor.id),
      detailForEditor: liveAnnotationDetail,
    });
  }

  function isPersistedAnnotationHidden(pageNumber: number, sourceId: string) {
    return (
      pendingDeletedPersistedAnnotationKeys.has(persistedAnnotationKey(pageNumber, sourceId)) ||
      isPersistedAnnotationDeleted(sourceId) ||
      isPersistedAnnotationModified(pageNumber, sourceId)
    );
  }

  function isPersistedAnnotationDeleted(sourceId: string) {
    if (!annotationEditorUIManager?.isDeletedAnnotationElement) return false;
    const annotationElementId = pdfAnnotationElementId(sourceId);
    return (
      annotationEditorUIManager.isDeletedAnnotationElement(annotationElementId) ||
      annotationEditorUIManager.isDeletedAnnotationElement(sourceId)
    );
  }

  function isPersistedAnnotationModified(pageNumber: number, sourceId: string) {
    if (!annotationEditorUIManager || !pdfDocument) return false;
    const pageIndex = pageNumber - 1;
    for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
      if (persistedSourceIdForEditor(editor) === sourceId && editorChangedExistingAnnotation(editor)) {
        return true;
      }
    }
    return false;
  }

  function persistedAnnotationKeyForEditor(editor: AnnotationEditor | null | undefined) {
    if (!editor) return null;
    const sourceId = persistedSourceIdForEditor(editor);
    const pageIndex = pageIndexForEditor(editor);
    return sourceId && pageIndex !== null
      ? persistedAnnotationKey(pageIndex + 1, sourceId)
      : persistedAnnotationKeyByEditorId.get(editor.id) ?? null;
  }

  function isUnmodifiedEditorMirrorOfPersistedAnnotation(
    editor: AnnotationEditor,
    persistedEntries: AnnotationEntry[],
    pageNumber: number,
  ) {
    const sourceId = persistedSourceIdForEditor(editor);
    return Boolean(
      sourceId &&
        !editorChangedExistingAnnotation(editor) &&
        persistedEntries.some(
          (entry) => entry.page === pageNumber && entry.sourceId === sourceId,
        ),
    );
  }

  function persistedSourceIdForEditor(editor: AnnotationEditor) {
    const annotationElementId = editor.annotationElementId;
    if (!annotationElementId) return null;
    return annotationElementId.startsWith("pdfjs_internal_id_")
      ? annotationElementId.slice("pdfjs_internal_id_".length)
      : annotationElementId;
  }


  function isInkHighlightEntry(entry: AnnotationEntry) {
    return entry.kind === "ink" && entry.intent === "InkHighlight";
  }

  function persistedAnnotationEntry(pageNumber: number, sourceId: string) {
    return annotationEntries.find(
      (entry) => entry.source === "pdf" && entry.page === pageNumber && entry.sourceId === sourceId,
    );
  }

  function persistedAnnotationEntryForKey(key: string | null | undefined) {
    if (!key) return null;
    const parts = persistedAnnotationKeyParts(key);
    return parts ? persistedAnnotationEntry(parts.pageNumber, parts.sourceId) : null;
  }

  function persistedAnnotationEntryForElement(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) return null;
    const sourceId = sourceIdFromPdfAnnotationElementId(element.id);
    const pageNumber = pageNumberForAnnotationElement(element);
    return sourceId && pageNumber ? persistedAnnotationEntry(pageNumber, sourceId) : null;
  }

  function persistedAnnotationEntryForEditor(editor: AnnotationEditor | null | undefined) {
    if (!editor) return null;
    const sourceId = persistedSourceIdForEditor(editor);
    const pageIndex = pageIndexForEditor(editor);
    return sourceId && pageIndex !== null ? persistedAnnotationEntry(pageIndex + 1, sourceId) : null;
  }

  function persistedAnnotationEntryForEditorId(editorId: string) {
    return persistedAnnotationEntryForEditor(findEditorById(editorId, () => true));
  }

  function annotationEntryForEditorId(editorId: string | null) {
    if (!editorId) return null;
    return (
      annotationEntries.find((entry) => entry.source === "live" && entry.sourceId === editorId) ??
      persistedAnnotationEntryForEditorId(editorId)
    );
  }

  function annotationEntryMatchesCurrentSelection(entry: AnnotationEntry) {
    if (entry.source === "live") {
      return selectedAnnotationEntryId === entry.id;
    }
    return selectedPersistedAnnotationKey === persistedAnnotationKey(entry.page, entry.sourceId);
  }

  function isRepeatedAnnotationPointerClick(entry: AnnotationEntry, event: PointerEvent) {
    const previous = lastAnnotationPointerClick;
    lastAnnotationPointerClick = {
      entryId: entry.id,
      timeStamp: event.timeStamp,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (!previous || previous.entryId !== entry.id) return false;
    const elapsed = event.timeStamp - previous.timeStamp;
    const distance = Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY);
    return elapsed >= 0 && elapsed <= 600 && distance <= 8;
  }

  function pageNumberForAnnotationElement(element: Element) {
    const pageElement = element.closest<HTMLElement>(".page[data-page-number]");
    const pageNumber = Number(pageElement?.dataset.pageNumber);
    return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
  }

  function rememberPersistedAnnotationElement(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) return null;
    const sourceId = sourceIdFromPdfAnnotationElementId(element.id);
    const pageNumber = pageNumberForAnnotationElement(element);
    if (!sourceId || !pageNumber) return null;
    selectedPersistedAnnotationKey = persistedAnnotationKey(pageNumber, sourceId);
    return selectedPersistedAnnotationKey;
  }

  function editorChangedExistingAnnotation(editor: AnnotationEditor) {
    if (editor.deleted) return true;
    if (editor.hasBeenModified) return true;
    return Boolean(editor.serialize?.(false));
  }

  function pageIndexForEditor(editor: AnnotationEditor) {
    if (Number.isInteger(editor.pageIndex)) {
      return editor.pageIndex as number;
    }
    if (!annotationEditorUIManager || !pdfDocument) {
      return null;
    }
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const candidate of annotationEditorUIManager.getEditors(pageIndex)) {
        if (candidate.id === editor.id) {
          return pageIndex;
        }
      }
    }
    return null;
  }

  function liveAnnotationDetail(editor: AnnotationEditor, pageNumber: number, targetIndex: number) {
    if (isHighlightEditor(editor)) {
      return textForAnnotationDom(pageNumber, "highlight", targetIndex) || "Unsaved/live highlight";
    }
    if (isFreeTextEditor(editor)) {
      return textForAnnotationDom(pageNumber, "freetext", targetIndex) || "Unsaved/live free text";
    }
    return "Unsaved/live ink";
  }

  function textForAnnotationDom(
    pageNumber: number,
    kind: Exclude<SelectedAnnotationKind, null>,
    targetIndex: number,
  ) {
    const element = annotationTargetElements(pageNumber, kind)[targetIndex];
    if (!element) return "";
    if (kind === "freetext") return element.textContent?.trim() ?? "";
    if (kind !== "highlight") return "";
    return textOverlappingElement(element);
  }

  function textOverlappingElement(element: HTMLElement) {
    const page = element.closest<HTMLElement>(".page");
    if (!page) return "";
    const targetRect = element.getBoundingClientRect();
    const textChunks: { index: number; text: string; rect: DOMRect }[] = [];
    const walker = document.createTreeWalker(page.querySelector(".textLayer") ?? page, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    let index = 0;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent ?? "";
      let firstOffset: number | null = null;
      let lastOffset: number | null = null;
      for (let offset = 0; offset < text.length; offset += 1) {
        const char = text[offset];
        if (!char || !char.trim()) {
          index += 1;
          continue;
        }
        const range = document.createRange();
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + 1);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (rect.width > 0 && rect.height > 0 && rectLikesOverlap(targetRect, rect, 1)) {
          firstOffset ??= offset;
          lastOffset = offset + 1;
        }
        index += 1;
      }
      if (firstOffset !== null && lastOffset !== null) {
        const range = document.createRange();
        range.setStart(textNode, firstOffset);
        range.setEnd(textNode, lastOffset);
        textChunks.push({
          index: index - text.length + firstOffset,
          text: text.slice(firstOffset, lastOffset),
          rect: range.getBoundingClientRect(),
        });
        range.detach();
      }
    }
    return textChunks
      .sort((left, right) => left.index - right.index)
      .map(({ text }) => text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function loadOutline(document: PdfDocument) {
    outlineEntries = [];
    outlineStatus = "Loading outline...";
    activeOutlineEntryId = null;
    bookmarkEntries = [];
    bookmarkStatus = "Loading bookmarks...";
    try {
      const documentWithOutline = document as PdfDocument & {
        getDestination: (id: string) => Promise<unknown[] | null>;
        getOutline: () => Promise<PdfOutlineRaw[] | null>;
        getPageIndex: (ref: unknown) => Promise<number>;
      };
      const rawOutline = await documentWithOutline.getOutline();
      if (!rawOutline || rawOutline.length === 0) {
        outlineStatus = "This PDF has no outline.";
        bookmarkStatus = bookmarkCountLabel(0);
        return;
      }
      const bookmarkRoot = rawOutline.find((item) => item.title?.trim() === bookmarkRootTitle);
      const documentOutline = rawOutline.filter((item) => item !== bookmarkRoot);
      if (bookmarkRoot?.items?.length) {
        const normalizedBookmarks = await Promise.all(
          bookmarkRoot.items.map((item, index) =>
            normalizeBookmarkEntry(documentWithOutline, item, `${index + 1}`),
          ),
        );
        bookmarkEntries = sortBookmarkEntries(
          normalizedBookmarks.filter((entry): entry is BookmarkEntry => Boolean(entry)),
        );
      }
      bookmarkStatus = bookmarkCountLabel(bookmarkEntries.length);
      if (documentOutline.length === 0) {
        outlineStatus = "This PDF has no outline.";
        return;
      }
      outlineEntries = await Promise.all(
        documentOutline.map((item, index) => normalizeOutlineEntry(documentWithOutline, item, `${index + 1}`)),
      );
      collapsedOutlineIds = [];
      const count = countOutlineEntries(outlineEntries);
      const unavailableCount = countUnavailableOutlineEntries(outlineEntries);
      outlineStatus =
        unavailableCount > 0
          ? `${count} outline ${count === 1 ? "item" : "items"}; ${unavailableCount} not navigable`
          : `${count} outline ${count === 1 ? "item" : "items"}`;
      requestAnimationFrame(refreshActiveOutlineFromScroll);
    } catch (error) {
      outlineStatus = `Outline failed: ${formatError(error)}`;
    }
  }

  async function normalizeBookmarkEntry(
    document: PdfDocument & {
      getDestination: (id: string) => Promise<unknown[] | null>;
      getPageIndex: (ref: unknown) => Promise<number>;
    },
    item: PdfOutlineRaw,
    id: string,
  ) {
    const dest = item.dest ?? null;
    const pageNumber = await resolveOutlinePageNumber(document, dest);
    if (!pageNumber) return null;
    const pageTarget = await bookmarkPageTarget(pageNumber);
    if (!pageTarget) return null;
    const explicitDestination = await resolveOutlineDestination(document, dest);
    const savedDestinationY = typeof explicitDestination?.[3] === "number" ? explicitDestination[3] : pageTarget.pageHeight;
    const targetY = bookmarkAnchorYFromDestination(pageNumber, savedDestinationY, pageTarget.pageHeight);
    return {
      id: `pdf-bookmark:${id}`,
      title: item.title?.trim() || `Page ${pageNumber}`,
      pageNumber,
      pageRef: pageTarget.pageRef,
      pageHeight: pageTarget.pageHeight,
      targetY,
      destinationY: bookmarkDestinationY(pageNumber, targetY, pageTarget.pageHeight),
      color: normalizeOutlineColor(item.color),
    };
  }

  async function normalizeOutlineEntry(
    document: PdfDocument & {
      getDestination: (id: string) => Promise<unknown[] | null>;
      getPage: (pageNumber: number) => Promise<PdfPage>;
      getPageIndex: (ref: unknown) => Promise<number>;
    },
    item: PdfOutlineRaw,
    id: string,
  ): Promise<OutlineEntry> {
    const children = item.items ?? [];
    const dest = item.dest ?? null;
    const explicitDestination = await resolveOutlineDestination(document, dest);
    const pageNumber = await resolveOutlinePageNumberFromDestination(document, explicitDestination);
    const pageHeight = pageNumber ? await outlinePageHeight(document, pageNumber) : null;
    return {
      id,
      title: item.title?.trim() || "Untitled",
      dest,
      url: item.url ?? null,
      pageNumber,
      targetY: typeof explicitDestination?.[3] === "number" ? explicitDestination[3] : null,
      pageHeight,
      color: normalizeOutlineColor(item.color),
      colorDirty: false,
      destinationStatus: outlineDestinationStatus(dest, item.url ?? null, pageNumber),
      items: await Promise.all(
        children.map((child, index) => normalizeOutlineEntry(document, child, `${id}.${index + 1}`)),
      ),
    };
  }

  async function outlinePageHeight(document: { getPage: (pageNumber: number) => Promise<PdfPage> }, pageNumber: number) {
    const page = await document.getPage(pageNumber);
    const view = (page as unknown as { view?: number[] }).view;
    return Number(view?.[3] ?? page.getViewport({ scale: 1 }).height);
  }

  function updateOutlineColor(id: string, color: string | null) {
    outlineEntries = updateOutlineEntryColor(outlineEntries, id, color);
    outlineColorMenuId = null;
    isDirty = true;
  }

  function isOutlineCollapsed(id: string) {
    return collapsedOutlineIds.includes(id);
  }

  function toggleOutlineCollapsed(id: string) {
    collapsedOutlineIds = isOutlineCollapsed(id)
      ? collapsedOutlineIds.filter((candidate) => candidate !== id)
      : [...collapsedOutlineIds, id];
    outlineColorMenuId = null;
  }

  function collapseAllOutlineItems() {
    collapsedOutlineIds = flattenOutlineEntries(outlineEntries)
      .filter((entry) => entry.items.length > 0)
      .map((entry) => entry.id);
    outlineColorMenuId = null;
  }

  function expandAllOutlineItems() {
    collapsedOutlineIds = [];
    outlineColorMenuId = null;
  }

  function isActiveOutlineRow(id: string) {
    return visibleActiveOutlineEntryId(outlineEntries, activeOutlineEntryId, isOutlineCollapsed) === id;
  }

  function refreshActiveOutlineFromScroll() {
    if (!containerEl || outlineEntries.length === 0) {
      activeOutlineEntryId = null;
      return;
    }
    const anchorTop = containerEl.scrollTop + 96;
    const pageElements = [...(viewerEl?.querySelectorAll<HTMLElement>(".page[data-page-number]") ?? [])]
      .map((element) => ({ element, pageNumber: Number(element.dataset.pageNumber) }))
      .filter((entry) => Number.isInteger(entry.pageNumber) && entry.pageNumber > 0)
      .sort((left, right) => left.element.offsetTop - right.element.offsetTop);
    const visiblePage =
      pageElements.find(
        ({ element }) => anchorTop >= element.offsetTop && anchorTop < element.offsetTop + element.offsetHeight,
      ) ??
      pageElements.filter(({ element }) => element.offsetTop <= anchorTop).at(-1) ??
      pageElements[0];
    if (!visiblePage) {
      activeOutlineEntryId = null;
      return;
    }
    const flatEntries = flattenOutlineEntries(outlineEntries).filter((entry) => entry.pageNumber);
    const pageHeight =
      flatEntries.find((entry) => entry.pageNumber === visiblePage.pageNumber)?.pageHeight ??
      visiblePage.element.offsetHeight;
    const scale = pageHeight > 0 ? visiblePage.element.offsetHeight / pageHeight : 1;
    const offsetIntoPage = Math.max(
      0,
      Math.min(visiblePage.element.offsetHeight, anchorTop - visiblePage.element.offsetTop),
    );
    const currentY = pageHeight - offsetIntoPage / scale;
    const candidates = flatEntries
      .filter((entry) => {
        if (!entry.pageNumber) return false;
        if (entry.pageNumber < visiblePage.pageNumber) return true;
        if (entry.pageNumber > visiblePage.pageNumber) return false;
        return (entry.targetY ?? entry.pageHeight ?? pageHeight) >= currentY - 2;
      })
      .sort((left, right) => {
        const pageOrder = (left.pageNumber ?? 0) - (right.pageNumber ?? 0);
        if (pageOrder !== 0) return pageOrder;
        return (right.targetY ?? right.pageHeight ?? pageHeight) - (left.targetY ?? left.pageHeight ?? pageHeight);
      });
    const active = candidates.at(-1) ?? flatEntries[0] ?? null;
    activeOutlineEntryId = active?.id ?? null;
  }

  function outlineColorStyle(color: string | null) {
    if (!color) return "--outline-color: transparent; --outline-bg-color: transparent; --outline-hover-bg-color: #edf4ff";
    return `--outline-color: ${color}; --outline-bg-color: ${hexToRgba(color, 0.16)}; --outline-hover-bg-color: ${hexToRgba(color, 0.24)}`;
  }

  async function resolveOutlinePageNumber(
    document: PdfDocument & {
      getDestination: (id: string) => Promise<unknown[] | null>;
      getPageIndex: (ref: unknown) => Promise<number>;
    },
    dest: PdfDestination,
  ) {
    if (!dest) return null;
    const explicitDestination = await resolveOutlineDestination(document, dest);
    return resolveOutlinePageNumberFromDestination(document, explicitDestination);
  }

  async function resolveOutlinePageNumberFromDestination(
    document: {
      getPageIndex: (ref: unknown) => Promise<number>;
    },
    explicitDestination: unknown[] | null,
  ) {
    const pageReference = explicitDestination?.[0];
    if (typeof pageReference === "number") {
      return pageReference + 1;
    }
    if (!pageReference) {
      return null;
    }
    try {
      return (await document.getPageIndex(pageReference)) + 1;
    } catch {
      return null;
    }
  }

  async function resolveOutlineDestination(
    document: {
      getDestination: (id: string) => Promise<unknown[] | null>;
    },
    dest: PdfDestination,
  ) {
    if (!dest) return null;
    try {
      return typeof dest === "string" ? await document.getDestination(dest) : dest;
    } catch {
      return null;
    }
  }

  async function createBookmarkForCurrentPage(editAfterCreate = false) {
    if (!pdfDocument || !pdfViewer) {
      status = "Open a PDF before creating bookmarks.";
      return;
    }
    const pageNumber = pdfViewer.currentPageNumber || 1;
    const pageTarget = await bookmarkPageTarget(pageNumber);
    await createBookmarkFromTarget(pageTarget, editAfterCreate);
  }

  async function handlePdfContainerClick(event: MouseEvent) {
    if ((event.target as Element | null)?.closest("button, input")) return;
    editingBookmarkId = null;
    const cueHit = bookmarkRailHoverCueHitAtPoint(event.clientX, event.clientY);
    if (cueHit) {
      await createBookmarkAtPageRailPoint(cueHit.clientY, cueHit.pageNumber);
      return;
    }
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit) return;
    if (bookmarkRailPointConflicts(hit.pageElement, event.clientY)) {
      bookmarkRailHoverCue = null;
      return;
    }
    await createBookmarkAtPageRailPoint(event.clientY, hit.pageNumber);
  }

  function handlePdfContainerMouseMove(event: MouseEvent) {
    if (bookmarkRailHoverCueHitAtPoint(event.clientX, event.clientY)) {
      return;
    }
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit || !containerEl) {
      bookmarkRailHoverCue = null;
      return;
    }
    if (bookmarkRailPointConflicts(hit.pageElement, event.clientY)) {
      bookmarkRailHoverCue = null;
      return;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const pointerLeft = containerEl.scrollLeft + event.clientX - containerRect.left;
    const pointerTop = containerEl.scrollTop + event.clientY - containerRect.top;
    const pagePosition = pagePositionInContainer(hit.pageElement);
    bookmarkRailHoverCue = {
      pageNumber: hit.pageNumber,
      focusLeft: pagePosition.left,
      focusTop: pointerTop,
      hintLeft: pointerLeft + bookmarkRailAddCueOffsetPx,
      hintTop: pointerTop + bookmarkRailAddCueOffsetPx,
    };
  }

  function bookmarkRailHoverCueHitAtPoint(clientX: number, clientY: number) {
    if (!bookmarkRailHoverCue || !containerEl) return null;
    const containerRect = containerEl.getBoundingClientRect();
    const focusCenter = {
      x: containerRect.left + bookmarkRailHoverCue.focusLeft - containerEl.scrollLeft,
      y: containerRect.top + bookmarkRailHoverCue.focusTop - containerEl.scrollTop,
    };
    const addCenter = {
      x: containerRect.left + bookmarkRailHoverCue.hintLeft - containerEl.scrollLeft,
      y: containerRect.top + bookmarkRailHoverCue.hintTop - containerEl.scrollTop,
    };
    const withinFocusCue = withinSquareCue(clientX, clientY, focusCenter.x, focusCenter.y, bookmarkRailFocusCueSizePx);
    const withinAddCue = withinSquareCue(clientX, clientY, addCenter.x, addCenter.y, bookmarkRailAddCueSizePx);
    return withinFocusCue || withinAddCue
      ? { pageNumber: bookmarkRailHoverCue.pageNumber, clientY: focusCenter.y }
      : null;
  }

  function bookmarkRailActionRectsAtPoint(pageElement: HTMLElement, clientY: number) {
    return [bookmarkRailMarkerRectAtPoint(pageElement, clientY)];
  }

  function bookmarkRailMarkerRectAtPoint(pageElement: HTMLElement, clientY: number) {
    return railMarkerRectAt(pageElement.getBoundingClientRect().left, clientY);
  }

  function bookmarkRailActionDmzHit(candidateRects: BookmarkRailRect[]) {
    const markerRects = [
      ...[...document.querySelectorAll<HTMLElement>(".bookmark-page-marker")].map((marker) => {
        const rect = marker.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
      ...pendingBookmarkRailMarkerRects,
    ];
    return markerRects.some((markerRect) =>
      candidateRects.some((candidateRect) => bookmarkRailRectsConflict(candidateRect, markerRect)),
    );
  }

  function bookmarkRailPointConflicts(pageElement: HTMLElement, clientY: number) {
    if (bookmarkRailActionDmzHit(bookmarkRailActionRectsAtPoint(pageElement, clientY))) {
      return true;
    }
    const candidateRect = bookmarkRailMarkerContentRectAtPoint(pageElement, clientY);
    return bookmarkEntries.some((entry) => {
      const markerRect = bookmarkRailMarkerContentRect(entry.pageNumber, entry.targetY, entry.pageHeight);
      return markerRect ? bookmarkRailRectsConflict(candidateRect, markerRect) : false;
    });
  }

  function reserveBookmarkRailMarkerRect(rect: BookmarkRailRect) {
    pendingBookmarkRailMarkerRects = [...pendingBookmarkRailMarkerRects, rect];
    return () => {
      pendingBookmarkRailMarkerRects = pendingBookmarkRailMarkerRects.filter((pendingRect) => pendingRect !== rect);
    };
  }

  function bookmarkRailHitAtPoint(clientX: number, clientY: number) {
    const pageElements = [...(viewerEl?.querySelectorAll<HTMLElement>(".page[data-page-number]") ?? [])];
    const pageElement = pageElements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        Math.abs(clientX - rect.left) <= bookmarkRailAnchorWidthPx &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    });
    const pageNumber = Number(pageElement?.dataset.pageNumber);
    return pageElement && Number.isInteger(pageNumber) && pageNumber > 0 ? { pageElement, pageNumber } : null;
  }

  async function createBookmarkAtPageRailPoint(clientY: number, pageNumber: number) {
    if (!pdfDocument) {
      status = "Open a PDF before creating bookmarks.";
      return;
    }
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (!pageElement) {
      status = "Could not resolve page rail for bookmark.";
      return;
    }
    const pageRect = pageElement.getBoundingClientRect();
    const offsetIntoPage = Math.max(0, Math.min(pageRect.height, clientY - pageRect.top));
    const markerRect = bookmarkRailMarkerRectAtPoint(pageElement, clientY);
    if (bookmarkRailPointConflicts(pageElement, clientY)) {
      bookmarkRailHoverCue = null;
      return;
    }
    const releaseRailMarkerReservation = reserveBookmarkRailMarkerRect(markerRect);
    try {
      const pageTarget = await bookmarkPageTarget(pageNumber, offsetIntoPage);
      await createBookmarkFromTarget(pageTarget);
    } finally {
      await tick();
      releaseRailMarkerReservation();
    }
  }

  async function createBookmarkFromTarget(
    pageTarget: Awaited<ReturnType<typeof bookmarkPageTarget>>,
    editAfterCreate = false,
  ) {
    if (!pageTarget) {
      status = "Could not resolve current page for bookmark.";
      return;
    }
    if (bookmarkTargetConflictsWithExistingBookmarks(pageTarget)) {
      bookmarkRailHoverCue = null;
      status = "Bookmark too close to existing bookmark.";
      return;
    }
    const pageNumber = pageTarget.pageNumber;
    const title = defaultBookmarkTitle(pageNumber, pageTarget.targetY, pageTarget.pageHeight);
    const entry: BookmarkEntry = {
      id: `bookmark:${Date.now()}:${pageNumber}`,
      title,
      pageNumber,
      pageRef: pageTarget.pageRef,
      pageHeight: pageTarget.pageHeight,
      targetY: pageTarget.targetY,
      destinationY: bookmarkDestinationY(pageNumber, pageTarget.targetY, pageTarget.pageHeight),
      color: defaultBookmarkColor,
    };
    bookmarkEntries = sortBookmarkEntries([...bookmarkEntries, entry]);
    bookmarkStatus = bookmarkCountLabel(bookmarkEntries.length);
    navigationTab = "bookmarks";
    editingBookmarkId = editAfterCreate ? entry.id : null;
    bookmarkColorMenuId = null;
    hoveredBookmarkId = null;
    bookmarkRailHoverCue = null;
    isDirty = true;
    status = `Added bookmark ${title}.`;
  }

  function bookmarkTargetConflictsWithExistingBookmarks(pageTarget: NonNullable<Awaited<ReturnType<typeof bookmarkPageTarget>>>) {
    const candidateRect = bookmarkRailMarkerContentRect(pageTarget.pageNumber, pageTarget.targetY, pageTarget.pageHeight);
    if (!candidateRect) return false;
    return bookmarkEntries.some((entry) => {
      const markerRect = bookmarkRailMarkerContentRect(entry.pageNumber, entry.targetY, entry.pageHeight);
      return markerRect ? bookmarkRailRectsConflict(candidateRect, markerRect) : false;
    });
  }

  function bookmarkRailMarkerContentRect(pageNumber: number, targetY: number, pageHeight: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (!pageElement || pageHeight <= 0) return null;
    const offsetIntoPage = offsetIntoPageForTargetY(targetY, pageHeight, pageElement.offsetHeight);
    return bookmarkRailMarkerContentRectFromOffset(pageElement, offsetIntoPage);
  }

  function bookmarkRailMarkerContentRectAtPoint(pageElement: HTMLElement, clientY: number) {
    const pageRect = pageElement.getBoundingClientRect();
    const offsetIntoPage = Math.max(0, Math.min(pageRect.height, clientY - pageRect.top));
    return bookmarkRailMarkerContentRectFromOffset(pageElement, offsetIntoPage);
  }

  function bookmarkRailMarkerContentRectFromOffset(pageElement: HTMLElement, offsetIntoPage: number) {
    return railMarkerContentRectForOffset(pagePositionInContainer(pageElement), offsetIntoPage);
  }

  function updateBookmarkTitle(id: string, title: string) {
    bookmarkEntries = bookmarkEntries.map((entry) =>
      entry.id === id ? { ...entry, title: title.trim() || `Page ${entry.pageNumber}` } : entry,
    );
    isDirty = true;
  }

  function startEditingBookmark(id: string) {
    editingBookmarkId = id;
    bookmarkColorMenuId = null;
    hoveredBookmarkId = null;
  }

  function updateBookmarkColor(id: string, color: string | null) {
    bookmarkEntries = bookmarkEntries.map((entry) => (entry.id === id ? { ...entry, color } : entry));
    bookmarkColorMenuId = null;
    isDirty = true;
  }

  function handleBookmarkTitleKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      editingBookmarkId = null;
      bookmarkColorMenuId = null;
      hoveredBookmarkId = null;
      event.preventDefault();
    }
    if (event.key === "Escape") {
      editingBookmarkId = null;
      bookmarkColorMenuId = null;
      hoveredBookmarkId = null;
      event.preventDefault();
    }
  }

  function deleteBookmark(id: string) {
    const removed = bookmarkEntries.find((entry) => entry.id === id);
    bookmarkEntries = bookmarkEntries.filter((entry) => entry.id !== id);
    bookmarkStatus = bookmarkCountLabel(bookmarkEntries.length);
    if (editingBookmarkId === id) {
      editingBookmarkId = null;
    }
    if (bookmarkColorMenuId === id) {
      bookmarkColorMenuId = null;
    }
    isDirty = true;
    status = removed ? `Deleted bookmark ${removed.title}.` : "Deleted bookmark.";
  }

  function defaultBookmarkTitle(pageNumber: number, targetY: number, pageHeight: number) {
    return textLineBookmarkTitle(pageNumber, targetY, pageHeight) ?? outlineBookmarkTitle(pageNumber, targetY);
  }

  function textLineBookmarkTitle(pageNumber: number, targetY: number, pageHeight: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const textLayer = pageElement?.querySelector<HTMLElement>(".textLayer");
    if (!pageElement || !textLayer || pageHeight <= 0) return null;

    const pageRect = pageElement.getBoundingClientRect();
    const anchorTop = ((pageHeight - targetY) / pageHeight) * pageElement.offsetHeight;
    const lines = [...textLayer.querySelectorAll<HTMLElement>("span")]
      .map((span) => {
        const text = span.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const rect = span.getBoundingClientRect();
        return {
          text,
          top: rect.top - pageRect.top,
          left: rect.left - pageRect.left,
          height: rect.height,
        };
      })
      .filter((line) => line.text.length > 0 && line.height > 0 && line.top <= anchorTop + 6)
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const lineGroups: { top: number; items: { text: string; left: number }[] }[] = [];
    for (const line of lines) {
      const group = lineGroups.find((candidate) => Math.abs(candidate.top - line.top) < 4);
      if (group) {
        group.items.push({ text: line.text, left: line.left });
      } else {
        lineGroups.push({ top: line.top, items: [{ text: line.text, left: line.left }] });
      }
    }
    const anchorLine = lineGroups.at(-1);
    if (!anchorLine) return null;
    const lineText = anchorLine.items
      .sort((left, right) => left.left - right.left)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/^[•\-–—]\s*/, "")
      .trim();
    return firstWords(lineText, bookmarkTitleWordCount) || null;
  }


  function outlineBookmarkTitle(pageNumber: number, targetY: number) {
    const candidates = flattenOutlineEntries(outlineEntries).filter(
      (entry) => entry.pageNumber !== null && entry.pageNumber <= pageNumber,
    );
    const samePageCandidates = candidates.filter(
      (entry): entry is OutlineEntry & { targetY: number } => entry.pageNumber === pageNumber && entry.targetY !== null,
    );
    const previousSamePageCandidates = samePageCandidates
      .filter((entry) => entry.targetY >= targetY - bookmarkTitleSnapTolerancePdfPoints)
      .sort((left, right) => (left.targetY ?? 0) - (right.targetY ?? 0));
    if (previousSamePageCandidates.length > 0) {
      return previousSamePageCandidates[0].title;
    }
    const upcomingSamePageCandidates = samePageCandidates
      .filter((entry) => entry.targetY < targetY && entry.targetY >= targetY - bookmarkTitleLookaheadPdfPoints)
      .sort((left, right) => (right.targetY ?? 0) - (left.targetY ?? 0));
    if (upcomingSamePageCandidates.length > 0) {
      return upcomingSamePageCandidates[0].title;
    }
    const previousPageCandidates = candidates
      .filter((entry) => entry.pageNumber !== pageNumber)
      .sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0));
    return previousPageCandidates.at(-1)?.title ?? `Page ${pageNumber}`;
  }

  async function bookmarkPageTarget(pageNumber: number, offsetIntoPage?: number) {
    if (!pdfDocument) return null;
    const page = await pdfDocument.getPage(pageNumber);
    const ref = (page as unknown as { ref?: { num: number; gen?: number } }).ref;
    const view = (page as unknown as { view?: number[] }).view;
    const viewport = page.getViewport({ scale: 1 });
    const pageRef =
      pdfRefString(ref) ??
      (lastActivatedOutlineEntry?.pageNumber === pageNumber
        ? pdfRefString(explicitDestinationRef(lastActivatedOutlineEntry.dest))
        : null);
    if (!pageRef) return null;
    return {
      pageNumber,
      pageRef,
      pageHeight: Number(view?.[3] ?? viewport.height),
      targetY: bookmarkTargetYForPage(pageNumber, Number(view?.[3] ?? viewport.height), offsetIntoPage),
    };
  }

  function bookmarkTargetYForPage(pageNumber: number, pageHeight: number, explicitOffsetIntoPage?: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (!containerEl || !pageElement) return pageHeight;
    const offsetIntoPage = explicitOffsetIntoPage ?? Math.max(0, containerEl.scrollTop - pageElement.offsetTop);
    return targetYForOffsetIntoPage(offsetIntoPage, renderedPageScale(pageElement.offsetHeight, pageHeight), pageHeight);
  }

  function bookmarkAnchorInsetPdfPoints(pageNumber: number, pageHeight: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    return bookmarkAnchorInsetForScale(renderedPageScale(pageElement?.offsetHeight ?? 0, pageHeight));
  }

  function bookmarkDestinationY(pageNumber: number, targetY: number, pageHeight: number) {
    return bookmarkDestinationYForInset(targetY, bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }

  function bookmarkAnchorYFromDestination(pageNumber: number, destinationY: number, pageHeight: number) {
    return bookmarkAnchorYForInset(destinationY, bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }


  async function goToBookmarkEntry(entry: BookmarkEntry) {
    editingBookmarkId = null;
    activeBookmarkId = entry.id;
    await scrollToBookmarkTarget(entry);
    status = `Navigated to ${entry.title}.`;
  }

  async function editBookmarkAndGoToEntry(entry: BookmarkEntry) {
    activeBookmarkId = entry.id;
    startEditingBookmark(entry.id);
    await scrollToBookmarkTarget(entry);
    status = `Navigated to ${entry.title}.`;
  }

  async function scrollToBookmarkTarget(entry: BookmarkEntry) {
    if (scrollBookmarkTargetIntoView(entry)) return;
    await scrollToPage(entry.pageNumber);
    await new Promise((resolve) => setTimeout(resolve, 100));
    scrollBookmarkTargetIntoView(entry);
  }

  function scrollBookmarkTargetIntoView(entry: BookmarkEntry) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
    if (!pageElement || !containerEl) return false;
    const offsetIntoPage = offsetIntoPageForTargetY(entry.targetY, entry.pageHeight, pageElement.offsetHeight);
    const pagePosition = pagePositionInContainer(pageElement);
    containerEl.scrollTop = Math.max(0, pagePosition.top + offsetIntoPage - bookmarkRailAnchorHeightPx);
    return true;
  }

  function bookmarkMarkerStyle(entry: BookmarkEntry) {
    bookmarkRailLayoutVersion;
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
    const colorStyle = `--bookmark-color: ${entry.color ?? defaultBookmarkColor}`;
    if (!pageElement || entry.pageHeight <= 0) {
      return `left: 12px; top: 18px; ${colorStyle}`;
    }
    const offsetIntoPage = offsetIntoPageForTargetY(entry.targetY, entry.pageHeight, pageElement.offsetHeight);
    const pagePosition = pagePositionInContainer(pageElement);
    const left = pagePosition.left;
    const top = pagePosition.top + offsetIntoPage;
    return `left: ${left}px; top: ${top}px; ${colorStyle}`;
  }

  function pagePositionInContainer(pageElement: HTMLElement) {
    if (!containerEl) {
      return { left: pageElement.offsetLeft, top: pageElement.offsetTop };
    }
    const containerRect = containerEl.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    return {
      left: containerEl.scrollLeft + pageRect.left - containerRect.left,
      top: containerEl.scrollTop + pageRect.top - containerRect.top,
    };
  }

  function bookmarkColorStyle(entry: BookmarkEntry) {
    return `--bookmark-color: ${entry.color ?? defaultBookmarkColor}`;
  }

  function refreshBookmarkRailLayout() {
    bookmarkRailLayoutVersion += 1;
  }

  async function goToOutlineEntry(entry: OutlineEntry) {
    if (entry.url) {
      status = "External outline links are not opened in this spike.";
      return false;
    }
    if (!entry.dest || !entry.pageNumber || !pdfLinkService) {
      status = "Outline item has no navigable PDF destination.";
      return false;
    }
    activeOutlineEntryId = entry.id;
    try {
      await pdfLinkService.goToDestination(entry.dest as string | unknown[]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (pdfViewer && entry.pageNumber && pdfViewer.currentPageNumber !== entry.pageNumber) {
        await scrollToPage(entry.pageNumber);
      }
      lastActivatedOutlineEntry = entry;
      requestAnimationFrame(refreshActiveOutlineFromScroll);
      status = `Navigated to ${entry.title}.`;
      return true;
    } catch (error) {
      status = `Outline navigation failed: ${formatError(error)}`;
      return false;
    }
  }

  async function activateFirstOutlineItem() {
    const first = outlineEntries[0];
    if (!first) return false;
    return goToOutlineEntry(first);
  }

  async function activateFirstAnnotationItem() {
    await refreshAnnotationSidebar();
    const first = annotationEntries[0];
    if (!first) return false;
    return locateAnnotationEntry(first);
  }

  async function activateAnnotationBySourceId(sourceId: string) {
    await refreshAnnotationSidebar();
    const entry = annotationEntries.find((candidate) => candidate.sourceId === sourceId);
    if (!entry) return false;
    return activateAnnotationEntry(entry);
  }


  async function activateAnnotationEntry(entry: AnnotationEntry) {
    selectedAnnotationEntryId = entry.id;
    await scrollToPage(entry.page);
    if (entry.source === "live") {
      return activateLiveAnnotationEntry(entry);
    }
    return activatePdfAnnotationEntry(entry);
  }

  async function locateAnnotationEntry(entry: AnnotationEntry) {
    selectedAnnotationEntryId = entry.id;
    await scrollToPage(entry.page);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (locateAnnotationBounds(entry)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    status = `Could not find ${entry.label.toLowerCase()} on page ${entry.page}.`;
    return false;
  }

  async function scrollToPage(pageNumber: number) {
    const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      containerEl.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } else if (pdfViewer) {
      pdfViewer.currentPageNumber = pageNumber;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function activateLiveAnnotationEntry(entry: AnnotationEntry) {
    if (entry.kind === "highlight") return activateExistingHighlightEditor(entry.sourceId);
    if (entry.kind === "freetext") return activateExistingFreeTextEditor(entry.sourceId);
    return activateExistingInkEditor(entry.sourceId);
  }

  async function activatePdfAnnotationEntry(
    entry: AnnotationEntry,
    options: { scrollIntoView?: boolean } = {},
  ) {
    unselectAllIgnoringPdfjsSignalBug();
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (entry.kind === "ink" && activeTool !== "none") {
        const exactElement = document.getElementById(pdfAnnotationElementId(entry.sourceId));
        if (!isUsableAnnotationElement(exactElement, entry)) {
          setPdfjsEditorMode("none");
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      const element = annotationTargetElementForEntry(entry);
      if (element) {
        selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        await focusAnnotationElement(element, {
          scrollIntoView: options.scrollIntoView,
          showFocusBox: false,
        });
        if (await activatePersistedEditorEntry(entry, { scrollIntoView: options.scrollIntoView })) {
          return true;
        }
        const editorKind = editorKindForAnnotationEntry(entry);
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + Math.min(Math.max(rect.width / 2, 4), Math.max(rect.width - 4, 4)));
        const y = Math.round(rect.top + Math.min(Math.max(rect.height / 2, 4), Math.max(rect.height - 4, 4)));
        const activated =
          editorKind === "highlight"
            ? await activateHighlightEditorAtPoint(x, y)
            : editorKind === "freetext"
              ? await activateFreeTextEditorAtPoint(x, y)
              : await activateInkEditorAtPoint(x, y);
        if (!activated && entry.kind === "ink") {
          return locatePdfAnnotationEntry(entry);
        }
        return activated;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    status = `Could not find ${entry.label.toLowerCase()} on page ${entry.page}.`;
    if (entry.kind === "ink" && entry.bounds && locatePdfAnnotationBounds(entry)) {
      return true;
    }
    return false;
  }

  function locatePdfAnnotationEntry(entry: AnnotationEntry) {
    clearLocateOnlyEditorSelection();
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    queueLocateOnlyEditorSelectionClear();
    return true;
  }

  function locatePdfAnnotationBounds(entry: AnnotationEntry) {
    return locateAnnotationBounds(entry);
  }

  function locateAnnotationBounds(entry: AnnotationEntry, options: { scrollIntoView?: boolean } = {}) {
    if (!containerEl) return false;
    clearLocateOnlyEditorSelection();
    const focusBox = renderedAnnotationShapeFocusBox(entry) ?? annotationEntryFocusBox(entry);
    if (!focusBox) return false;
    const { left, top, width, height } = focusBox;

    if (options.scrollIntoView !== false) {
      containerEl.scrollLeft = Math.max(0, left + width / 2 - containerEl.clientWidth / 2);
      containerEl.scrollTop = Math.max(0, top + height / 2 - containerEl.clientHeight / 2);
    }
    annotationFocusBox = focusBox;
    unselectAllIgnoringPdfjsSignalBug();
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = entry.source === "pdf" ? persistedAnnotationKey(entry.page, entry.sourceId) : null;
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    queueLocateOnlyEditorSelectionClear();
    return true;
  }

  function annotationEntryFocusBox(entry: AnnotationEntry): FocusBox | null {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
    if (!pageElement || !entry.bounds) return null;
    return {
      left: pageElement.offsetLeft + entry.bounds.left * pageElement.offsetWidth - 3,
      top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight - 3,
      width: Math.max(6, (entry.bounds.right - entry.bounds.left) * pageElement.offsetWidth + 6),
      height: Math.max(6, (entry.bounds.bottom - entry.bounds.top) * pageElement.offsetHeight + 6),
    };
  }

  function renderedAnnotationShapeFocusBox(entry: AnnotationEntry): FocusBox | null {
    if (!isInkHighlightEntry(entry) || !containerEl) return null;
    const element = document.getElementById(pdfAnnotationElementId(entry.sourceId));
    if (!(element instanceof HTMLElement)) return null;
    const shapeRects = [...element.querySelectorAll("path, polyline, polygon, line, rect, circle, ellipse")]
      .map((shape) => shape.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (shapeRects.length === 0) return null;
    const rect = {
      left: Math.min(...shapeRects.map((candidate) => candidate.left)),
      top: Math.min(...shapeRects.map((candidate) => candidate.top)),
      right: Math.max(...shapeRects.map((candidate) => candidate.right)),
      bottom: Math.max(...shapeRects.map((candidate) => candidate.bottom)),
    };
    const containerRect = containerEl.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left + containerEl.scrollLeft - 3,
      top: rect.top - containerRect.top + containerEl.scrollTop - 3,
      width: Math.max(6, rect.right - rect.left + 6),
      height: Math.max(6, rect.bottom - rect.top + 6),
    };
  }

  function clearLocateOnlyEditorSelection() {
    unselectAllIgnoringPdfjsSignalBug();
    setPdfjsEditorMode(activeTool);
    document.querySelectorAll<HTMLElement>(".editToolbar:not(.hidden)").forEach((toolbar) => {
      toolbar.classList.add("hidden");
    });
    document.querySelectorAll<HTMLElement>(".selectedEditor").forEach((editor) => {
      editor.classList.remove("selectedEditor");
    });
  }

  function queueLocateOnlyEditorSelectionClear() {
    for (const delay of [0, 50, 150]) {
      setTimeout(() => {
        if (!selectedAnnotationKind && annotationFocusBox) {
          clearLocateOnlyEditorSelection();
        }
      }, delay);
    }
  }

  async function activatePersistedEditorEntry(
    entry: AnnotationEntry,
    options: { scrollIntoView?: boolean } = {},
  ) {
    const manager = annotationEditorUIManager;
    const editorKind = editorKindForAnnotationEntry(entry);
    const tool = editorToolForAnnotationKind(editorKind);
    if (!manager || !tool || !managerHasValidSignal(manager)) return false;
    await preparePdfjsEditorModeForEdit(tool);
    let editor = findEditorByPersistedSourceId(entry.sourceId, editorKind, manager);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findEditorByPersistedSourceId(entry.sourceId, editorKind, manager);
    }
    if (
      !editor ||
      annotationEditorUIManager !== manager ||
      !managerHasValidSignal(manager) ||
      !editorBelongsToManager(editor, manager) ||
      !editorHasValidManagerSignal(editor)
    ) {
      return false;
    }
    const persistedKey = persistedAnnotationKey(entry.page, entry.sourceId);
    selectedPersistedAnnotationKey = persistedKey;
    persistedAnnotationKeyByEditorId.set(editor.id, persistedKey);
    await focusEditorById(editor.id, { scrollIntoView: options.scrollIntoView, showFocusBox: false });
    selectEditorIgnoringPdfjsSignalBug(manager, editor);
    syncSelectedEditorState(persistedKey);
    selectedAnnotationEntryId = entry.id;
    if (editorKind === "highlight") {
      status = "Selected highlight. Change color or delete it, then save.";
    } else if (editorKind === "freetext") {
      status = "Selected free text. Press Enter to edit text, change color, or delete it.";
    } else {
      status = "Selected ink. Change color or delete it, then save.";
    }
    return true;
  }

  function editorKindForAnnotationEntry(entry: AnnotationEntry): Exclude<SelectedAnnotationKind, null> {
    return isInkHighlightEntry(entry) ? "highlight" : entry.kind;
  }

  function editorToolForAnnotationKind(kind: Exclude<SelectedAnnotationKind, null>): EditorTool | null {
    if (kind === "highlight") return "highlight";
    if (kind === "freetext") return "text";
    if (kind === "ink") return "ink";
    return null;
  }

  function findEditorByPersistedSourceId(
    sourceId: string,
    kind: Exclude<SelectedAnnotationKind, null>,
    manager = annotationEditorUIManager,
  ) {
    if (!manager || !pdfDocument) return null;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of manager.getEditors(pageIndex)) {
        if (
          editorBelongsToManager(editor, manager) &&
          !editor.deleted &&
          annotationKindForEditor(editor) === kind &&
          persistedSourceIdForEditor(editor) === sourceId
        ) {
          return editor;
        }
      }
    }
    return null;
  }

  function editorBelongsToCurrentManager(editor: AnnotationEditor | null | undefined) {
    if (!editor || !annotationEditorUIManager) return false;
    return editorBelongsToManager(editor, annotationEditorUIManager);
  }

  function unselectAllIgnoringPdfjsSignalBug(manager = annotationEditorUIManager) {
    unselectAllForManagerIgnoringSignalBug(manager);
  }

  function annotationTargetElementForEntry(entry: AnnotationEntry) {
    const exactElement =
      entry.source === "pdf" ? document.getElementById(pdfAnnotationElementId(entry.sourceId)) : null;
    if (isUsableAnnotationElement(exactElement, entry)) {
      return exactElement;
    }

    const elements = annotationTargetElements(entry.page, entry.kind);
    if (entry.bounds) {
      const best = elements
        .map((element) => {
          const bounds = elementPageBounds(element);
          return bounds
            ? {
                element,
                overlapRatio: boundsOverlapRatio(bounds, entry.bounds as RectLike),
                centerDistance: rectCenterDistance(bounds, entry.bounds as RectLike),
              }
            : null;
        })
        .filter((match): match is { element: HTMLElement; overlapRatio: number; centerDistance: number } =>
          Boolean(match),
        )
        .sort((left, right) => right.overlapRatio - left.overlapRatio || left.centerDistance - right.centerDistance)[0];
      if (best && best.overlapRatio > 0.55) {
        return best.element;
      }
    }

    return elements[entry.targetIndex] ?? null;
  }

  function isUsableAnnotationElement(element: HTMLElement | null, entry: AnnotationEntry) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const page = element.closest<HTMLElement>(".page");
    const bounds = entry.bounds ? elementPageBounds(element) : null;
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      page?.dataset.pageNumber === String(entry.page) &&
      annotationTargetElements(entry.page, entry.kind).includes(element) &&
      (!entry.bounds || (bounds !== null && boundsOverlapRatio(bounds, entry.bounds) > 0.55))
    );
  }

  function annotationTargetElements(pageNumber: number, kind: Exclude<SelectedAnnotationKind, null>) {
    const selector =
      kind === "highlight"
        ? `.page[data-page-number="${pageNumber}"] .highlightAnnotation, .page[data-page-number="${pageNumber}"] .highlightEditor`
        : kind === "freetext"
          ? `.page[data-page-number="${pageNumber}"] .freeTextAnnotation, .page[data-page-number="${pageNumber}"] .freeTextEditor`
          : `.page[data-page-number="${pageNumber}"] .inkAnnotation, .page[data-page-number="${pageNumber}"] .inkEditor`;
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
      });
  }

  function targetIndexForEditor(
    pageNumber: number,
    kind: Exclude<SelectedAnnotationKind, null>,
    editorId: string,
    fallbackTargetIndex: number,
  ) {
    const elements = annotationTargetElements(pageNumber, kind);
    const index = elements.findIndex((element) => element.id === editorId);
    return index >= 0 ? index : fallbackTargetIndex;
  }

  function annotationTargetPosition(
    pageNumber: number,
    kind: Exclude<SelectedAnnotationKind, null>,
    targetIndex: number,
    editorId?: string,
  ) {
    const elements = annotationTargetElements(pageNumber, kind);
    const element = (editorId ? elements.find((candidate) => candidate.id === editorId) : null) ?? elements[targetIndex];
    if (!element) {
      return { top: Number.MAX_SAFE_INTEGER, left: Number.MAX_SAFE_INTEGER };
    }
    const page = element.closest<HTMLElement>(".page");
    const elementRect = element.getBoundingClientRect();
    const pageRect = page?.getBoundingClientRect();
    return {
      top: pageRect ? elementRect.top - pageRect.top : elementRect.top,
      left: pageRect ? elementRect.left - pageRect.left : elementRect.left,
    };
  }

  function annotationTargetBounds(
    pageNumber: number,
    kind: Exclude<SelectedAnnotationKind, null>,
    targetIndex: number,
    editorId?: string,
  ) {
    const elements = annotationTargetElements(pageNumber, kind);
    const element = (editorId ? elements.find((candidate) => candidate.id === editorId) : null) ?? elements[targetIndex];
    return element ? elementPageBounds(element) : null;
  }

  function elementPageBounds(element: HTMLElement) {
    const page = element.closest<HTMLElement>(".page");
    if (!page) return null;
    const elementRect = element.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    return rectToPagePercent(
      {
        left: elementRect.left - pageRect.left,
        top: elementRect.top - pageRect.top,
        right: elementRect.right - pageRect.left,
        bottom: elementRect.bottom - pageRect.top,
      },
      pageRect.width,
      pageRect.height,
    );
  }


  async function focusAnnotationElement(
    element: HTMLElement,
    options: { scrollIntoView?: boolean; showFocusBox?: boolean } = {},
  ) {
    const rect = element.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const left = rect.left - containerRect.left + containerEl.scrollLeft - 3;
    const top = rect.top - containerRect.top + containerEl.scrollTop - 3;
    const width = rect.width + 6;
    const height = rect.height + 6;

    if (options.scrollIntoView !== false) {
      containerEl.scrollLeft = Math.max(0, left + width / 2 - containerEl.clientWidth / 2);
      containerEl.scrollTop = Math.max(0, top + height / 2 - containerEl.clientHeight / 2);
    }
    if (options.showFocusBox !== false) {
      annotationFocusBox = { left, top, width, height };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  async function focusEditorById(
    editorId: string,
    options: { scrollIntoView?: boolean; showFocusBox?: boolean } = {},
  ) {
    const element = document.getElementById(editorId);
    if (element instanceof HTMLElement) {
      await focusAnnotationElement(element, options);
    }
  }

  function setTool(tool: EditorTool) {
    if (!pdfViewer) return;
    activeTool = tool;
    setPdfjsEditorMode(tool);
    status =
      tool === "none"
        ? "Selection mode."
        : tool === "highlight"
          ? "Highlight mode. Drag across text to create a highlight."
          : `${toolLabel(tool)} mode. Create an annotation, then save.`;
  }

  function setPdfjsEditorMode(tool: EditorTool, options: { applyDefaultParams?: boolean } = {}) {
    if (!pdfViewer) return;
    const applyDefaultParams = options.applyDefaultParams !== false;
    if (applyDefaultParams && tool === "highlight" && annotationEditorUIManager) {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        highlightColors[defaultHighlightColor],
      );
    }
    pdfViewer.annotationEditorMode = { mode: editorModes[tool] };
    if (applyDefaultParams && tool === "text" && annotationEditorUIManager) {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
        freeTextColors[defaultFreeTextColor],
      );
    }
    if (applyDefaultParams && tool === "ink" && annotationEditorUIManager) {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
        { color: inkColors[defaultInkColor], opacity: defaultInkOpacity },
      );
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
        defaultInkThickness,
      );
    }
    syncInkEditorHitAreas();
  }

  async function preparePdfjsEditorModeForEdit(tool: EditorTool) {
    setPdfjsEditorMode(tool, { applyDefaultParams: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async function activateHighlightEditorAtPoint(clientX: number, clientY: number) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = selectedPersistedAnnotationKey;
    await preparePdfjsEditorModeForEdit("highlight");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = editorElementAtPoint(".highlightEditor", clientX, clientY);
      if (editorElement instanceof HTMLElement) {
        editorElement.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            buttons: 0,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        syncSelectedEditorState(persistedKeyHint);
        if (selectedEditorMatchesPersistedHint(annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)) {
          status = "Selected highlight. Change color or delete it, then save.";
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    status = "Could not activate clicked highlight for editing.";
    return false;
  }

  function selectedEditorMatchesPersistedHint(
    editor: AnnotationEditor | null | undefined,
    persistedKeyHint: string | null,
  ) {
    if (!editor || !editorBelongsToCurrentManager(editor)) return false;
    return !persistedKeyHint || persistedAnnotationKeyForEditor(editor) === persistedKeyHint;
  }

  function editorElementAtPoint(selector: string, clientX: number, clientY: number) {
    const directElement = document.elementFromPoint(clientX, clientY)?.closest(selector);
    if (directElement instanceof HTMLElement) {
      return directElement;
    }
    const editorId = findEditorElementIdAtPoint(selector, clientX, clientY);
    const editorElement = editorId ? document.getElementById(editorId) : null;
    return editorElement instanceof HTMLElement ? editorElement : null;
  }

  function findHighlightEditorById(editorId: string) {
    return findEditorById(editorId, isHighlightEditor);
  }

  function findFreeTextEditorById(editorId: string) {
    return findEditorById(editorId, isFreeTextEditor);
  }

  function findInkEditorById(editorId: string) {
    return findEditorById(editorId, isInkEditor);
  }

  function findEditorById(editorId: string, predicate: (editor: AnnotationEditor) => boolean) {
    if (!annotationEditorUIManager || !pdfDocument) {
      return null;
    }
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (editorBelongsToCurrentManager(editor) && predicate(editor) && !editor.deleted && editor.id === editorId) {
          return editor;
        }
      }
    }
    return null;
  }

  async function activateExistingHighlightEditor(editorId: string, options: { focusEditor?: boolean } = {}) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("highlight");
    let editor = findHighlightEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findHighlightEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked highlight for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    annotationEditorUIManager.setSelected(editor);
    selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  async function activateExistingFreeTextEditor(editorId: string, options: { focusEditor?: boolean } = {}) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Free text unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("text");
    let editor = findFreeTextEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findFreeTextEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked free text for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    annotationEditorUIManager.setSelected(editor);
    selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    status = "Selected free text. Press Enter to edit text, change color, or delete it.";
    return true;
  }

  async function activateFreeTextEditorAtPoint(clientX: number, clientY: number) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Free text unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = selectedPersistedAnnotationKey;
    await preparePdfjsEditorModeForEdit("text");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = editorElementAtPoint(".freeTextEditor", clientX, clientY);
      if (editorElement instanceof HTMLElement) {
        editorElement.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            buttons: 0,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.click();
        const editor = findFreeTextEditorById(editorElement.id);
        if (editor) {
          annotationEditorUIManager.setSelected(editor);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        syncSelectedEditorState(persistedKeyHint);
        if (
          isFreeTextEditor(annotationEditorUIManager.firstSelectedEditor) &&
          selectedEditorMatchesPersistedHint(annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)
        ) {
          status = "Selected free text. Press Enter to edit text, change color, or delete it.";
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    status = "Could not activate clicked free text for editing.";
    return false;
  }

  async function activateExistingInkEditor(editorId: string, options: { focusEditor?: boolean } = {}) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Ink unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("ink");
    let editor = findInkEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findInkEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked ink for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    annotationEditorUIManager.setSelected(editor);
    selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    status = "Selected ink. Change color or delete it, then save.";
    return true;
  }

  async function activateInkEditorAtPoint(clientX: number, clientY: number) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Ink unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = selectedPersistedAnnotationKey;
    await preparePdfjsEditorModeForEdit("ink");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = editorElementAtPoint(".inkEditor", clientX, clientY);
      if (editorElement instanceof HTMLElement) {
        editorElement.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            buttons: 0,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        editorElement.click();
        const editor = findInkEditorById(editorElement.id);
        if (editor) {
          annotationEditorUIManager.setSelected(editor);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        syncSelectedEditorState(persistedKeyHint);
        if (
          isInkEditor(annotationEditorUIManager.firstSelectedEditor) &&
          selectedEditorMatchesPersistedHint(annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)
        ) {
          status = "Selected ink. Change color or delete it, then save.";
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    status = "Could not activate clicked ink for editing.";
    return false;
  }

  function findEditorElementIdAtPoint(selector: string, clientX: number, clientY: number) {
    const matchingEditors = [...document.querySelectorAll<HTMLElement>(selector)]
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        zIndex: Number.parseInt(getComputedStyle(element).zIndex || "0", 10) || 0,
      }))
      .filter(
        ({ rect }) =>
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom,
      )
      .sort((left, right) => right.zIndex - left.zIndex);
    return matchingEditors[0]?.element.id ?? null;
  }

  function findDisabledHighlightEditorIdAtPoint(clientX: number, clientY: number) {
    return findEditorElementIdAtPoint(".highlightEditor.disabled", clientX, clientY);
  }

  function findFreeTextEditorIdAtPoint(clientX: number, clientY: number) {
    return findEditorElementIdAtPoint(".freeTextEditor", clientX, clientY);
  }

  function findInkEditorIdAtPoint(clientX: number, clientY: number) {
    return findEditorElementIdAtPoint(".inkEditor", clientX, clientY);
  }

  function inkHighlightEntryAtPoint(clientX: number, clientY: number) {
    return inkAnnotationEntryAtPoint(clientX, clientY, isInkHighlightEntry);
  }

  function inkAnnotationEntryAtPoint(
    clientX: number,
    clientY: number,
    predicate: (entry: AnnotationEntry) => boolean = (entry) => entry.kind === "ink",
  ) {
    const visualMatches = annotationEntries
      .filter((entry) => entry.kind === "ink" && predicate(entry))
      .map((entry) => {
        const element =
          entry.source === "live"
            ? document.getElementById(entry.sourceId)
            : document.getElementById(pdfAnnotationElementId(entry.sourceId));
        const shapeRects = [...(element?.querySelectorAll("path, polyline, polygon, line, rect, circle, ellipse") ?? [])]
          .map((shape) => shape.getBoundingClientRect())
          .filter((rect) => rect.width > 0 || rect.height > 0);
        if (shapeRects.length === 0) return null;
        const tolerance = 8;
        const contains = shapeRects.some(
          (rect) =>
            clientX >= rect.left - tolerance &&
            clientX <= rect.right + tolerance &&
            clientY >= rect.top - tolerance &&
            clientY <= rect.bottom + tolerance,
        );
        if (!contains) return null;
        return {
          entry,
          area: shapeRects.reduce(
            (sum, rect) => sum + Math.max(1, rect.width) * Math.max(1, rect.height),
            0,
          ),
        };
      })
      .filter((match): match is { entry: AnnotationEntry; area: number } => Boolean(match))
      .sort((left, right) => left.area - right.area);
    if (visualMatches[0]) return visualMatches[0].entry;

    const boundsMatches = annotationEntries
      .filter((entry) => entry.kind === "ink" && predicate(entry) && entry.bounds)
      .map((entry) => {
        const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
        if (!pageElement || !entry.bounds) return null;
        const rect = pageElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const left = rect.left + entry.bounds.left * rect.width;
        const right = rect.left + entry.bounds.right * rect.width;
        const top = rect.top + entry.bounds.top * rect.height;
        const bottom = rect.top + entry.bounds.bottom * rect.height;
        return {
          entry,
          area: Math.max(0, right - left) * Math.max(0, bottom - top),
          contains: clientX >= left && clientX <= right && clientY >= top && clientY <= bottom,
        };
      })
      .filter((match): match is { entry: AnnotationEntry; area: number; contains: boolean } => Boolean(match?.contains))
      .sort((left, right) => left.area - right.area);
    return boundsMatches[0]?.entry ?? null;
  }

  function nonInkAnnotationEntryAtPoint(clientX: number, clientY: number) {
    const matches = annotationEntries
      .filter((entry) => entry.kind !== "ink" && entry.bounds)
      .map((entry) => {
        const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
        if (!pageElement || !entry.bounds) return null;
        const rect = pageElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const left = rect.left + entry.bounds.left * rect.width;
        const right = rect.left + entry.bounds.right * rect.width;
        const top = rect.top + entry.bounds.top * rect.height;
        const bottom = rect.top + entry.bounds.bottom * rect.height;
        return {
          entry,
          area: Math.max(0, right - left) * Math.max(0, bottom - top),
          contains: clientX >= left && clientX <= right && clientY >= top && clientY <= bottom,
        };
      })
      .filter((match): match is { entry: AnnotationEntry; area: number; contains: boolean } => Boolean(match?.contains))
      .sort((left, right) => left.area - right.area);
    return matches[0]?.entry ?? null;
  }

  function markInkHighlightEntrySelected(entry: AnnotationEntry) {
    let selectedEditor: AnnotationEditor | null | undefined = annotationEditorUIManager?.firstSelectedEditor;
    if (!selectedEditor && annotationEditorUIManager) {
      selectedEditor =
        findEditorByPersistedSourceId(entry.sourceId, "highlight") ??
        findEditorByPersistedSourceId(entry.sourceId, "ink");
      if (selectedEditor) {
        annotationEditorUIManager.setSelected(selectedEditor);
      }
    }
    const persistedKey = persistedAnnotationKey(entry.page, entry.sourceId);
    selectedAnnotationKind = "highlight";
    hasSelectedHighlight = true;
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = persistedKey;
    selectedAnnotationColor = selectedEditor?.color ?? selectedAnnotationColor;
    selectedHighlightColor = highlightColorNameForValue(selectedAnnotationColor);
    if (selectedEditor) {
      persistedAnnotationKeyByEditorId.set(selectedEditor.id, persistedKey);
    }
    status = "Selected highlight. Change color or delete it, then save.";
  }

  function remapSelectedInkHighlightEntry() {
    const entry =
      persistedAnnotationEntryForKey(selectedPersistedAnnotationKey) ??
      annotationEntries.find((candidate) => candidate.id === selectedAnnotationEntryId);
    if (!entry || !isInkHighlightEntry(entry)) {
      return false;
    }
    markInkHighlightEntrySelected(entry);
    return true;
  }

  function activateInkHighlightEntryAtPoint(entry: AnnotationEntry, clientX: number, clientY: number) {
    selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    void (async () => {
      let activated = false;
      if (findInkEditorIdAtPoint(clientX, clientY)) {
        activated = await activateInkEditorAtPoint(clientX, clientY);
      }
      if (!activated) {
        selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        activated = await activateHighlightEditorAtPoint(clientX, clientY);
      }
      if (!activated) {
        selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        activated = await activateInkEditorAtPoint(clientX, clientY);
      }
      if (!activated) {
        locatePdfAnnotationBounds(entry);
        return;
      }
      markInkHighlightEntrySelected(entry);
    })();
  }

  function annotationEntryForPointerTarget(target: Element, clientX: number, clientY: number) {
    const savedAnnotation = target.closest(".highlightAnnotation");
    const savedFreeTextAnnotation = target.closest(".freeTextAnnotation");
    const savedInkAnnotation = target.closest(".inkAnnotation");
    const directDisabledEditorId = target.closest<HTMLElement>(".highlightEditor.disabled")?.id ?? null;
    const directHighlightEditorId = target.closest<HTMLElement>(".highlightEditor:not(.disabled)")?.id ?? null;
    const directFreeTextEditorId = target.closest<HTMLElement>(".freeTextEditor")?.id ?? null;
    const directInkEditorId = target.closest<HTMLElement>(".inkEditor")?.id ?? null;
    return (
      inkHighlightEntryAtPoint(clientX, clientY) ??
      annotationEntryForEditorId(directDisabledEditorId) ??
      annotationEntryForEditorId(directHighlightEditorId) ??
      annotationEntryForEditorId(directFreeTextEditorId) ??
      annotationEntryForEditorId(directInkEditorId) ??
      persistedAnnotationEntryForElement(savedAnnotation) ??
      persistedAnnotationEntryForElement(savedFreeTextAnnotation) ??
      persistedAnnotationEntryForElement(savedInkAnnotation) ??
      inkAnnotationEntryAtPoint(clientX, clientY) ??
      nonInkAnnotationEntryAtPoint(clientX, clientY)
    );
  }

  function activateAnnotationTargetForEdit(target: Element, clientX: number, clientY: number) {
    const savedAnnotation = target.closest(".highlightAnnotation");
    const savedFreeTextAnnotation = target.closest(".freeTextAnnotation");
    const savedInkAnnotation = target.closest(".inkAnnotation");
    const directDisabledEditorId = target.closest<HTMLElement>(".highlightEditor.disabled")?.id ?? null;
    const directHighlightEditorId = target.closest<HTMLElement>(".highlightEditor:not(.disabled)")?.id ?? null;
    const directFreeTextEditorId = target.closest<HTMLElement>(".freeTextEditor")?.id ?? null;
    const directInkEditorId = target.closest<HTMLElement>(".inkEditor")?.id ?? null;
    if (directHighlightEditorId) {
      const directInkHighlightEntry = inkHighlightEntryAtPoint(clientX, clientY);
      if (directInkHighlightEntry) {
        void activateExistingHighlightEditor(directHighlightEditorId, { focusEditor: false }).then((activated) => {
          if (!activated) return;
          selectedAnnotationKind = "highlight";
          hasSelectedHighlight = true;
          selectedAnnotationEntryId = directInkHighlightEntry.id;
          selectedPersistedAnnotationKey = persistedAnnotationKey(
            directInkHighlightEntry.page,
            directInkHighlightEntry.sourceId,
          );
          status = "Selected highlight. Change color or delete it, then save.";
        });
        return true;
      }
      void activateExistingHighlightEditor(directHighlightEditorId, { focusEditor: false });
      return true;
    }
    if (directDisabledEditorId) {
      void activateExistingHighlightEditor(directDisabledEditorId, { focusEditor: false });
      return true;
    }
    if (directFreeTextEditorId) {
      void activateExistingFreeTextEditor(directFreeTextEditorId, { focusEditor: false });
      return true;
    }
    if (directInkEditorId) {
      const entry = annotationEntryForEditorId(directInkEditorId);
      if (entry && isInkHighlightEntry(entry)) {
        activateInkHighlightEntryAtPoint(entry, clientX, clientY);
        return true;
      }
      void activateExistingInkEditor(directInkEditorId, { focusEditor: false });
      return true;
    }
    const inkHighlightEntry = inkHighlightEntryAtPoint(clientX, clientY);
    if (inkHighlightEntry) {
      activateInkHighlightEntryAtPoint(inkHighlightEntry, clientX, clientY);
      return true;
    }
    if (savedFreeTextAnnotation) {
      rememberPersistedAnnotationElement(savedFreeTextAnnotation);
      void activateFreeTextEditorAtPoint(clientX, clientY);
      return true;
    }
    if (savedInkAnnotation) {
      const entry = persistedAnnotationEntryForElement(savedInkAnnotation);
      if (entry && isInkHighlightEntry(entry)) {
        activateInkHighlightEntryAtPoint(entry, clientX, clientY);
        return true;
      }
      rememberPersistedAnnotationElement(savedInkAnnotation);
      void activateInkEditorAtPoint(clientX, clientY);
      return true;
    }
    if (savedAnnotation) {
      rememberPersistedAnnotationElement(savedAnnotation);
      void activateHighlightEditorAtPoint(clientX, clientY);
      return true;
    }
    return false;
  }

  function activateAnnotationEntryForEdit(entry: AnnotationEntry, clientX: number, clientY: number) {
    if (entry.source === "live") {
      if (entry.kind === "highlight") {
        void activateExistingHighlightEditor(entry.sourceId, { focusEditor: false });
      } else if (entry.kind === "freetext") {
        void activateExistingFreeTextEditor(entry.sourceId, { focusEditor: false });
      } else {
        void activateExistingInkEditor(entry.sourceId, { focusEditor: false });
      }
      return true;
    }
    if (isInkHighlightEntry(entry)) {
      activateInkHighlightEntryAtPoint(entry, clientX, clientY);
      return true;
    }
    void activatePdfAnnotationEntry(entry, { scrollIntoView: false });
    return true;
  }

  function handlePdfDoubleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".editToolbar")) {
      return;
    }
    const entry = annotationEntryForPointerTarget(target, event.clientX, event.clientY);
    if (
      (entry && activateAnnotationEntryForEdit(entry, event.clientX, event.clientY)) ||
      activateAnnotationTargetForEdit(target, event.clientX, event.clientY)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleHighlightTextLayerPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element) || activeTool !== "highlight") {
      return;
    }
    const textLayer = target.closest<HTMLElement>(".textLayer");
    if (!textLayer || !textLayer.contains(target)) {
      return;
    }
    const isFreeHighlightTarget =
      target === textLayer ||
      target.getAttribute("role") === "img" ||
      target.classList.contains("endOfContent") ||
      target.classList.contains("textLayerImages") ||
      target.classList.contains("textLayerImagePlaceholder");
    if (!isFreeHighlightTarget) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handlePdfPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    clearRememberedSelection();
    const savedAnnotation = target.closest(".highlightAnnotation");
    const savedFreeTextAnnotation = target.closest(".freeTextAnnotation");
    const savedInkAnnotation = target.closest(".inkAnnotation");
    const directDisabledEditorId = target.closest<HTMLElement>(".highlightEditor.disabled")?.id ?? null;
    const directHighlightEditorId = target.closest<HTMLElement>(".highlightEditor:not(.disabled)")?.id ?? null;
    const directFreeTextEditorId = target.closest<HTMLElement>(".freeTextEditor")?.id ?? null;
    const directInkEditorId = target.closest<HTMLElement>(".inkEditor")?.id ?? null;
    const editableEditor = target.closest<HTMLElement>(".highlightEditor:not(.disabled), .freeTextEditor, .inkEditor");
    if (target.closest(".editToolbar")) {
      queueEditorStateRefresh(0, 100, 250);
      return;
    }
    const clickedEntry = annotationEntryForPointerTarget(target, event.clientX, event.clientY);
    if (clickedEntry && (!selectedAnnotationKind || !annotationEntryMatchesCurrentSelection(clickedEntry))) {
      if (isRepeatedAnnotationPointerClick(clickedEntry, event)) {
        lastAnnotationPointerClick = null;
        event.preventDefault();
        event.stopPropagation();
        activateAnnotationEntryForEdit(clickedEntry, event.clientX, event.clientY);
        return;
      }
      if (selectedAnnotationKind || isAnnotationCreationMode()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    lastAnnotationPointerClick = null;
    if (directHighlightEditorId) {
      const directInkHighlightEntry = isAnnotationCreationMode()
        ? null
        : inkHighlightEntryAtPoint(event.clientX, event.clientY);
      if (directInkHighlightEntry) {
        void activateExistingHighlightEditor(directHighlightEditorId, { focusEditor: false }).then((activated) => {
          if (!activated) return;
          selectedAnnotationKind = "highlight";
          hasSelectedHighlight = true;
          selectedAnnotationEntryId = directInkHighlightEntry.id;
          selectedPersistedAnnotationKey = persistedAnnotationKey(
            directInkHighlightEntry.page,
            directInkHighlightEntry.sourceId,
          );
          status = "Selected highlight. Change color or delete it, then save.";
        });
        queueEditorStateRefresh(0, 100, 250);
        return;
      }
    }
    if (editableEditor && !directInkEditorId) {
      if (directFreeTextEditorId) {
        void activateExistingFreeTextEditor(directFreeTextEditorId, { focusEditor: false });
      }
      queueEditorStateRefresh(0, 100, 250);
      return;
    }
    const inkHighlightEntry = isAnnotationCreationMode()
      ? null
      : inkHighlightEntryAtPoint(event.clientX, event.clientY);
    if (inkHighlightEntry) {
      event.preventDefault();
      event.stopPropagation();
      activateInkHighlightEntryAtPoint(inkHighlightEntry, event.clientX, event.clientY);
      return;
    }
    if (editableEditor) {
      if (directInkEditorId) {
        const entry = annotationEntryForEditorId(directInkEditorId);
        if (entry && isInkHighlightEntry(entry)) {
          event.preventDefault();
          event.stopPropagation();
          activateInkHighlightEntryAtPoint(entry, event.clientX, event.clientY);
          return;
        }
        void activateExistingInkEditor(directInkEditorId, { focusEditor: false });
      }
      queueEditorStateRefresh(0, 100, 250);
      return;
    }
    if (
      isAnnotationCreationMode() &&
      !directDisabledEditorId &&
      !savedAnnotation &&
      !savedFreeTextAnnotation &&
      !savedInkAnnotation &&
      !directFreeTextEditorId &&
      !directInkEditorId
    ) {
      if (annotationFocusBox || selectedAnnotationEntryId || selectedPersistedAnnotationKey || selectedAnnotationKind) {
        clearAnnotationFocusSelection(true);
      }
      return;
    }
    const disabledEditorId = directDisabledEditorId ?? findDisabledHighlightEditorIdAtPoint(event.clientX, event.clientY);
    const freeTextEditorId = directFreeTextEditorId ?? findFreeTextEditorIdAtPoint(event.clientX, event.clientY);
    const inkEditorId = directInkEditorId ?? findInkEditorIdAtPoint(event.clientX, event.clientY);
    const clickedAnnotationOrEditor = Boolean(
      disabledEditorId ||
        savedAnnotation ||
        savedFreeTextAnnotation ||
        savedInkAnnotation ||
        freeTextEditorId ||
        inkEditorId,
    );
    if (
      !disabledEditorId &&
      !savedAnnotation &&
      !savedFreeTextAnnotation &&
      !savedInkAnnotation &&
      !freeTextEditorId &&
      !inkEditorId
    ) {
      clearAnnotationFocusSelection();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (disabledEditorId) {
      void activateExistingHighlightEditor(disabledEditorId, { focusEditor: false });
      return;
    }
    if (freeTextEditorId) {
      void activateExistingFreeTextEditor(freeTextEditorId, { focusEditor: false });
      return;
    }
    if (inkEditorId) {
      const entry = annotationEntryForEditorId(inkEditorId);
      if (entry && isInkHighlightEntry(entry)) {
        activateInkHighlightEntryAtPoint(entry, event.clientX, event.clientY);
        return;
      }
      void activateExistingInkEditor(inkEditorId, { focusEditor: false });
      return;
    }
    if (savedFreeTextAnnotation) {
      rememberPersistedAnnotationElement(savedFreeTextAnnotation);
      void activateFreeTextEditorAtPoint(event.clientX, event.clientY);
      return;
    }
    if (savedInkAnnotation) {
      const entry = persistedAnnotationEntryForElement(savedInkAnnotation);
      if (entry && isInkHighlightEntry(entry)) {
        activateInkHighlightEntryAtPoint(entry, event.clientX, event.clientY);
        return;
      }
      rememberPersistedAnnotationElement(savedInkAnnotation);
      void activateInkEditorAtPoint(event.clientX, event.clientY);
      return;
    }
    rememberPersistedAnnotationElement(savedAnnotation);
    void activateHighlightEditorAtPoint(event.clientX, event.clientY);
  }

  function getSelectionAnchorElement(selection: Selection) {
    const anchorNode = selection.anchorNode;
    return anchorNode?.nodeType === Node.TEXT_NODE
      ? anchorNode.parentElement
      : anchorNode instanceof Element
        ? anchorNode
        : null;
  }

  function countHighlightEditorsInManager() {
    if (!annotationEditorUIManager || !pdfDocument) {
      return 0;
    }
    let count = 0;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted) {
          count += 1;
        }
      }
    }
    return count;
  }

  async function createHighlightFromSelection({
    createdStatus,
    methodOfCreation,
    resetModeToNone,
  }: {
    createdStatus: string;
    methodOfCreation: string;
    resetModeToNone: boolean;
  }) {
    const uiManager = annotationEditorUIManager;
    const viewer = pdfViewer;
    if (!uiManager || !viewer) {
      status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const selection = document.getSelection();
    const liveSelectionText = selection?.toString().trim() ?? "";
    const selectionText = liveSelectionText || rememberedSelectionText;
    const ranges =
      selection && liveSelectionText
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : rememberedSelectionRanges.map((range) => range.cloneRange());
    if (!selectionText || ranges.length === 0) {
      status = "Select text in the PDF first, then press Highlight.";
      return false;
    }
    let before = countHighlightEditorsInManager();
    let previousHighlightEditorIds = new Set(highlightEditorIds());
    const switchedIntoHighlightMode = activeTool !== "highlight";
    const finishCreatedHighlight = () => {
      cacheNewHighlightDetails(previousHighlightEditorIds, selectionText);
      document.getSelection()?.removeAllRanges();
      if (resetModeToNone) {
        setTool("none");
        unselectAllIgnoringPdfjsSignalBug();
        syncSelectedEditorState();
      }
      rememberedSelectionText = "";
      rememberedSelectionRanges = [];
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = createdStatus;
      return true;
    };
    if (switchedIntoHighlightMode) {
      setTool("highlight");
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (hasNewUnsavedHighlightEditor(previousHighlightEditorIds)) {
        return finishCreatedHighlight();
      }
      before = countHighlightEditorsInManager();
      previousHighlightEditorIds = new Set(highlightEditorIds());
    }
    unselectAllIgnoringPdfjsSignalBug(uiManager);
    syncSelectedEditorState();
    uiManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      highlightColors[defaultHighlightColor],
    );
    status = `Creating highlight from ${selectionText.length} selected characters...`;

    const restoreSelection = () => {
      const currentSelection = document.getSelection();
      currentSelection?.removeAllRanges();
      for (const range of ranges) {
        currentSelection?.addRange(range);
      }
    };

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    restoreSelection();
    const currentSelection = document.getSelection();
    const textLayer = currentSelection ? getSelectionAnchorElement(currentSelection)?.closest(".textLayer") : null;
    if (!currentSelection || currentSelection.rangeCount === 0 || !textLayer) {
      status = "PDF.js could not build highlight geometry from the current selection.";
      return false;
    }
    uiManager.highlightSelection(methodOfCreation);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (countHighlightEditorsInManager() > before) {
        return finishCreatedHighlight();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    status = "PDF.js did not create a visible highlight. Try Highlight mode, then drag across text.";
    return false;
  }

  function highlightEditorIds() {
    if (!annotationEditorUIManager || !pdfDocument) return [];
    const ids: string[] = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted) {
          ids.push(editor.id);
        }
      }
    }
    return ids;
  }

  function cacheNewHighlightDetails(previousIds: Set<string>, detail: string) {
    if (!annotationEditorUIManager || !pdfDocument) return;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (
          isHighlightEditor(editor) &&
          !editor.deleted &&
          !previousIds.has(editor.id) &&
          !persistedSourceIdForEditor(editor)
        ) {
          annotationDetailCache.set(`live:${editor.id}`, detail.trim());
        }
      }
    }
  }

  function hasNewUnsavedHighlightEditor(previousIds: Set<string>) {
    if (!annotationEditorUIManager || !pdfDocument) return false;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (
          isHighlightEditor(editor) &&
          !editor.deleted &&
          !previousIds.has(editor.id) &&
          !persistedSourceIdForEditor(editor)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function hasTextSelectionForHighlight() {
    const selectionText = document.getSelection()?.toString().trim() ?? "";
    return Boolean(selectionText || rememberedSelectionText);
  }

  function clearRememberedSelection() {
    rememberedSelectionText = "";
    rememberedSelectionRanges = [];
  }

  function toggleAnnotationTool(tool: Exclude<EditorTool, "none">, event?: PointerEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (activeTool === tool) {
      setTool("none");
      clearRememberedSelection();
      unselectAllIgnoringPdfjsSignalBug();
      syncSelectedEditorState();
      return;
    }
    if (tool === "highlight" && hasTextSelectionForHighlight()) {
      void createSelectionHighlightInToolMode();
      return;
    }
    clearAnnotationFocusSelection(true);
    setTool(tool);
  }

  function isAnnotationCreationMode() {
    return activeTool !== "none" && !selectedAnnotationKind;
  }

  function syncInkEditorHitAreas() {
    document.querySelectorAll(".ink-hit-area").forEach((element) => element.remove());
    if (!annotationEditorUIManager || !pdfDocument) return;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (isInkEditor(editor) && !editor.deleted) {
          addInkEditorHitArea(editor);
        }
      }
    }
  }

  function addInkEditorHitArea(editor: AnnotationEditor) {
    const editorElement = document.getElementById(editor.id);
    if (!(editorElement instanceof HTMLElement)) return;
    const serialized = editor.serialize?.(false);
    const rect = numbersFromUnknown(serialized?.rect);
    const paths = serialized?.paths && typeof serialized.paths === "object" ? serialized.paths : null;
    const rawPoints = paths && "points" in paths ? paths.points : null;
    const pointLists = Array.isArray(rawPoints)
      ? rawPoints.map((pointList) => numbersFromNumericRecord(pointList)).filter((points) => points.length >= 4)
      : [];
    if (rect.length < 4 || pointLists.length === 0) return;
    const left = Math.min(rect[0], rect[2]);
    const right = Math.max(rect[0], rect[2]);
    const bottom = Math.min(rect[1], rect[3]);
    const top = Math.max(rect[1], rect[3]);
    const width = right - left;
    const height = top - bottom;
    const editorRect = editorElement.getBoundingClientRect();
    if (width <= 0 || height <= 0 || editorRect.width <= 0 || editorRect.height <= 0) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ink-hit-area");
    svg.setAttribute("viewBox", `0 0 ${editorRect.width} ${editorRect.height}`);
    svg.setAttribute("aria-hidden", "true");
    const thickness = Number(serialized?.thickness ?? 0);
    const strokeWidth = Math.max(12, thickness * Math.max(editorRect.width / width, editorRect.height / height) + 10);
    for (const points of pointLists) {
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      const mappedPoints: string[] = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const x = ((points[index] - left) / width) * editorRect.width;
        const y = ((top - points[index + 1]) / height) * editorRect.height;
        mappedPoints.push(`${x},${y}`);
      }
      polyline.setAttribute("points", mappedPoints.join(" "));
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", "transparent");
      polyline.setAttribute("stroke-width", String(strokeWidth));
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      polyline.setAttribute("pointer-events", "stroke");
      svg.append(polyline);
    }
    editorElement.prepend(svg);
  }


  async function createSelectionHighlightInToolMode() {
    return createHighlightFromSelection({
      createdStatus: `Created ${defaultHighlightColor} highlight. Save to persist it into the PDF.`,
      methodOfCreation: "main_toolbar",
      resetModeToNone: false,
    });
  }

  function syncSelectedEditorState(persistedKeyHint: unknown = null) {
    const normalizedPersistedKeyHint = typeof persistedKeyHint === "string" ? persistedKeyHint : null;
    syncInkEditorHitAreas();
    const firstSelectedEditor = annotationEditorUIManager?.firstSelectedEditor;
    const editor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (activeTool === "none") {
      const editorKey = persistedAnnotationKeyForEditor(editor);
      const liveKey = editor ? `live:${editor.id}` : null;
      const staleSelection =
        !editor ||
        (selectedPersistedAnnotationKey
          ? editorKey !== selectedPersistedAnnotationKey
          : selectedAnnotationEntryId !== liveKey && !selectedAnnotationKind);
      if (staleSelection) {
        if (remapSelectedInkHighlightEntry()) {
          return;
        }
        selectedAnnotationKind = null;
        selectedAnnotationColor = null;
        hasSelectedHighlight = false;
        selectedHighlightColor = null;
        selectedAnnotationEntryId = null;
        selectedPersistedAnnotationKey = null;
        return;
      }
    }
    if (!editor) {
      selectedAnnotationKind = null;
      selectedAnnotationColor = null;
      hasSelectedHighlight = false;
      selectedHighlightColor = null;
      selectedAnnotationEntryId = null;
      selectedPersistedAnnotationKey = null;
      return;
    }
    selectedAnnotationKind = annotationKindForEditor(editor);
    if (selectedAnnotationKind) {
      annotationFocusBox = null;
    }
    selectedAnnotationColor = editor.color ?? null;
    hasSelectedHighlight = isHighlightEditor(editor);
    selectedHighlightColor = hasSelectedHighlight ? highlightColorNameForValue(editor?.color ?? null) : null;
    selectedAnnotationEntryId = `live:${editor.id}`;
    selectedPersistedAnnotationKey = persistedAnnotationKeyForEditor(editor) ?? normalizedPersistedKeyHint;
    if (selectedPersistedAnnotationKey) {
      persistedAnnotationKeyByEditorId.set(editor.id, selectedPersistedAnnotationKey);
    }
    remapSelectedInkHighlightEntry();
  }


  function findFirstHighlightEditor() {
    if (!annotationEditorUIManager || !pdfDocument) return null;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted) {
          return editor;
        }
      }
    }
    return null;
  }

  async function selectFirstHighlight() {
    if (!annotationEditorUIManager || !pdfDocument) {
      status = "No PDF loaded.";
      return false;
    }
    if (activeTool !== "highlight") {
      setTool("highlight");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let editor = findFirstHighlightEditor();
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findFirstHighlightEditor();
    }
    if (!editor || !annotationEditorUIManager) {
      status = "No highlight found to select.";
      return false;
    }
    annotationEditorUIManager.setSelected(editor);
    selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  function applyHighlightColor(colorName: HighlightColorName) {
    if (!annotationEditorUIManager) {
      status = "Highlight color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultHighlightColor = colorName;
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      highlightColors[colorName],
    );
    if (hasSelectedHighlight) {
      if (isInkEditor(annotationEditorUIManager.firstSelectedEditor)) {
        annotationEditorUIManager.updateParams(
          pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
          { color: highlightColors[colorName], opacity: defaultInkOpacity },
        );
      }
      selectedHighlightColor = colorName;
      selectedAnnotationColor = highlightColors[colorName];
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = `Changed selected highlight to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeTool !== "highlight") {
      syncSelectedEditorState();
      status = `Default highlight color set to ${colorName}.`;
      return;
    }
    status = `Next highlight will use ${colorName}.`;
  }


  function applyFreeTextColor(colorName: FreeTextColorName) {
    if (!annotationEditorUIManager) {
      status = "Free text color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultFreeTextColor = colorName;
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
      freeTextColors[colorName],
    );
    if (selectedAnnotationKind === "freetext") {
      selectedAnnotationColor = freeTextColors[colorName];
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = `Changed selected free text to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeTool !== "text") {
      syncSelectedEditorState();
      status = `Default free-text color set to ${colorName}.`;
      return;
    }
    status = `Next free text will use ${colorName}.`;
  }

  function applyInkColor(colorName: InkColorName) {
    if (!annotationEditorUIManager) {
      status = "Ink color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkColor = colorName;
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
      { color: inkColors[colorName], opacity: defaultInkOpacity },
    );
    if (selectedAnnotationKind === "ink") {
      selectedAnnotationColor = inkColors[colorName];
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = `Changed selected ink to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = `Default ink color set to ${colorName}.`;
      return;
    }
    status = `Next ink will use ${colorName}.`;
  }

  function isHighlightSwatchActive(colorName: string) {
    return (hasSelectedHighlight ? selectedHighlightColor : defaultHighlightColor) === colorName;
  }

  function isFreeTextSwatchActive(colorName: string) {
    return activeTool === "text" && (freeTextColorNameForValue(selectedAnnotationColor) ?? defaultFreeTextColor) === colorName;
  }

  function isInkSwatchActive(colorName: string) {
    return activeTool === "ink" && (inkColorNameForValue(selectedAnnotationColor) ?? defaultInkColor) === colorName;
  }

  function applyHighlightSwatchColor(colorName: string) {
    applyHighlightColor(colorName as HighlightColorName);
  }

  function applyFreeTextSwatchColor(colorName: string) {
    applyFreeTextColor(colorName as FreeTextColorName);
  }

  function applyInkSwatchColor(colorName: string) {
    applyInkColor(colorName as InkColorName);
  }

  function applyInkThickness(thickness: number) {
    if (!annotationEditorUIManager) {
      status = "Ink thickness unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkThickness = thickness;
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
      thickness,
    );
    if (selectedAnnotationKind === "ink") {
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = `Changed selected ink thickness to ${thickness}. Save to persist it into the PDF.`;
      return;
    }
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = `Default ink thickness set to ${thickness}.`;
      return;
    }
    status = `Next ink thickness will be ${thickness}.`;
  }

  function applyInkMarkerPreset() {
    if (!annotationEditorUIManager) {
      status = "Ink marker unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkColor = "yellow";
    defaultInkThickness = 14;
    defaultInkOpacity = 0.45;
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
      { color: inkColors.yellow, opacity: defaultInkOpacity },
    );
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
      defaultInkThickness,
    );
    if (selectedAnnotationKind === "ink") {
      selectedAnnotationColor = inkColors.yellow;
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = "Changed selected ink to marker. Save to persist it into the PDF.";
      return;
    }
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = "Marker preset selected.";
      return;
    }
    status = "Marker preset selected.";
  }

  function deleteSelectedAnnotation() {
    const manager = annotationEditorUIManager;
    const firstSelectedEditor = manager?.firstSelectedEditor;
    const selectedEditor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (!manager || !selectedEditor) {
      status = "Select an annotation first, then delete it.";
      return false;
    }
    if (selectedPersistedAnnotationKey && persistedAnnotationKeyForEditor(selectedEditor) !== selectedPersistedAnnotationKey) {
      const persistedSelection = persistedAnnotationKeyParts(selectedPersistedAnnotationKey);
      const expectedEditor =
        persistedSelection && selectedAnnotationKind
          ? findEditorByPersistedSourceId(persistedSelection.sourceId, selectedAnnotationKind, manager)
          : null;
      if (expectedEditor && editorBelongsToManager(expectedEditor, manager) && expectedEditor.remove) {
        const wasHighlight = selectedAnnotationKind === "highlight";
        const wasFreeText = selectedAnnotationKind === "freetext";
        pendingDeletedPersistedAnnotationKeys.add(selectedPersistedAnnotationKey);
        expectedEditor.remove();
        selectedAnnotationKind = null;
        selectedAnnotationColor = null;
        hasSelectedHighlight = false;
        selectedHighlightColor = null;
        selectedAnnotationEntryId = null;
        selectedPersistedAnnotationKey = null;
        isDirty = true;
        void refreshAnnotationSidebar();
        queueEditorStateRefresh(100, 250, 500);
        status = wasHighlight
          ? "Deleted selected highlight. Save to persist it into the PDF."
          : wasFreeText
            ? "Deleted selected free text. Save to persist it into the PDF."
            : "Deleted selected annotation. Save to persist it into the PDF.";
        return true;
      }
      if (
        !selectedAnnotationKind ||
        !persistedSelection ||
        !isPersistedAnnotationHidden(persistedSelection.pageNumber, persistedSelection.sourceId)
      ) {
        status = "Selected annotation changed before delete. Select it again, then delete.";
        return false;
      }
      pendingDeletedPersistedAnnotationKeys.add(selectedPersistedAnnotationKey);
      selectedAnnotationKind = null;
      selectedAnnotationColor = null;
      hasSelectedHighlight = false;
      selectedHighlightColor = null;
      selectedAnnotationEntryId = null;
      selectedPersistedAnnotationKey = null;
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(100, 250, 500);
      status = "Deleted selected annotation. Save to persist it into the PDF.";
      return true;
    }
    const wasHighlight = isHighlightEditor(selectedEditor);
    const wasFreeText = isFreeTextEditor(selectedEditor);
    const pendingDeleteKey = persistedAnnotationKeyForEditor(selectedEditor) ?? selectedPersistedAnnotationKey;
    if (pendingDeleteKey) {
      pendingDeletedPersistedAnnotationKeys.add(pendingDeleteKey);
    }
    manager.delete();
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    selectedAnnotationEntryId = null;
    selectedPersistedAnnotationKey = null;
    isDirty = true;
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(100, 250, 500);
    status = wasHighlight
      ? "Deleted selected highlight. Save to persist it into the PDF."
      : wasFreeText
        ? "Deleted selected free text. Save to persist it into the PDF."
        : "Deleted selected annotation. Save to persist it into the PDF.";
    return true;
  }

  function selectFirstText() {
    const spans = [...document.querySelectorAll<HTMLElement>(".textLayer span")];
    const child = spans
      .flatMap((node) => [...node.childNodes])
      .find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 8);
    if (!child?.textContent) {
      throw new Error("No text layer span found");
    }

    const range = document.createRange();
    const length = Math.min(child.textContent.length, 20);
    range.setStart(child, 0);
    range.setEnd(child, length);

    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  }

  function getDebugStats() {
    const storage = (pdfDocument as unknown as {
      annotationStorage?: {
        size?: number;
        serializable?: { map?: Map<unknown, unknown> };
      };
    } | null)?.annotationStorage;
    const selectedEditor = annotationEditorUIManager?.firstSelectedEditor;

    return {
      pages: pdfDocument?.numPages ?? 0,
      currentPageNumber: pdfViewer?.currentPageNumber ?? null,
      status,
      outlineStatus,
      activeTool,
      defaultHighlightColor,
      defaultFreeTextColor,
      defaultInkColor,
      defaultInkThickness,
      defaultInkOpacity,
      selectedAnnotationKind,
      selectedPersistedAnnotationKey,
      pendingDeletedPersistedAnnotationKeys: [...pendingDeletedPersistedAnnotationKeys],
      selectedAnnotationColor,
      hasSelectedHighlight,
      selectedHighlightColor,
      selectedEditorType: selectedEditor?.editorType ?? null,
      selectedEditorColor: selectedEditor?.color ?? null,
      annotationFocusBox,
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

  function getEditorSummary() {
    if (!annotationEditorUIManager || !pdfDocument) {
      return [];
    }
    const selectedEditorId = document.querySelector<HTMLElement>(".selectedEditor")?.id ?? null;
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

  function moveSelectedAnnotation(x: number, y: number) {
    if (!annotationEditorUIManager?.firstSelectedEditor) {
      return false;
    }
    const movableManager = annotationEditorUIManager as AnnotationEditorUIManager & {
      translateSelectedEditors?: (x: number, y: number, noCommit?: boolean) => void;
    };
    movableManager.translateSelectedEditors?.(x, y, true);
    syncSelectedEditorState();
    isDirty = true;
    void refreshAnnotationSidebar();
    return true;
  }

  function zoomIn() {
    if (!pdfViewer) return;
    pdfViewer.currentScale = Math.min(pdfViewer.currentScale * 1.1, 5);
    scaleLabel = `${Math.round(pdfViewer.currentScale * 100)}%`;
  }

  function zoomOut() {
    if (!pdfViewer) return;
    pdfViewer.currentScale = Math.max(pdfViewer.currentScale / 1.1, 0.2);
    scaleLabel = `${Math.round(pdfViewer.currentScale * 100)}%`;
  }

  function fitWidth() {
    if (!pdfViewer) return;
    pdfViewer.currentScaleValue = "page-width";
    scaleLabel = "Fit Width";
  }

  async function savePdf() {
    if (!currentPath) {
      await savePdfAs();
      return;
    }
    await persistPdf(currentPath);
  }

  async function savePdfAs() {
    const target = await save({
      defaultPath: defaultSavePath(),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!target) return;
    await persistPdf(target);
  }

  async function persistPdf(path: string) {
    if (!pdfDocument) return;

    isBusy = true;
    status = "Saving annotations into PDF...";
    try {
      const saved = await savePdfDocumentBytes();
      await invoke("write_pdf_atomic", {
        path,
        bytes: Array.from(saved),
      });
      currentPath = path;
      isDirty = false;
      await refreshAnnotationSidebar();
      status = `Saved ${path}`;
    } catch (error) {
      status = `Save failed: ${formatError(error)}`;
    } finally {
      isBusy = false;
    }
  }

  function isTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  async function debugSaveToPath(path: string) {
    if (isTauriRuntime()) {
      await persistPdf(path);
      return;
    }
    if (!pdfDocument) {
      throw new Error("No PDF loaded");
    }
    const saved = await savePdfDocumentBytes();
    debugFileStore.set(path, saved);
    currentPath = path;
    isDirty = false;
    await refreshAnnotationSidebar();
    status = `Saved debug snapshot ${path}`;
  }

  function debugSavedBytes(path: string) {
    const bytes = debugFileStore.get(path);
    if (!bytes) throw new Error(`No debug snapshot stored for ${path}`);
    return Array.from(bytes);
  }

  async function savePdfDocumentBytes() {
    if (!pdfDocument) throw new Error("No PDF loaded");
    const saved = new Uint8Array(await pdfDocument.saveDocument());
    return writePdfOutlineState(saved, {
      bookmarkRootTitle,
      bookmarks: bookmarkEntries,
      documentOutlineEntries: outlineEntries,
    });
  }

  async function debugLoadPath(path: string) {
    if (isTauriRuntime()) {
      await loadPdf(path);
      return;
    }
    const bytes = debugFileStore.get(path);
    if (!bytes) {
      throw new Error(`No debug snapshot stored for ${path}`);
    }
    await loadPdfBytes(bytes.slice(), path);
      currentPath = path;
      isDirty = false;
      activeTool = "none";
      await refreshAnnotationSidebar();
      status = `Loaded debug snapshot ${path}`;
  }

  async function debugLoadUrl(url: string, label = url) {
    isBusy = true;
    status = `Loading ${label}...`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadPdfBytes(new Uint8Array(await response.arrayBuffer()), label);
      currentPath = label;
      isDirty = false;
      activeTool = "none";
      await refreshAnnotationSidebar();
      status = `Loaded ${label}`;
    } finally {
      isBusy = false;
    }
  }

  async function getAnnotationSummary() {
    if (!pdfDocument) {
      return [];
    }
    const documentWithPageAccess = pdfDocument as PdfDocument & {
      getPage: (
        pageNumber: number,
      ) => Promise<{
        getAnnotations: () => Promise<Record<string, unknown>[]>;
      }>;
    };
    const pages: Record<string, unknown>[] = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      const page = await documentWithPageAccess.getPage(pageIndex + 1);
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

  async function createPageFreeText(text = "Regression free text", pageNumber = 1) {
    if (!annotationEditorUIManager || !pdfDocument) {
      throw new Error("No PDF loaded");
    }
    setTool("text");
    await new Promise((resolve) => setTimeout(resolve, 100));
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
      freeTextColors[defaultFreeTextColor],
    );
    const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      containerEl.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const layerElement = document.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .annotationEditorLayer`,
    );
    if (!layerElement) {
      throw new Error(`No annotation editor layer for page ${pageNumber}`);
    }
    const rect = layerElement.getBoundingClientRect();
    const layer = annotationEditorUIManager.findParent(rect.x + 20, rect.y + 20);
    if (!layer) {
      throw new Error(`No editor layer instance for page ${pageNumber}`);
    }
    const createdEditor = layer.createAndAddNewEditor({ offsetX: 160, offsetY: 220 }, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editor = document.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .freeTextEditor [contenteditable="true"], .page[data-page-number="${pageNumber}"] .freeTextEditor .internal`,
    );
    if (!editor) {
      throw new Error(`No free-text editor DOM for page ${pageNumber}`);
    }
    editor.focus();
    editor.textContent = text;
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: text,
        inputType: "insertText",
      }),
    );
    createdEditor?.commit?.();
    syncSelectedEditorState();
    isDirty = true;
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(150, 500);
    return true;
  }

  async function editSelectedFreeText(text: string) {
    const editor = annotationEditorUIManager?.firstSelectedEditor;
    if (!isFreeTextEditor(editor)) {
      status = "Select free text first, then edit it.";
      return false;
    }
    if (activeTool !== "text") {
      await preparePdfjsEditorModeForEdit("text");
      annotationEditorUIManager?.setSelected(editor);
    }
    editor.enterInEditMode?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editorElement = document.getElementById(editor.id);
    const textElement = editorElement?.querySelector<HTMLElement>(".internal, [contenteditable='true']");
    if (!textElement) {
      status = "Could not find selected free-text editor content.";
      return false;
    }
    textElement.focus();
    textElement.replaceChildren(document.createTextNode(text));
    textElement.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: text,
        inputType: "insertText",
      }),
    );
    editor.commit?.();
    annotationDetailCache.delete(`live:${editor.id}`);
    const persistedEntry = persistedAnnotationEntryForKey(
      selectedPersistedAnnotationKey ?? persistedAnnotationKeyForEditor(editor),
    );
    if (persistedEntry) {
      annotationDetailCache.delete(persistedEntry.id);
    }
    isDirty = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
    syncSelectedEditorState();
    await refreshAnnotationSidebar();
    queueEditorStateRefresh(500);
    status = "Edited selected free text. Save to persist it into the PDF.";
    return true;
  }

  function teardownViewer() {
    unselectAllIgnoringPdfjsSignalBug();
    pdfViewer?.setDocument(null as never);
    (pdfDocument as { destroy?: () => void } | null)?.destroy?.();
    pdfViewer = null;
    pdfLinkService = null;
    pdfDocument = null;
    annotationEditorUIManager = null;
    outlineEntries = [];
    outlineStatus = "Open a PDF to inspect its outline.";
    collapsedOutlineIds = [];
    activeOutlineEntryId = null;
    bookmarkEntries = [];
    bookmarkStatus = "Open a PDF to inspect bookmarks.";
    editingBookmarkId = null;
    activeBookmarkId = null;
    annotationEntries = [];
    annotationStatus = "Open a PDF to inspect annotations.";
    selectedAnnotationEntryId = null;
    selectedPersistedAnnotationKey = null;
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    activeTool = "none";
    lastActivatedOutlineEntry = null;
    annotationFocusBox = null;
    annotationDetailCache.clear();
    pendingDeletedPersistedAnnotationKeys.clear();
    persistedAnnotationKeyByEditorId.clear();
    if (annotationRefreshTimer) {
      clearTimeout(annotationRefreshTimer);
      annotationRefreshTimer = null;
    }
    viewerEl.replaceChildren();
  }

  function defaultSavePath() {
    if (!currentPath) return "annotated.pdf";
    return currentPath.replace(/\.pdf$/i, "-annotated.pdf");
  }

  function toolLabel(tool: EditorTool) {
    if (tool === "text") return "Free text";
    if (tool === "highlight") return "Highlight";
    return tool[0].toUpperCase() + tool.slice(1);
  }

</script>

<main class="app">
  <aside class="panel">
    <div>
      <p class="eyebrow">PDF annotation persistence spike</p>
      <h1>PDF.js Save Test</h1>
      <p class="summary">
        Proves whether app-created annotations persist inside the PDF and reopen in
        other readers.
      </p>
    </div>

    <div class="group">
      <button onclick={openPdf} disabled={isBusy}>Open PDF</button>
      <button onclick={loadSamplePdf} disabled={isBusy}>Load Sample</button>
      <button onclick={savePdf} disabled={!pdfDocument || isBusy}>Save</button>
      <button onclick={savePdfAs} disabled={!pdfDocument || isBusy}>Save As</button>
    </div>

    <div class="group">
      <span class="label">Annotate</span>
      <div class="segmented">
        {#each (["highlight", "text", "ink"] as Exclude<EditorTool, "none">[]) as tool}
          <button
            class:active={activeTool === tool}
            onpointerdown={(event) => toggleAnnotationTool(tool, event)}
            disabled={!pdfDocument}
          >
            {toolLabel(tool)}
          </button>
        {/each}
      </div>
    </div>

    {#snippet swatchRow(
      label: string,
      swatches: SwatchOption[],
      isSwatchActive: (colorName: string) => boolean,
      applySwatchColor: (colorName: string) => void,
      ariaTarget: string,
    )}
      <span class="label">{label}</span>
      <div class="swatches">
        {#each swatches as option (option.name)}
          <button
            class:swatch-active={isSwatchActive(option.name)}
            class="swatch"
            onclick={() => applySwatchColor(option.name)}
            disabled={!pdfDocument}
            aria-label={`Set ${ariaTarget} color to ${option.name}`}
            title={`Set ${ariaTarget} color to ${option.name}`}
            style={`--swatch-color: ${option.color}`}
          ></button>
        {/each}
      </div>
    {/snippet}

    <div class="group">
      {@render swatchRow("Highlight color", highlightSwatches, isHighlightSwatchActive, applyHighlightSwatchColor, "highlight")}
      {@render swatchRow("Free-text color", freeTextSwatches, isFreeTextSwatchActive, applyFreeTextSwatchColor, "free-text")}
      {@render swatchRow("Ink color", inkSwatches, isInkSwatchActive, applyInkSwatchColor, "ink")}
      <span class="label">Ink thickness</span>
      <div class="toolbar">
        {#each inkThicknesses as thickness}
          <button
            class:active={activeTool === "ink" && defaultInkThickness === thickness}
            onclick={() => applyInkThickness(thickness)}
            disabled={!pdfDocument}
            aria-label={`Set ink thickness to ${thickness}`}
            title={`Set ink thickness to ${thickness}`}
          >
            {thickness}
          </button>
        {/each}
        <button
          class:active={activeTool === "ink" && defaultInkColor === "yellow" && defaultInkThickness === 14 && defaultInkOpacity === 0.45}
          onclick={applyInkMarkerPreset}
          disabled={!pdfDocument}
          aria-label="Use marker ink preset"
          title="Use marker ink preset"
        >
          Marker
        </button>
      </div>
      <button onclick={deleteSelectedAnnotation} disabled={!selectedAnnotationKind}>
        Delete Selected
      </button>
    </div>

    <div class="group">
      <span class="label">Zoom</span>
      <div class="toolbar">
        <button onclick={zoomOut} disabled={!pdfDocument}>-</button>
        <button onclick={fitWidth} disabled={!pdfDocument}>{scaleLabel}</button>
        <button onclick={zoomIn} disabled={!pdfDocument}>+</button>
      </div>
    </div>

    <div class="status" class:dirty={isDirty}>
      <span>{isDirty ? "Unsaved changes" : "No unsaved changes"}</span>
      <p>{status}</p>
    </div>

    <ol class="checklist">
      <li>Open a normal text PDF.</li>
      <li>Create highlight and free-text annotation.</li>
      <li>Save as annotated PDF.</li>
      <li>Open saved file in Preview/PDF Expert/Acrobat.</li>
    </ol>
  </aside>

  <aside class="nav-panel" aria-label="PDF navigation sidebar">
    <div class="nav-tabs" role="tablist" aria-label="PDF navigation tabs">
      <button
        class:active={navigationTab === "outline"}
        role="tab"
        aria-selected={navigationTab === "outline"}
        onclick={() => (navigationTab = "outline")}
      >
        Outline
      </button>
      <button
        class:active={navigationTab === "bookmarks"}
        role="tab"
        aria-selected={navigationTab === "bookmarks"}
        onclick={() => (navigationTab = "bookmarks")}
      >
        Bookmarks
      </button>
      <button
        class:active={navigationTab === "annotations"}
        role="tab"
        aria-selected={navigationTab === "annotations"}
        onclick={() => {
          navigationTab = "annotations";
          queueAnnotationSidebarRefresh(0);
          queueAnnotationSidebarRefresh(300);
          queueAnnotationSidebarRefresh(1000);
        }}
      >
        Annotations
      </button>
    </div>
    {#if navigationTab === "outline"}
      <div class="nav-content" role="tabpanel" aria-label="Outline">
        <div class="nav-heading">
          <span class="label">Outline</span>
          <span class="nav-heading-actions">
            <button
              type="button"
              class="nav-heading-icon"
              aria-label="Expand all outline items"
              title="Expand all outline items"
              disabled={outlineEntries.length === 0}
              onclick={expandAllOutlineItems}
            >
              <svg class="nav-heading-svg" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 5.5 10 9.5 14 5.5"></path>
                <path d="M6 10.5 10 14.5 14 10.5"></path>
              </svg>
            </button>
            <button
              type="button"
              class="nav-heading-icon"
              aria-label="Collapse all outline items"
              title="Collapse all outline items"
              disabled={outlineEntries.length === 0}
              onclick={collapseAllOutlineItems}
            >
              <svg class="nav-heading-svg" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 9.5 10 5.5 14 9.5"></path>
                <path d="M6 14.5 10 10.5 14 14.5"></path>
              </svg>
            </button>
            <span class="nav-heading-count">{outlineStatus}</span>
          </span>
        </div>
        {#if outlineEntries.length > 0}
          <ul class="outline-list">
            {@render outlineItems(outlineEntries)}
          </ul>
        {:else}
          <p class="empty-state">{outlineStatus}</p>
        {/if}
      </div>
    {:else if navigationTab === "bookmarks"}
      <div class="nav-content" role="tabpanel" aria-label="Bookmarks">
        <div class="nav-heading">
          <span class="label">Bookmarks</span>
          <span class="nav-heading-actions">
            <button
              type="button"
              class="nav-heading-icon"
              aria-label="Add bookmark"
              title="Add bookmark"
              disabled={!pdfDocument}
              onclick={() => void createBookmarkForCurrentPage(true)}
            >
              +
            </button>
            <span class="nav-heading-count">{bookmarkStatus}</span>
          </span>
        </div>
        {#if bookmarkEntries.length > 0}
          <ul class="bookmark-list">
            {#each bookmarkEntries as entry (entry.id)}
              <li>
                <div class="bookmark-row">
                  {#if editingBookmarkId === entry.id}
                    <div
                      class="bookmark-item bookmark-item-editing"
                      class:bookmark-hovered={hoveredBookmarkId === entry.id}
                      class:bookmark-active={activeBookmarkId === entry.id}
                      role="group"
                      aria-label={`Editing bookmark ${entry.title}`}
                      onmouseenter={() => (hoveredBookmarkId = entry.id)}
                      onmouseleave={() => (hoveredBookmarkId = null)}
                    >
                      <button
                        type="button"
                        class="bookmark-color-button"
                        style={bookmarkColorStyle(entry)}
                        aria-label={`Bookmark color ${entry.title}`}
                        title={`Bookmark color ${entry.title}`}
                        onpointerdown={(event) => event.preventDefault()}
                        onclick={() => (bookmarkColorMenuId = bookmarkColorMenuId === entry.id ? null : entry.id)}
                      >
                        <span class="bookmark-icon" aria-hidden="true"></span>
                      </button>
                      <input
                        aria-label="Bookmark title"
                        value={entry.title}
                        oninput={(event) => updateBookmarkTitle(entry.id, event.currentTarget.value)}
                        onkeydown={handleBookmarkTitleKey}
                        onblur={() => (editingBookmarkId = null)}
                      />
                    </div>
                  {:else}
                    <div
                      class="bookmark-item"
                      class:bookmark-hovered={hoveredBookmarkId === entry.id}
                      class:bookmark-active={activeBookmarkId === entry.id}
                      role="group"
                      aria-label={`Bookmark ${entry.title}`}
                      onmouseenter={() => (hoveredBookmarkId = entry.id)}
                      onmouseleave={() => (hoveredBookmarkId = null)}
                      title={`${entry.title} on page ${entry.pageNumber}`}
                    >
                      <button
                        type="button"
                        class="bookmark-color-button"
                        style={bookmarkColorStyle(entry)}
                        aria-label={`Bookmark color ${entry.title}`}
                        title={`Bookmark color ${entry.title}`}
                        onclick={() => (bookmarkColorMenuId = bookmarkColorMenuId === entry.id ? null : entry.id)}
                      >
                        <span class="bookmark-icon" aria-hidden="true"></span>
                      </button>
                      <button
                        type="button"
                        class="bookmark-title-button"
                        onclick={() => void goToBookmarkEntry(entry)}
                        ondblclick={() => void editBookmarkAndGoToEntry(entry)}
                        aria-label={entry.title}
                        title={`${entry.title} on page ${entry.pageNumber}`}
                      >
                        {entry.title}
                      </button>
                    </div>
                  {/if}
                  {#if bookmarkColorMenuId === entry.id}
                    <div class="outline-color-menu bookmark-color-menu" role="menu" aria-label="Bookmark colors">
                      {#each bookmarkPalette as option (option.name)}
                        <button
                          type="button"
                          class="outline-color-option"
                          style={`--outline-color: ${option.color}`}
                          aria-label={`Set bookmark color ${option.label}`}
                          title={`Set bookmark color ${option.label}`}
                          onpointerdown={(event) => event.preventDefault()}
                          onclick={() => updateBookmarkColor(entry.id, option.color)}
                        >
                          <span aria-hidden="true"></span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                  <button
                    class="bookmark-delete"
                    onclick={() => deleteBookmark(entry.id)}
                    aria-label={`Delete bookmark ${entry.title}`}
                    title={`Delete bookmark ${entry.title}`}
                  >
                    ⊖
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-state">{bookmarkStatus}</p>
        {/if}
      </div>
    {:else}
      <AnnotationsSidebar
        {annotationEntries}
        {annotationStatus}
        {selectedAnnotationEntryId}
        {locateAnnotationEntry}
      />
    {/if}
  </aside>

  <section class="viewer-shell">
    <div class="viewer-toolbar">
      <span>{currentPath || "No PDF loaded"}</span>
    </div>
    <div
      class="pdf-container"
      class:annotation-tool-active={isAnnotationCreationMode()}
      bind:this={containerEl}
      role="region"
      aria-label="PDF pages"
    >
      {#if annotationFocusBox}
        <div
          class="annotation-focus-box"
          style={`left: ${annotationFocusBox.left}px; top: ${annotationFocusBox.top}px; width: ${annotationFocusBox.width}px; height: ${annotationFocusBox.height}px`}
          aria-hidden="true"
        ></div>
      {/if}
      {#each bookmarkEntries as entry (entry.id)}
        <button
          type="button"
          class="bookmark-page-marker"
          class:bookmark-hovered={hoveredBookmarkId === entry.id}
          data-page-number={entry.pageNumber}
          style={bookmarkMarkerStyle(entry)}
          onclick={(event) => {
            event.stopPropagation();
            deleteBookmark(entry.id);
          }}
          onmouseenter={() => (hoveredBookmarkId = entry.id)}
          onmouseleave={() => (hoveredBookmarkId = null)}
          title={`Remove bookmark: ${entry.title}`}
          aria-label={`Remove bookmark ${entry.title}`}
        ></button>
      {/each}
      {#if bookmarkRailHoverCue}
        <div
          class="bookmark-rail-focus-cue"
          data-page-number={bookmarkRailHoverCue.pageNumber}
          style={`left: ${bookmarkRailHoverCue.focusLeft}px; top: ${bookmarkRailHoverCue.focusTop}px`}
          aria-hidden="true"
        >
          +
        </div>
        <div
          class="bookmark-rail-add-cue"
          data-page-number={bookmarkRailHoverCue.pageNumber}
          style={`left: ${bookmarkRailHoverCue.hintLeft}px; top: ${bookmarkRailHoverCue.hintTop}px`}
          aria-hidden="true"
        >
          +
        </div>
      {/if}
      <div class="pdfViewer" bind:this={viewerEl}></div>
    </div>
  </section>
</main>

{#snippet outlineItems(entries: OutlineEntry[], depth = 0)}
  {#each entries as entry (entry.id)}
    {@const hasChildren = entry.items.length > 0}
    {@const collapsed = isOutlineCollapsed(entry.id)}
    <li class="outline-row">
      <div
        class="outline-row-main"
        class:outline-active={isActiveOutlineRow(entry.id)}
        class:outline-collapsed-row={hasChildren && collapsed}
        data-outline-id={entry.id}
        style={`${outlineColorStyle(entry.color)}; padding-left: ${12 + depth * 16}px`}
      >
        {#if hasChildren}
          <button
            type="button"
            class="outline-toggle"
            aria-label={`${collapsed ? "Expand" : "Collapse"} outline item ${entry.title}`}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} outline item ${entry.title}`}
            onclick={() => toggleOutlineCollapsed(entry.id)}
          >
            <span class:collapsed aria-hidden="true"></span>
          </button>
        {:else}
          <span class="outline-toggle-spacer" aria-hidden="true"></span>
        {/if}
        <button
          class="outline-item"
          onclick={(event) => {
            event.currentTarget.blur();
            void goToOutlineEntry(entry);
          }}
          disabled={!isOutlineEntryNavigable(entry)}
          title={entry.destinationStatus ? `${entry.title} - ${entry.destinationStatus}` : entry.title}
        >
          <span class="outline-title">{entry.title}</span>
          {#if entry.pageNumber}
            <span class="page-number">{entry.pageNumber}</span>
          {:else if entry.destinationStatus}
            <span class="page-number">{entry.destinationStatus}</span>
          {/if}
        </button>
        <button
          type="button"
          class="outline-color-button"
          style={`--outline-color: ${entry.color ?? "transparent"}`}
          aria-label={`Outline color ${entry.title}`}
          title={`Outline color ${entry.title}`}
          onclick={() => (outlineColorMenuId = outlineColorMenuId === entry.id ? null : entry.id)}
        >
          <span aria-hidden="true"></span>
        </button>
        {#if outlineColorMenuId === entry.id}
          <div class="outline-color-menu outline-color-menu-outline" role="menu" aria-label="Outline colors">
            {#each outlinePalette as option (option.name)}
              <button
                type="button"
                class="outline-color-option"
                style={`--outline-color: ${option.color ?? "transparent"}`}
                aria-label={`Set outline color ${option.label}`}
                title={`Set outline color ${option.label}`}
                onclick={() => updateOutlineColor(entry.id, option.color)}
              >
                <span aria-hidden="true"></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if hasChildren && !collapsed}
        <ul>
          {@render outlineItems(entry.items, depth + 1)}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    color: #1e2329;
    background: #eef1f4;
  }

  :global(.popupAnnotation),
  :global(.popup) {
    display: none !important;
  }

  :global(.annotationEditorLayer.inkEditing) {
    cursor: var(--pdf-spike-ink-cursor) !important;
  }

  .pdf-container:not(.annotation-tool-active) :global(.annotationEditorLayer.inkEditing) {
    cursor: auto !important;
  }

  :global(.textLayer.highlighting) {
    caret-color: auto !important;
    cursor: auto !important;
    touch-action: auto !important;
  }

  :global(.textLayer.highlighting :is(span, br)) {
    cursor: text !important;
  }

  :global(.textLayer.highlighting span[role="img"]) {
    cursor: default !important;
  }

  .app {
    display: grid;
    grid-template-columns: 320px 280px minmax(0, 1fr);
    height: 100vh;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 24px;
    border-right: 1px solid #d7dce2;
    background: #f8f9fb;
    overflow: auto;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #5b6470;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1.15;
  }

  .summary {
    margin: 10px 0 0;
    color: #5b6470;
    font-size: 14px;
    line-height: 1.5;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .label {
    color: #5b6470;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  button {
    min-height: 34px;
    border: 1px solid #c8d0d9;
    border-radius: 6px;
    padding: 0 12px;
    color: #1e2329;
    background: #ffffff;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #6b8fce;
    background: #f3f7ff;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  button.active {
    border-color: #2f6ecb;
    color: #ffffff;
    background: #2f6ecb;
  }

  .segmented,
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatch {
    min-width: 34px;
    width: 34px;
    padding: 0;
    background: var(--swatch-color);
  }

  .swatch.swatch-active {
    border-color: #1e2329;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.7);
  }

  .status {
    border: 1px solid #d7dce2;
    border-radius: 8px;
    padding: 12px;
    background: #ffffff;
  }

  .status.dirty {
    border-color: #d09d38;
    background: #fff8e8;
  }

  .status span {
    display: block;
    font-size: 12px;
    font-weight: 700;
  }

  .status p {
    margin: 8px 0 0;
    color: #5b6470;
    font-size: 13px;
    line-height: 1.45;
    word-break: break-word;
  }

  .checklist {
    margin: 0;
    padding-left: 18px;
    color: #5b6470;
    font-size: 13px;
    line-height: 1.65;
  }

  .nav-panel {
    display: grid;
    min-height: 0;
    min-width: 0;
    grid-template-rows: 44px minmax(0, 1fr);
    border-right: 1px solid #d7dce2;
    background: #ffffff;
    overflow: hidden;
  }

  .nav-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid #d7dce2;
    padding: 6px 10px;
    background: #f8f9fb;
  }

  .nav-tabs button {
    min-height: 30px;
  }

  .nav-content {
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .nav-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px 8px 12px;
    color: #5b6470;
    font-size: 12px;
  }

  .nav-heading-actions {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
  }

  .nav-heading-count,
  .nav-heading > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-heading-icon {
    display: grid;
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    min-height: 0;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0;
    color: #5b6470;
    background: transparent;
  }

  .nav-heading-icon:hover:not(:disabled),
  .nav-heading-icon:focus-visible {
    border-color: #cfd6df;
    background: #ffffff;
  }

  .nav-heading-icon:disabled {
    color: #b5bdc8;
  }

  .nav-heading-svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .empty-state {
    margin: 0;
    padding: 16px 12px;
    color: #5b6470;
    font-size: 13px;
    line-height: 1.45;
  }

  .outline-list,
  .outline-list ul,
  .bookmark-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .outline-row {
    position: relative;
  }

  .outline-row-main {
    position: relative;
    display: grid;
    box-sizing: border-box;
    width: 100%;
    grid-template-columns: 20px minmax(0, 1fr) 34px 32px;
    align-items: stretch;
    min-width: 0;
    background: var(--outline-bg-color, transparent);
  }

  .outline-item,
  .bookmark-item {
    display: grid;
    width: 100%;
    min-height: 34px;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 0;
    padding: 6px 10px 6px 12px;
    text-align: left;
    background: transparent;
  }

  .bookmark-item {
    grid-template-columns: 16px minmax(0, 1fr);
  }

  .bookmark-item-editing {
    grid-template-columns: 16px minmax(0, 1fr);
  }

  .bookmark-row {
    display: grid;
    position: relative;
    grid-template-columns: minmax(0, 1fr) 48px;
    align-items: stretch;
  }

  .bookmark-delete {
    justify-self: center;
    align-self: center;
    width: 24px;
    height: 24px;
    min-height: 0;
    border: 0;
    border-radius: 50%;
    padding: 0;
    color: #8a929c;
    background: transparent;
  }

  .bookmark-delete:hover:not(:disabled) {
    color: #b3261e;
    background: #fff0ee;
  }

  .outline-item {
    box-sizing: border-box;
    grid-column: 2 / 4;
    grid-template-columns: minmax(0, 1fr) 34px;
    min-width: 0;
    padding: 6px 0 6px 4px;
    background: transparent;
  }

  .outline-toggle,
  .outline-toggle-spacer {
    width: 20px;
    min-height: 34px;
  }

  .outline-toggle {
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: #7a8491;
    background: transparent;
  }

  .outline-toggle:hover,
  .outline-toggle:focus-visible {
    color: #2f3742;
    background: rgba(255, 255, 255, 0.5);
  }

  .outline-toggle span {
    width: 7px;
    height: 7px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg);
  }

  .outline-toggle span.collapsed {
    transform: rotate(-45deg);
  }

  .outline-color-button {
    position: static;
    grid-column: 4;
    align-self: center;
    justify-self: center;
    display: grid;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    min-height: 0;
    aspect-ratio: 1;
    place-items: center;
    appearance: none;
    border: 1px solid rgba(17, 24, 39, 0.26);
    border-radius: 50%;
    padding: 0;
    background: var(--outline-color, #ffffff);
    opacity: 0;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.82);
    line-height: 0;
  }


  .outline-row-main:hover > .outline-color-button,
  .outline-row-main:focus-within > .outline-color-button,
  .outline-color-button:focus-visible {
    opacity: 1;
  }

  .outline-color-button span {
    display: none;
  }

  .outline-color-menu-outline {
    top: 30px;
    right: 6px;
  }

  .outline-title,
  .bookmark-title-button {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .outline-row-main:hover,
  .bookmark-item:hover:not(:disabled),
  .bookmark-item.bookmark-hovered,
  .bookmark-item.bookmark-active {
    background: var(--outline-hover-bg-color, #edf4ff);
  }

  .outline-row-main.outline-active {
    box-shadow: inset 0 0 0 9999px rgba(47, 111, 203, 0.1);
  }

  .bookmark-icon,
  .bookmark-page-marker {
    background: var(--bookmark-color, #f04444);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
  }

  .bookmark-icon {
    width: 10px;
    height: 16px;
  }

  .bookmark-color-button {
    display: grid;
    width: 16px;
    height: 22px;
    min-height: 0;
    place-items: center;
    appearance: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
  }

  .bookmark-title-button {
    min-width: 0;
    min-height: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
    overflow: hidden;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmark-item input {
    min-width: 0;
    width: 100%;
    border: 1px solid #8bbcff;
    border-radius: 3px;
    padding: 3px 5px;
    color: #1e2329;
    font: inherit;
  }

  .outline-color-menu {
    position: absolute;
    top: 24px;
    right: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(4, 18px);
    gap: 6px;
    border: 1px solid #c8d0da;
    padding: 8px;
    background: #ffffff;
    box-shadow: 0 6px 18px rgba(17, 24, 39, 0.18);
  }

  .outline-row-main .outline-color-menu-outline {
    top: 30px;
    right: 8px;
  }

  .bookmark-color-menu {
    top: 28px;
    left: 6px;
    right: auto;
  }

  .outline-color-option {
    display: grid;
    width: 18px;
    height: 18px;
    min-height: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: transparent;
  }

  .outline-color-option span {
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    border: 1px solid #c8d0da;
    border-radius: 50%;
    background: var(--outline-color, transparent);
  }

  .outline-color-option:hover span,
  .outline-color-option:focus-visible span {
    box-shadow: 0 0 0 2px #d8e8ff;
  }

  .page-number {
    justify-self: end;
    color: #7a838f;
    font-size: 12px;
    white-space: nowrap;
  }

  .viewer-shell {
    position: relative;
    display: grid;
    min-width: 0;
    grid-template-rows: 42px minmax(0, 1fr);
  }

  .viewer-toolbar {
    display: flex;
    align-items: center;
    min-width: 0;
    border-bottom: 1px solid #d7dce2;
    padding: 0 16px;
    color: #5b6470;
    background: #ffffff;
    font-size: 13px;
  }

  .viewer-toolbar span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pdf-container {
    position: absolute;
    inset: 42px 0 0;
    overflow: auto;
    background: #dfe3e8;
  }

  .annotation-focus-box {
    position: absolute;
    z-index: 20;
    border: 1px dashed #16a34a;
    pointer-events: none;
  }

  .pdf-container:not(.annotation-tool-active) :global(.annotationLayer :is(.highlightAnnotation, .freeTextAnnotation, .inkAnnotation)),
  .pdf-container:not(.annotation-tool-active) :global(.annotationEditorLayer .highlightEditor.disabled),
  .pdf-container:not(.annotation-tool-active) :global(.annotationEditorLayer :is(.freeTextEditor, .inkEditor):not(.selectedEditor)) {
    pointer-events: none !important;
  }

  .pdf-container.annotation-tool-active :global(.annotationLayer :is(.highlightAnnotation, .freeTextAnnotation, .inkAnnotation)),
  .pdf-container.annotation-tool-active :global(.annotationEditorLayer :is(.highlightEditor, .freeTextEditor, .inkEditor)) {
    pointer-events: none !important;
  }

  .pdf-container.annotation-tool-active :global(.annotationEditorLayer .freeTextEditor .internal),
  .pdf-container.annotation-tool-active :global(.annotationEditorLayer .inkEditor .ink-hit-area polyline),
  .pdf-container.annotation-tool-active :global(.annotationLayer .inkAnnotation svg :is(path, polyline, polygon, line)) {
    pointer-events: stroke !important;
  }

  .pdf-container.annotation-tool-active :global(.annotationEditorLayer .freeTextEditor .internal) {
    pointer-events: auto !important;
  }

  :global(.annotationEditorLayer .inkEditor .ink-hit-area) {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 1;
  }

  :global(.annotationEditorLayer .inkEditor .ink-hit-area polyline) {
    cursor: move;
    pointer-events: stroke;
  }

  .pdf-container.annotation-tool-active :global(.annotationEditorLayer .editToolbar) {
    pointer-events: auto !important;
  }

  :global(.annotationEditorLayer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor).selectedEditor) {
    border: 1px dashed #2387d8 !important;
    outline: 0 !important;
  }

  :global(.annotationEditorLayer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor).selectedEditor::before) {
    border: 0 !important;
  }

  :global(.annotationEditorLayer .highlightEditor.selectedEditor) {
    outline: 1px dashed #2387d8 !important;
  }

  .bookmark-page-marker {
    position: absolute;
    z-index: 19;
    width: 12px;
    height: 22px;
    min-height: 0;
    appearance: none;
    border-radius: 0;
    border: 0;
    padding: 0;
    transform: translateY(-2px);
    cursor: pointer;
    pointer-events: auto;
  }

  button.bookmark-page-marker:hover,
  button.bookmark-page-marker.bookmark-hovered {
    background: #111827;
    filter: drop-shadow(0 0 0.28rem rgba(17, 24, 39, 0.86));
    transform: translateY(-2px) scale(1.12);
  }

  .bookmark-rail-focus-cue,
  .bookmark-rail-add-cue {
    position: absolute;
    z-index: 20;
    display: grid;
    box-sizing: border-box;
    place-items: center;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }

  .bookmark-rail-focus-cue {
    width: 22px;
    height: 22px;
    border: 1px solid #9aa3ad;
    border-radius: 999px;
    color: #1f2933;
    background: #ffffff;
    box-shadow: 0 1px 5px rgba(15, 23, 42, 0.18);
    font-size: 16px;
    transform: translate(-50%, -50%);
  }

  .bookmark-rail-add-cue {
    width: 36px;
    height: 36px;
    border: 2px solid #ffffff;
    border-radius: 999px;
    color: #ffffff;
    background: #22c55e;
    box-shadow: 0 2px 7px rgba(15, 80, 40, 0.32);
    font-size: 24px;
    transform: translate(-50%, -50%);
  }

  .pdfViewer {
    --scale-factor: 1;
    position: relative;
  }

  :global(.pdfViewer .page) {
    margin: 16px auto;
    border: 0;
    box-shadow: 0 2px 14px rgba(28, 36, 48, 0.18);
  }
</style>
