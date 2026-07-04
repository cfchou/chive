<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import * as pdfjsLib from "pdfjs-dist";
  import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
  import inkCursorUrl from "pdfjs-dist/web/images/cursor-editorInk.svg?url";
  import {
    EventBus,
    PDFLinkService,
    PDFViewer,
  } from "pdfjs-dist/web/pdf_viewer.mjs";
  import "pdfjs-dist/web/pdf_viewer.css";

  if (import.meta.env.VITE_WDIO_TAURI === "1" && typeof window !== "undefined") {
    void import("@wdio/tauri-plugin");
  }

  type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
  type EditorTool = "none" | "highlight" | "text" | "ink";
  type FocusScope = "app" | "pdf";
  type PdfMode = "normal" | "visualText" | "visualBlock";
  type NavigationTab = "outline" | "bookmarks" | "annotations";
  type HighlightColorName = "yellow" | "green" | "blue" | "pink";
  type FreeTextColorName = "black" | "green" | "blue" | "pink";
  type InkColorName = "black" | "red" | "yellow" | "blue" | "pink";
  type SelectedAnnotationKind = "highlight" | "freetext" | "ink" | null;
  type PdfDestination = string | unknown[] | null;
  type PdfOutlineRaw = {
    title?: string;
    dest?: PdfDestination;
    url?: string | null;
    items?: PdfOutlineRaw[];
  };
  type PdfAnnotationRaw = Record<string, unknown> & {
    rect?: unknown;
    quadPoints?: unknown;
    subtype?: string;
    id?: string;
  };
  type OutlineEntry = {
    id: string;
    title: string;
    dest: PdfDestination;
    url: string | null;
    pageNumber: number | null;
    targetY: number | null;
    destinationStatus: string | null;
    items: OutlineEntry[];
  };
  type BookmarkEntry = {
    id: string;
    title: string;
    pageNumber: number;
    pageRef: string;
    pageHeight: number;
    targetY: number;
    destinationY: number;
  };
  type AnnotationEntry = {
    id: string;
    sourceId: string;
    source: "live" | "pdf";
    page: number;
    kind: Exclude<SelectedAnnotationKind, null>;
    label: string;
    detail: string;
    color: string | number[] | null;
    bounds: RectLike | null;
    targetIndex: number;
    sortTop: number;
    sortLeft: number;
  };
  type AnnotationPageGroup = {
    page: number;
    entries: AnnotationEntry[];
  };
  type FocusBox = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type PdfCursor = {
    pageNumber: number;
    nodeIndex: number;
    nodeOffset: number;
    textOffset: number;
    text: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    visualLeft: number;
    visualRight: number;
    height: number;
    caretHeight: number;
    direction: "ltr" | "rtl";
  };
  type PdfWordPosition = PdfCursor & {
    node: Text;
  };
  type PdfWordRect = RectLike & {
    width: number;
    height: number;
  };
  type PdfWordMatch = {
    index: number;
    text: string;
    rect: PdfWordRect | null;
  };
  type PdfSelectionRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type AnnotationEditor = {
    id: string;
    annotationElementId?: string | null;
    color?: string | null;
    deleted?: boolean;
    editorType: number | string;
    hasBeenModified?: boolean;
    pageIndex?: number;
    commit?: () => void;
    enterInEditMode?: () => void;
    remove?: () => void;
    serialize?: (isForCopying?: boolean, context?: Record<string, unknown> | null) => Record<string, unknown> | null;
  };
  type AnnotationEditorLayerRef = {
    createAndAddNewEditor: (
      event: { offsetX: number; offsetY: number },
      isCentered: boolean,
      data?: Record<string, unknown>,
    ) => AnnotationEditor | null;
  };
  type AnnotationEditorUIManager = {
    delete: () => void;
    findParent: (x: number, y: number) => AnnotationEditorLayerRef | null;
    firstSelectedEditor?: AnnotationEditor;
    getEditors: (pageIndex: number) => Generator<AnnotationEditor, void, unknown>;
    highlightSelection: (methodOfCreation?: string, comment?: boolean) => void;
    isDeletedAnnotationElement?: (annotationElementId: string) => boolean;
    setSelected: (editor: AnnotationEditor) => void;
    unselectAll: () => void;
    updateParams: (type: number, value: unknown) => void;
  };
  type SpikeDebugApi = {
    annotationSummary: () => Promise<Record<string, unknown>[]>;
    annotationSidebarSummary: () => AnnotationEntry[];
    bookmarkSummary: () => BookmarkEntry[];
    outlineSummary: () => OutlineEntry[];
    activateFirstOutlineItem: () => Promise<boolean>;
    activateFirstAnnotationItem: () => Promise<boolean>;
    activateAnnotationBySourceId: (sourceId: string) => Promise<boolean>;
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
    setInkMarkerPreset: () => void;
    moveSelected: (x: number, y: number) => boolean;
    editSelectedFreeText: (text: string) => Promise<boolean>;
    deleteSelected: () => boolean;
    debugSavedBytes: (path: string) => number[];
    highlightSelection: () => void;
    stats: () => Record<string, unknown>;
    setTool: (tool: EditorTool) => void;
  };

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdfjsWasmUrl = "/pdfjs-wasm/";
  const bookmarkRootTitle = "My Bookmarks";
  const bookmarkTitleSnapTolerancePdfPoints = 4;
  const bookmarkTitleLookaheadPdfPoints = 180;
  const bookmarkTitleWordCount = 4;
  const bookmarkRailAnchorWidthPx = 12;
  const bookmarkRailAnchorHeightPx = 22;

  let containerEl: HTMLDivElement;
  let viewerEl: HTMLDivElement;
  let pdfViewer: PDFViewer | null = null;
  let pdfLinkService: PDFLinkService | null = null;
  let pdfDocument = $state<PdfDocument | null>(null);
  let annotationEditorUIManager: AnnotationEditorUIManager | null = null;
  let outlineEntries = $state<OutlineEntry[]>([]);
  let outlineStatus = $state("Open a PDF to inspect its outline.");
  let navigationTab = $state<NavigationTab>("outline");
  let bookmarkEntries = $state<BookmarkEntry[]>([]);
  let bookmarkStatus = $state("Open a PDF to inspect bookmarks.");
  let editingBookmarkId = $state<string | null>(null);
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
  let currentPath = $state("");
  let status = $state("Open a PDF, add highlight/text/ink annotations, then save.");
  let focusScope = $state<FocusScope>("app");
  let pdfMode = $state<PdfMode>("normal");
  let pdfCursor = $state<PdfCursor | null>(null);
  let pdfVisualAnchor: PdfCursor | null = null;
  let pdfVisualSelectionRects = $state<PdfSelectionRect[]>([]);
  let pdfVisualSelectionText = $state("");
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
  let pdfTextMeasureCanvas: HTMLCanvasElement | null = null;

  const highlightColors: Record<HighlightColorName, string> = {
    yellow: "#fff35c",
    green: "#7cf2aa",
    blue: "#8ecbff",
    pink: "#ffb6de",
  };
  const freeTextColors: Record<FreeTextColorName, string> = {
    black: "#1e2329",
    green: "#4f7a29",
    blue: "#2f6ecb",
    pink: "#b82f76",
  };
  const inkColors: Record<InkColorName, string> = {
    black: "#1e2329",
    red: "#e32400",
    yellow: "#fff35c",
    blue: "#2f6ecb",
    pink: "#b82f76",
  };
  const inkThicknesses = [1, 3, 8, 14] as const;

  const editorModes = {
    none: pdfjsLib.AnnotationEditorType.NONE,
    highlight: pdfjsLib.AnnotationEditorType.HIGHLIGHT,
    text: pdfjsLib.AnnotationEditorType.FREETEXT,
    ink: pdfjsLib.AnnotationEditorType.INK,
  } as const;

  onMount(() => {
    const debugWindow = window as Window & { __pdfSpike?: SpikeDebugApi };
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
    document.addEventListener("keydown", handlePdfCursorKey);
    document.addEventListener("keydown", handleAnnotationDeleteKey, { capture: true });
    containerEl?.addEventListener("pointerdown", handlePdfPointerDown, { capture: true });
    const handleRailClick = (event: MouseEvent) => void handlePdfContainerClick(event);
    const clearRailHoverCue = () => (bookmarkRailHoverCue = null);
    containerEl?.addEventListener("click", handleRailClick);
    containerEl?.addEventListener("mousemove", handlePdfContainerMouseMove);
    containerEl?.addEventListener("mouseleave", clearRailHoverCue);
    debugWindow.__pdfSpike = {
      annotationSummary: getAnnotationSummary,
      annotationSidebarSummary: () => annotationEntries,
      bookmarkSummary: () => bookmarkEntries,
      outlineSummary: () => outlineEntries,
      activateFirstOutlineItem,
      activateFirstAnnotationItem,
      activateAnnotationBySourceId,
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
      highlightSelection: () => highlightSelection(),
      stats: getDebugStats,
      setTool,
    };
    return () => {
      containerEl?.removeEventListener("mouseleave", clearRailHoverCue);
      containerEl?.removeEventListener("mousemove", handlePdfContainerMouseMove);
      containerEl?.removeEventListener("click", handleRailClick);
      containerEl?.removeEventListener("pointerdown", handlePdfPointerDown, { capture: true });
      document.removeEventListener("keydown", handleAnnotationDeleteKey, { capture: true });
      document.removeEventListener("keydown", handlePdfCursorKey);
      document.removeEventListener("selectionchange", rememberSelection);
      delete debugWindow.__pdfSpike;
    };
  });

  function handlePdfCursorKey(event: KeyboardEvent) {
    if (event.repeat || isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (event.key === "p" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (focusPdfCursor()) {
        event.preventDefault();
      }
      return;
    }
    if (focusScope !== "pdf") {
      return;
    }
    if (event.key === "Escape") {
      if (pdfMode !== "normal") {
        pdfMode = "normal";
        clearPdfVisualSelection();
      } else {
        focusScope = "app";
        pdfCursor = null;
        clearPdfVisualSelection();
      }
      event.preventDefault();
      return;
    }
    if (event.key === "v" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (enterPdfVisualTextMode()) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter" && pdfMode === "visualText") {
      event.preventDefault();
      void createHighlightFromPdfVisualSelection();
      return;
    }
    if (event.key === "w" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (movePdfCursorToNextWord()) {
        event.preventDefault();
      }
      return;
    }
    const key = event.key.toLowerCase();
    const code = event.code.toLowerCase();
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      const scrollAmount =
        key === "d" || code === "keyd"
          ? 0.5
          : key === "u" || code === "keyu"
            ? -0.5
            : key === "f" || code === "keyf"
              ? 1
              : key === "b" || code === "keyb"
                ? -1
                : 0;
      if (scrollAmount !== 0 && scrollPdfByPages(scrollAmount)) {
        event.preventDefault();
      }
    }
  }

  function focusPdfCursor() {
    if (!pdfViewer || !viewerEl) {
      status = "Open a PDF before focusing PDF text.";
      return false;
    }
    const words = renderedPdfWords(pdfViewer.currentPageNumber || 1);
    if (words.length === 0) {
      focusScope = "pdf";
      pdfMode = "normal";
      pdfCursor = null;
      status = "No selectable text on this page.";
      return true;
    }
    focusScope = "pdf";
    pdfMode = "normal";
    clearPdfVisualSelection();
    setPdfCursor(words[0]);
    status = "PDF normal mode.";
    return true;
  }

  function enterPdfVisualTextMode() {
    if (!pdfCursor && !focusPdfCursor()) {
      return false;
    }
    if (!pdfCursor) {
      status = "No selectable text on this page.";
      return true;
    }
    focusScope = "pdf";
    pdfMode = "visualText";
    pdfVisualAnchor = { ...pdfCursor };
    pdfVisualSelectionRects = [];
    pdfVisualSelectionText = "";
    document.getSelection()?.removeAllRanges();
    status = "PDF visual mode.";
    return true;
  }

  function movePdfCursorToNextWord() {
    if (!pdfCursor) {
      return focusPdfCursor();
    }
    const words = renderedPdfWords(pdfCursor.pageNumber);
    const currentIndex = words.findIndex(
      (word) => word.nodeIndex === pdfCursor?.nodeIndex && word.nodeOffset === pdfCursor.nodeOffset,
    );
    const nextWord = currentIndex >= 0 ? words[currentIndex + 1] : words.find((word) => word.top > pdfCursor!.top);
    if (!nextWord) {
      return false;
    }
    setPdfCursor(nextWord);
    if (pdfMode === "visualText") {
      updatePdfVisualSelection();
      status = "PDF visual mode.";
    } else {
      status = "PDF normal mode.";
    }
    return true;
  }

  function scrollPdfByPages(pageFraction: number) {
    if (!containerEl) return false;
    containerEl.scrollTop = Math.max(0, containerEl.scrollTop + containerEl.clientHeight * pageFraction);
    recenterPdfCursorToVisibleText();
    status = pdfMode === "visualText" ? "PDF visual mode." : "PDF normal mode.";
    return true;
  }

  function recenterPdfCursorToVisibleText() {
    if (!pdfViewer || !containerEl || !viewerEl) return false;
    const viewportCenter = containerEl.clientHeight / 2;
    const candidates: { word: PdfWordPosition; viewportTop: number }[] = [];
    for (const pageElement of viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
      const pageNumber = Number(pageElement.dataset.pageNumber);
      if (!Number.isInteger(pageNumber)) continue;
      for (const word of renderedPdfWords(pageNumber)) {
        const viewportTop = word.top - containerEl.scrollTop;
        if (viewportTop >= 0 && viewportTop <= containerEl.clientHeight) {
          candidates.push({ word, viewportTop });
        }
      }
    }
    const nearest = candidates.sort(
      (left, right) => Math.abs(left.viewportTop - viewportCenter) - Math.abs(right.viewportTop - viewportCenter),
    )[0];
    if (!nearest) return false;
    setPdfCursor(nearest.word);
    if (pdfMode === "visualText") {
      updatePdfVisualSelection();
    }
    return true;
  }

  function setPdfCursor(position: PdfWordPosition) {
    pdfCursor = {
      pageNumber: position.pageNumber,
      nodeIndex: position.nodeIndex,
      nodeOffset: position.nodeOffset,
      textOffset: position.textOffset,
      text: position.text,
      left: position.left,
      top: position.top,
      right: position.right,
      bottom: position.bottom,
      visualLeft: position.visualLeft,
      visualRight: position.visualRight,
      height: position.height,
      caretHeight: position.caretHeight,
      direction: position.direction,
    };
  }

  function pdfCursorStyle(cursor: PdfCursor) {
    const left = cursor.left;
    const height = Math.max(18, cursor.caretHeight);
    const top = cursor.top + cursor.height / 2 - height / 2;
    return `left: ${left}px; top: ${top}px; height: ${height}px`;
  }

  function pdfVisualSelectionStyle(rect: PdfSelectionRect) {
    return `left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px`;
  }

  function pdfCursorViewportTop() {
    if (!pdfCursor || !containerEl) return null;
    return pdfCursor.top - containerEl.scrollTop;
  }

  function updatePdfVisualSelection() {
    if (!pdfVisualAnchor || !pdfCursor) return false;
    const words = selectedPdfVisualWords();
    if (words.length === 0) return false;
    pdfVisualSelectionRects = mergedPdfVisualSelectionRects(words);
    pdfVisualSelectionText = words.map((word) => word.text).join(" ");
    rememberedSelectionText = pdfVisualSelectionText;
    document.getSelection()?.removeAllRanges();
    return true;
  }

  async function createHighlightFromPdfVisualSelection() {
    setNativeSelectionFromPdfVisualSelection();
    const created = await createHighlightFromSelection({
      allowModeSwitchAutoCreate: false,
      createdStatus: "Created text highlight from PDF visual mode. Save to persist it into the PDF.",
      methodOfCreation: "pdf_visual_mode",
      resetModeToNone: true,
    });
    if (created) {
      focusScope = "pdf";
      pdfMode = "normal";
      clearPdfVisualSelection();
    }
    return created;
  }

  function clearPdfVisualSelection() {
    pdfVisualAnchor = null;
    pdfVisualSelectionRects = [];
    pdfVisualSelectionText = "";
    document.getSelection()?.removeAllRanges();
  }

  function selectedPdfVisualWords() {
    if (!pdfVisualAnchor || !pdfCursor || pdfVisualAnchor.pageNumber !== pdfCursor.pageNumber) return [];
    const words = renderedPdfWords(pdfCursor.pageNumber);
    const anchorIndex = words.findIndex(
      (word) => word.nodeIndex === pdfVisualAnchor?.nodeIndex && word.nodeOffset === pdfVisualAnchor.nodeOffset,
    );
    const cursorIndex = words.findIndex(
      (word) => word.nodeIndex === pdfCursor?.nodeIndex && word.nodeOffset === pdfCursor.nodeOffset,
    );
    if (anchorIndex < 0 || cursorIndex < 0) return [];
    const start = Math.min(anchorIndex, cursorIndex);
    const end = Math.max(anchorIndex, cursorIndex);
    return words.slice(start, end + 1);
  }

  function mergedPdfVisualSelectionRects(words: PdfWordPosition[]) {
    const lineRects: { top: number; bottom: number; left: number; right: number }[] = [];
    for (const word of words) {
      const line = lineRects.find((candidate) => wordLineOverlapRatio(candidate, word) >= 0.55);
      if (line) {
        line.top = Math.min(line.top, word.top);
        line.bottom = Math.max(line.bottom, word.bottom);
        line.left = Math.min(line.left, word.visualLeft);
        line.right = Math.max(line.right, word.visualRight);
      } else {
        lineRects.push({
          top: word.top,
          bottom: word.bottom,
          left: word.visualLeft,
          right: word.visualRight,
        });
      }
    }
    return lineRects.map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.right - rect.left,
      height: Math.max(12, rect.bottom - rect.top),
    }));
  }

  function setNativeSelectionFromPdfVisualSelection() {
    if (!pdfVisualAnchor || !pdfCursor) return false;
    const anchorNode = pdfTextNodeAt(pdfVisualAnchor.pageNumber, pdfVisualAnchor.nodeIndex);
    const cursorNode = pdfTextNodeAt(pdfCursor.pageNumber, pdfCursor.nodeIndex);
    if (!anchorNode || !cursorNode) return false;
    const range = document.createRange();
    const anchorOffset = Math.min(pdfVisualAnchor.nodeOffset, anchorNode.textContent?.length ?? 0);
    const cursorEnd = Math.min(pdfCursor.nodeOffset + pdfCursor.text.length, cursorNode.textContent?.length ?? 0);
    if (pdfVisualAnchor.textOffset <= pdfCursor.textOffset) {
      range.setStart(anchorNode, anchorOffset);
      range.setEnd(cursorNode, cursorEnd);
    } else {
      range.setStart(cursorNode, cursorEnd);
      range.setEnd(anchorNode, anchorOffset);
    }
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  function pdfTextNodeAt(pageNumber: number, targetIndex: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const textLayer = pageElement?.querySelector<HTMLElement>(".textLayer");
    if (!textLayer) return null;
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    let index = 0;
    while ((textNode = walker.nextNode() as Text | null)) {
      if (index === targetIndex) return textNode;
      index += 1;
    }
    return null;
  }

  function renderedPdfWords(pageNumber: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const textLayer = pageElement?.querySelector<HTMLElement>(".textLayer");
    if (!pageElement || !textLayer || !containerEl) return [];
    const containerRect = containerEl.getBoundingClientRect();
    const words: PdfWordPosition[] = [];
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    let nodeIndex = 0;
    let textOffset = 0;
    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent ?? "";
      const parent = textNode.parentElement;
      const direction = parent && getComputedStyle(parent).direction === "rtl" ? "rtl" : "ltr";
      const matches: PdfWordMatch[] = [];
      for (const match of text.matchAll(/\S+/g)) {
        if (match.index === undefined) continue;
        matches.push({
          index: match.index,
          text: match[0],
          rect: measuredRangeRect(textNode, match.index, match[0].length),
        });
      }
      const useMeasuredRects = shouldUseMeasuredTextRects(textNode, matches, direction);
      for (const match of matches) {
        const rect = useMeasuredRects
          ? measuredTextWordRect(textNode, match.index, match.text, direction) ?? match.rect
          : match.rect;
        if (!rect) continue;
        const visualLeft = rect.left - containerRect.left + containerEl.scrollLeft;
        const visualRight = rect.right - containerRect.left + containerEl.scrollLeft;
        const left = direction === "rtl" ? visualRight : visualLeft;
        const right = direction === "rtl" ? visualLeft : visualRight;
        const top = rect.top - containerRect.top + containerEl.scrollTop;
        const bottom = rect.bottom - containerRect.top + containerEl.scrollTop;
        const caretHeight = pdfTextCaretHeight(textNode, rect.height);
        words.push({
          pageNumber,
          node: textNode,
          nodeIndex,
          nodeOffset: match.index,
          textOffset: textOffset + match.index,
          text: match.text,
          left,
          top,
          right,
          bottom,
          visualLeft,
          visualRight,
          height: rect.height,
          caretHeight,
          direction,
        });
      }
      textOffset += text.length;
      nodeIndex += 1;
    }
    return orderPdfWordsByVisualPosition(words);
  }

  function measuredRangeRect(textNode: Text, index: number, length: number): PdfWordRect | null {
    const range = document.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + length);
    const rect = firstUsableRect(range);
    range.detach();
    return rect ? rectLikeFromDomRect(rect) : null;
  }

  function firstUsableRect(range: Range) {
    return [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ?? null;
  }

  function rectLikeFromDomRect(rect: DOMRectReadOnly): PdfWordRect {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function shouldUseMeasuredTextRects(
    textNode: Text,
    matches: PdfWordMatch[],
    direction: "ltr" | "rtl",
  ) {
    if (matches.length < 2) return false;
    const parentRect = textNode.parentElement?.getBoundingClientRect();
    if (!parentRect || parentRect.width <= 0 || parentRect.height <= 0) return false;
    const rects = matches.map((match) => match.rect);
    if (rects.some((rect) => !rect)) return true;
    const usableRects = rects.filter((rect): rect is PdfWordRect => Boolean(rect));
    const starts = usableRects.map((rect) => (direction === "rtl" ? rect.right : rect.left));
    const startSpread = Math.max(...starts) - Math.min(...starts);
    const hasFullSpanWord = usableRects.some((rect) => rect.width >= parentRect.width * 0.85);
    return startSpread < 1 || hasFullSpanWord;
  }

  function measuredTextWordRect(
    textNode: Text,
    index: number,
    text: string,
    direction: "ltr" | "rtl",
  ): PdfWordRect | null {
    const parent = textNode.parentElement;
    if (!parent) return null;
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) return null;
    const fullText = textNode.textContent ?? "";
    const context = textMeasureContext();
    if (!context) return null;
    const style = getComputedStyle(parent);
    context.font = canvasFontForElement(style);
    const letterSpacing = cssPixelValue(style.letterSpacing);
    const fullWidth = measureCanvasText(context, fullText, letterSpacing);
    if (fullWidth <= 0) return null;
    const startRatio = measureCanvasText(context, fullText.slice(0, index), letterSpacing) / fullWidth;
    const endRatio = measureCanvasText(context, fullText.slice(0, index + text.length), letterSpacing) / fullWidth;
    const visualLeft =
      direction === "rtl"
        ? parentRect.right - parentRect.width * endRatio
        : parentRect.left + parentRect.width * startRatio;
    const visualRight =
      direction === "rtl"
        ? parentRect.right - parentRect.width * startRatio
        : parentRect.left + parentRect.width * endRatio;
    return {
      left: Math.min(visualLeft, visualRight),
      top: parentRect.top,
      right: Math.max(visualLeft, visualRight),
      bottom: parentRect.bottom,
      width: Math.abs(visualRight - visualLeft),
      height: parentRect.height,
    };
  }

  function textMeasureContext() {
    pdfTextMeasureCanvas ??= document.createElement("canvas");
    return pdfTextMeasureCanvas.getContext("2d");
  }

  function canvasFontForElement(style: CSSStyleDeclaration) {
    return (
      style.font ||
      `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    );
  }

  function measureCanvasText(context: CanvasRenderingContext2D, text: string, letterSpacing: number) {
    return context.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
  }

  function cssPixelValue(value: string) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function pdfTextCaretHeight(textNode: Text, fallbackHeight: number) {
    const fontHeight = textNode.parentElement
      ? cssPixelValue(getComputedStyle(textNode.parentElement).getPropertyValue("--font-height"))
      : 0;
    return Math.max(fallbackHeight, fontHeight);
  }

  function orderPdfWordsByVisualPosition(words: PdfWordPosition[]) {
    const lines: { top: number; bottom: number; words: PdfWordPosition[] }[] = [];
    for (const word of [...words].sort((left, right) => left.top - right.top || left.visualLeft - right.visualLeft)) {
      const line = lines.find((candidate) => wordLineOverlapRatio(candidate, word) >= 0.55);
      if (line) {
        line.words.push(word);
        line.top = Math.min(line.top, word.top);
        line.bottom = Math.max(line.bottom, word.bottom);
      } else {
        lines.push({ top: word.top, bottom: word.bottom, words: [word] });
      }
    }
    return lines
      .sort((left, right) => left.top - right.top || left.words[0].visualLeft - right.words[0].visualLeft)
      .flatMap((line) => {
        const rtlWords = line.words.filter((word) => word.direction === "rtl").length;
        const isRtlLine = rtlWords > line.words.length / 2;
        return line.words.sort((left, right) =>
          isRtlLine
            ? right.visualRight - left.visualRight || left.top - right.top
            : left.visualLeft - right.visualLeft || left.top - right.top,
        );
      });
  }

  function wordLineOverlapRatio(line: { top: number; bottom: number }, word: PdfWordPosition) {
    const overlap = Math.max(0, Math.min(line.bottom, word.bottom) - Math.max(line.top, word.top));
    const wordHeight = Math.max(1, word.bottom - word.top);
    return overlap / wordHeight;
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
      enableHighlightFloatingButton: true,
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
    eventBus.on("editingstateschanged", syncSelectedEditorState);
    eventBus.on("annotationeditorparamschanged", syncSelectedEditorState);
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
      annotationStatus =
        merged.length === 0
          ? "No editable annotations found."
          : `${merged.length} annotation${merged.length === 1 ? "" : "s"}.`;
    } catch (error) {
      annotationStatus = `Annotation scan failed: ${formatError(error)}`;
    }
  }

  async function getPdfAnnotationEntries() {
    const pages = await getAnnotationSummary();
    const entries: AnnotationEntry[] = [];
    const targetIndexes = new Map<string, number>();
    for (const page of pages) {
      const pageNumber = Number(page.page);
      const annotations = Array.isArray(page.annotations) ? page.annotations : [];
      for (const annotation of annotations as Record<string, unknown>[]) {
        const kind = annotationKindForSubtype(annotation.subtype);
        if (!kind) continue;
        const id = String(annotation.id ?? `${pageNumber}-${entries.length}`);
        if (isPersistedAnnotationHidden(pageNumber, id)) continue;
        const indexKey = `${pageNumber}:${kind}`;
        const targetIndex = targetIndexes.get(indexKey) ?? 0;
        targetIndexes.set(indexKey, targetIndex + 1);
        const extractedDetail =
          kind === "highlight"
            ? (await textForPdfAnnotation(pageNumber, annotation)) ||
              textForAnnotationDom(pageNumber, kind, targetIndex) ||
              annotationDetail(annotation)
            : annotationDetail(annotation);
        const entryId = `pdf:${id}`;
        const position =
          (await pdfAnnotationSortPosition(pageNumber, annotation)) ??
          annotationTargetPosition(pageNumber, kind, targetIndex);
        const bounds = await pdfAnnotationBounds(pageNumber, annotation);
        entries.push({
          id: entryId,
          sourceId: id,
          source: "pdf",
          page: pageNumber,
          kind,
          label: annotationLabel(kind),
          detail: cachedAnnotationDetail(entryId, extractedDetail),
          color: (annotation.color as number[] | null) ?? null,
          bounds,
          targetIndex,
          sortTop: position.top,
          sortLeft: position.left,
        });
      }
    }
    return entries;
  }

  function getLiveAnnotationEntries(persistedEntries: AnnotationEntry[]) {
    if (!annotationEditorUIManager || !pdfDocument) return [];
    const entries: AnnotationEntry[] = [];
    const targetIndexes = new Map<string, number>();
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (editor.deleted) continue;
        const kind = annotationKindForEditor(editor);
        if (!kind) continue;
        const pageNumber = pageIndex + 1;
        if (isUnmodifiedEditorMirrorOfPersistedAnnotation(editor, persistedEntries, pageNumber)) {
          continue;
        }
        const indexKey = `${pageNumber}:${kind}`;
        const fallbackTargetIndex = targetIndexes.get(indexKey) ?? 0;
        targetIndexes.set(indexKey, fallbackTargetIndex + 1);
        const entryId = `live:${editor.id}`;
        const targetIndex = targetIndexForEditor(pageNumber, kind, editor.id, fallbackTargetIndex);
        const position = annotationTargetPosition(pageNumber, kind, targetIndex, editor.id);
        const bounds = annotationTargetBounds(pageNumber, kind, targetIndex, editor.id);
        if (bounds && persistedEntries.some((entry) => entry.bounds && entry.page === pageNumber && boundsOverlapSignificantly(bounds, entry.bounds))) {
          continue;
        }
        const detail = liveAnnotationDetail(editor, pageNumber, targetIndex);
        if (isDuplicateLiveAnnotation(entries, pageNumber, kind, bounds, detail)) {
          continue;
        }
        entries.push({
          id: entryId,
          sourceId: editor.id,
          source: "live",
          page: pageNumber,
          kind,
          label: annotationLabel(kind),
          detail: cachedAnnotationDetail(entryId, detail),
          color: editor.color ?? null,
          bounds,
          targetIndex,
          sortTop: position.top,
          sortLeft: position.left,
        });
      }
    }
    return entries;
  }

  function isDuplicateLiveAnnotation(
    entries: AnnotationEntry[],
    pageNumber: number,
    kind: Exclude<SelectedAnnotationKind, null>,
    bounds: RectLike | null,
    detail: string,
  ) {
    return entries.some((entry) => {
      if (entry.page !== pageNumber || entry.kind !== kind) return false;
      if (bounds && entry.bounds && boundsOverlapSignificantly(bounds, entry.bounds)) {
        return true;
      }
      return !bounds && !entry.bounds && entry.detail === detail;
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

  function pdfAnnotationElementId(sourceId: string) {
    return sourceId.startsWith("pdfjs_internal_id_") ? sourceId : `pdfjs_internal_id_${sourceId}`;
  }

  function sourceIdFromPdfAnnotationElementId(elementId: string) {
    if (!elementId) return null;
    return elementId.startsWith("pdfjs_internal_id_")
      ? elementId.slice("pdfjs_internal_id_".length)
      : elementId;
  }

  function persistedAnnotationKey(pageNumber: number, sourceId: string) {
    return `${pageNumber}:${sourceId}`;
  }

  function persistedAnnotationKeyParts(key: string) {
    const separator = key.indexOf(":");
    if (separator < 0) return null;
    const pageNumber = Number(key.slice(0, separator));
    const sourceId = key.slice(separator + 1);
    return Number.isInteger(pageNumber) && pageNumber > 0 && sourceId ? { pageNumber, sourceId } : null;
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

  function annotationKindForSubtype(subtype: unknown): Exclude<SelectedAnnotationKind, null> | null {
    if (subtype === "Highlight") return "highlight";
    if (subtype === "FreeText") return "freetext";
    if (subtype === "Ink") return "ink";
    return null;
  }

  function annotationLabel(kind: Exclude<SelectedAnnotationKind, null>) {
    if (kind === "freetext") return "Free text";
    return kind[0].toUpperCase() + kind.slice(1);
  }

  function annotationDetail(annotation: Record<string, unknown>) {
    const text = annotation.textContent;
    if (Array.isArray(text)) {
      return text.join(" ").trim() || "Persisted PDF annotation";
    }
    const contents = annotation.contentsObj;
    if (contents && typeof contents === "object" && "str" in contents) {
      return String((contents as { str?: unknown }).str ?? "").trim() || "Persisted PDF annotation";
    }
    return "Persisted PDF annotation";
  }

  async function textForPdfAnnotation(pageNumber: number, annotation: PdfAnnotationRaw) {
    const rect = numbersFromUnknown(annotation.rect);
    if (!pdfDocument || rect.length < 4) {
      return "";
    }
    try {
      const page = await (pdfDocument as PdfDocument & {
        getPage: (pageNumber: number) => Promise<{
          getTextContent: () => Promise<{ items: Record<string, unknown>[] }>;
          streamTextContent?: () => { getReader: () => { read: () => Promise<{ done?: boolean; value?: { items?: Record<string, unknown>[] } }> } };
          getViewport: (options: { scale: number }) => {
            height: number;
            transform: number[];
            convertToViewportRectangle: (rect: number[]) => number[];
            convertToViewportPoint?: (x: number, y: number) => number[];
          };
        }>;
      }).getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const annotationRects = annotationViewportRects(annotation, viewport);
      const rawItems = await getPageTextItems(page);
      const chunks = rawItems
        .map((rawItem, index) => {
          const item = rawItem as Record<string, unknown>;
          const text = String(item.str ?? "");
          const transform = numbersFromUnknown(item.transform);
          if (!text.trim() || transform.length < 6) return null;
          const tx = transformMatrix(viewport.transform, transform as number[]);
          const width = Number(item.width ?? 0);
          const height = Number(item.height ?? 0);
          const itemLeft = tx[4];
          const itemTop = tx[5] - height;
          const itemRight = itemLeft + width;
          const itemBottom = tx[5];
          const itemRect = { left: itemLeft, top: itemTop, right: itemRight, bottom: itemBottom };
          if (!annotationRects.some((annotationRect) => rectLikesOverlap(annotationRect, itemRect, 2))) {
            return null;
          }
          const selectedText = textForTextItemRects(text, itemRect, annotationRects);
          return {
            index,
            text: selectedText || text.trim(),
            rect: itemRect,
          };
        })
        .filter((chunk): chunk is { index: number; text: string; rect: RectLike } => Boolean(chunk))
        .sort((leftChunk, rightChunk) => leftChunk.index - rightChunk.index);
      return chunks.map(({ text }) => text).join(" ").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  async function getPageTextItems(page: {
    getTextContent: () => Promise<{ items: Record<string, unknown>[] }>;
    streamTextContent?: () => { getReader: () => { read: () => Promise<{ done?: boolean; value?: { items?: Record<string, unknown>[] } }> } };
  }) {
    if (typeof page.streamTextContent === "function") {
      const reader = page.streamTextContent().getReader();
      const items: Record<string, unknown>[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && Array.isArray(value.items)) {
          items.push(...value.items);
        }
      }
      return items;
    }
    const textContent = await page.getTextContent();
    return Array.isArray(textContent.items) ? textContent.items : [];
  }

  async function pdfAnnotationSortPosition(pageNumber: number, annotation: PdfAnnotationRaw) {
    const rect = numbersFromUnknown(annotation.rect);
    if (!pdfDocument || rect.length < 4) return null;
    try {
      const page = await (pdfDocument as PdfDocument & {
        getPage: (pageNumber: number) => Promise<{
          getViewport: (options: { scale: number }) => {
            convertToViewportRectangle: (rect: number[]) => number[];
            transform: number[];
            convertToViewportPoint?: (x: number, y: number) => number[];
          };
        }>;
      }).getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const rects = annotationViewportRects(annotation, viewport);
      const firstLineTop = Math.min(...rects.map((candidate) => candidate.top));
      const firstLineRects = rects.filter((candidate) => Math.abs(candidate.top - firstLineTop) < 2);
      return {
        top: firstLineTop,
        left: Math.min(...firstLineRects.map((candidate) => candidate.left)),
      };
    } catch {
      return null;
    }
  }

  async function pdfAnnotationBounds(pageNumber: number, annotation: PdfAnnotationRaw) {
    const rect = numbersFromUnknown(annotation.rect);
    if (!pdfDocument || rect.length < 4) return null;
    try {
      const page = await (pdfDocument as PdfDocument & {
        getPage: (pageNumber: number) => Promise<{
          getViewport: (options: { scale: number }) => {
            width: number;
            height: number;
            transform: number[];
            convertToViewportRectangle: (rect: number[]) => number[];
            convertToViewportPoint?: (x: number, y: number) => number[];
          };
        }>;
      }).getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      return rectToPagePercent(unionRects(annotationViewportRects(annotation, viewport)), viewport.width, viewport.height);
    } catch {
      return null;
    }
  }

  type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };

  function normalizeViewportRect(rect: number[]) {
    const [x1, y1, x2, y2] = rect;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  function annotationViewportRects(
    annotation: PdfAnnotationRaw,
    viewport: {
      transform: number[];
      convertToViewportRectangle: (rect: number[]) => number[];
      convertToViewportPoint?: (x: number, y: number) => number[];
    },
  ) {
    const quadRects = quadPointViewportRects(annotation.quadPoints, viewport);
    if (quadRects.length > 0) {
      return quadRects;
    }
    const rect = numbersFromUnknown(annotation.rect);
    const [left, top, right, bottom] = normalizeViewportRect(viewport.convertToViewportRectangle(rect));
    return [{ left, top, right, bottom }];
  }

  function quadPointViewportRects(
    quadPoints: unknown,
    viewport: {
      transform: number[];
      convertToViewportPoint?: (x: number, y: number) => number[];
    },
  ) {
    const points = numbersFromUnknown(quadPoints);
    const rects: RectLike[] = [];
    for (let index = 0; index + 7 < points.length; index += 8) {
      const viewportPoints = [
        pointToViewport(viewport, points[index], points[index + 1]),
        pointToViewport(viewport, points[index + 2], points[index + 3]),
        pointToViewport(viewport, points[index + 4], points[index + 5]),
        pointToViewport(viewport, points[index + 6], points[index + 7]),
      ];
      const xs = viewportPoints.map(([x]) => x);
      const ys = viewportPoints.map(([, y]) => y);
      rects.push({
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      });
    }
    return rects;
  }

  function pointToViewport(
    viewport: {
      transform: number[];
      convertToViewportPoint?: (x: number, y: number) => number[];
    },
    x: number,
    y: number,
  ) {
    if (typeof viewport.convertToViewportPoint === "function") {
      return viewport.convertToViewportPoint(x, y);
    }
    return applyTransformToPoint(viewport.transform, x, y);
  }

  function numbersFromUnknown(value: unknown): number[] {
    if (Array.isArray(value)) {
      const values: number[] = [];
      for (const item of value) {
        values.push(...numbersFromUnknown(item));
      }
      return values;
    }
    if (ArrayBuffer.isView(value) && "length" in value) {
      return Array.from(value as unknown as ArrayLike<number>).filter(Number.isFinite);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return [value];
    }
    return [];
  }

  function textForTextItemRects(text: string, itemRect: RectLike, annotationRects: RectLike[]) {
    if (text.length === 0 || itemRect.right <= itemRect.left) return "";
    let firstOffset: number | null = null;
    let lastOffset: number | null = null;
    for (let offset = 0; offset < text.length; offset += 1) {
      const charRect = {
        left: itemRect.left + ((itemRect.right - itemRect.left) * offset) / text.length,
        top: itemRect.top,
        right: itemRect.left + ((itemRect.right - itemRect.left) * (offset + 1)) / text.length,
        bottom: itemRect.bottom,
      };
      if (annotationRects.some((annotationRect) => rectLikesOverlap(annotationRect, charRect, 1))) {
        firstOffset ??= offset;
        lastOffset = offset + 1;
      }
    }
    if (firstOffset === null || lastOffset === null) return "";
    const [start, end] = trimPartialWordEdges(text, firstOffset, lastOffset);
    return text.slice(start, end).trim() || text.slice(firstOffset, lastOffset).trim();
  }

  function trimPartialWordEdges(text: string, firstOffset: number, lastOffset: number): [number, number] {
    let start = firstOffset;
    let end = lastOffset;
    if (start > 0 && /\S/.test(text[start] ?? "") && /\S/.test(text[start - 1] ?? "")) {
      while (start < end && /\S/.test(text[start] ?? "")) start += 1;
      while (start < end && /\s/.test(text[start] ?? "")) start += 1;
    }
    if (end < text.length && /\S/.test(text[end] ?? "") && /\S/.test(text[end - 1] ?? "")) {
      while (end > start && /\S/.test(text[end - 1] ?? "")) end -= 1;
      while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
    }
    return [start, end];
  }

  function applyTransformToPoint(transform: number[], x: number, y: number) {
    return [x * transform[0] + y * transform[2] + transform[4], x * transform[1] + y * transform[3] + transform[5]];
  }

  function transformMatrix(left: number[], right: number[]) {
    return [
      left[0] * right[0] + left[2] * right[1],
      left[1] * right[0] + left[3] * right[1],
      left[0] * right[2] + left[2] * right[3],
      left[1] * right[2] + left[3] * right[3],
      left[0] * right[4] + left[2] * right[5] + left[4],
      left[1] * right[4] + left[3] * right[5] + left[5],
    ];
  }

  function rectLikesOverlap(left: RectLike, right: RectLike, padding = 0) {
    return (
      left.left - padding < right.right &&
      left.right + padding > right.left &&
      left.top - padding < right.bottom &&
      left.bottom + padding > right.top
    );
  }

  function unionRects(rects: RectLike[]) {
    return rects.reduce(
      (union, rect) => ({
        left: Math.min(union.left, rect.left),
        top: Math.min(union.top, rect.top),
        right: Math.max(union.right, rect.right),
        bottom: Math.max(union.bottom, rect.bottom),
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    );
  }

  function rectToPagePercent(rect: RectLike, width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return {
      left: rect.left / width,
      top: rect.top / height,
      right: rect.right / width,
      bottom: rect.bottom / height,
    };
  }

  function boundsOverlapSignificantly(left: RectLike, right: RectLike) {
    const intersectionWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const intersectionHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const intersectionArea = intersectionWidth * intersectionHeight;
    const smallerArea = Math.min(rectArea(left), rectArea(right));
    return smallerArea > 0 && intersectionArea / smallerArea > 0.55;
  }

  function rectArea(rect: RectLike) {
    return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
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

  function cachedAnnotationDetail(entryId: string, detail: string) {
    const cached = annotationDetailCache.get(entryId);
    if (cached) {
      return cached;
    }
    const normalized = detail.trim();
    if (isUsefulAnnotationDetail(normalized)) {
      annotationDetailCache.set(entryId, normalized);
      return normalized;
    }
    return annotationDetailCache.get(entryId) ?? normalized;
  }

  function isUsefulAnnotationDetail(detail: string) {
    return Boolean(
      detail &&
        detail !== "Persisted PDF annotation" &&
        detail !== "Unsaved/live highlight" &&
        detail !== "Unsaved/live free text" &&
        detail !== "Unsaved/live ink",
    );
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
        if (rect.width > 0 && rect.height > 0 && rectsOverlap(targetRect, rect, 1)) {
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

  function rectsOverlap(left: DOMRect, right: DOMRect, padding = 0) {
    return (
      left.left - padding < right.right &&
      left.right + padding > right.left &&
      left.top - padding < right.bottom &&
      left.bottom + padding > right.top
    );
  }

  async function loadOutline(document: PdfDocument) {
    outlineEntries = [];
    outlineStatus = "Loading outline...";
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
        bookmarkStatus = "No bookmarks yet.";
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
      bookmarkStatus =
        bookmarkEntries.length === 0
          ? "No bookmarks yet."
          : `${bookmarkEntries.length} bookmark${bookmarkEntries.length === 1 ? "" : "s"}.`;
      if (documentOutline.length === 0) {
        outlineStatus = "This PDF has no outline.";
        return;
      }
      outlineEntries = await Promise.all(
        documentOutline.map((item, index) => normalizeOutlineEntry(documentWithOutline, item, `${index + 1}`)),
      );
      const count = countOutlineEntries(outlineEntries);
      const unavailableCount = countUnavailableOutlineEntries(outlineEntries);
      outlineStatus =
        unavailableCount > 0
          ? `${count} outline ${count === 1 ? "item" : "items"}; ${unavailableCount} not navigable.`
          : `${count} outline ${count === 1 ? "item" : "items"}.`;
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
    };
  }

  async function normalizeOutlineEntry(
    document: PdfDocument & {
      getDestination: (id: string) => Promise<unknown[] | null>;
      getPageIndex: (ref: unknown) => Promise<number>;
    },
    item: PdfOutlineRaw,
    id: string,
  ): Promise<OutlineEntry> {
    const children = item.items ?? [];
    const dest = item.dest ?? null;
    const explicitDestination = await resolveOutlineDestination(document, dest);
    const pageNumber = await resolveOutlinePageNumberFromDestination(document, explicitDestination);
    return {
      id,
      title: item.title?.trim() || "Untitled",
      dest,
      url: item.url ?? null,
      pageNumber,
      targetY: typeof explicitDestination?.[3] === "number" ? explicitDestination[3] : null,
      destinationStatus: outlineDestinationStatus(dest, item.url ?? null, pageNumber),
      items: await Promise.all(
        children.map((child, index) => normalizeOutlineEntry(document, child, `${id}.${index + 1}`)),
      ),
    };
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

  function countOutlineEntries(entries: OutlineEntry[]): number {
    return entries.reduce((count, entry) => count + 1 + countOutlineEntries(entry.items), 0);
  }

  function countUnavailableOutlineEntries(entries: OutlineEntry[]): number {
    return entries.reduce(
      (count, entry) =>
        count +
        (isOutlineEntryNavigable(entry) ? 0 : 1) +
        countUnavailableOutlineEntries(entry.items),
      0,
    );
  }

  function outlineDestinationStatus(dest: PdfDestination, url: string | null, pageNumber: number | null) {
    if (url) return "External link";
    if (!dest) return "No destination";
    if (!pageNumber) return "Destination unavailable";
    return null;
  }

  function isOutlineEntryNavigable(entry: OutlineEntry) {
    return Boolean(entry.url || (entry.dest && entry.pageNumber));
  }

  async function createBookmarkForCurrentPage() {
    if (!pdfDocument || !pdfViewer) {
      status = "Open a PDF before creating bookmarks.";
      return;
    }
    const pageNumber = pdfViewer.currentPageNumber || 1;
    const pageTarget = await bookmarkPageTarget(pageNumber);
    await createBookmarkFromTarget(pageTarget);
  }

  async function handlePdfContainerClick(event: MouseEvent) {
    if ((event.target as Element | null)?.closest("button, input")) return;
    editingBookmarkId = null;
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit) return;
    await createBookmarkAtPageRailPoint(event.clientY, hit.pageNumber);
  }

  function handlePdfContainerMouseMove(event: MouseEvent) {
    if (bookmarkMarkerDmzHitAtPoint(event.clientX, event.clientY)) {
      bookmarkRailHoverCue = null;
      return;
    }
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit || !containerEl) {
      bookmarkRailHoverCue = null;
      return;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const pointerLeft = containerEl.scrollLeft + event.clientX - containerRect.left;
    const pointerTop = containerEl.scrollTop + event.clientY - containerRect.top;
    bookmarkRailHoverCue = {
      pageNumber: hit.pageNumber,
      focusLeft: hit.pageElement.offsetLeft,
      focusTop: pointerTop,
      hintLeft: pointerLeft + 22,
      hintTop: pointerTop + 22,
    };
  }

  function bookmarkMarkerDmzHitAtPoint(clientX: number, clientY: number) {
    return [...document.querySelectorAll<HTMLElement>(".bookmark-page-marker")].some((marker) => {
      const rect = marker.getBoundingClientRect();
      return (
        clientX >= rect.left - 28 &&
        clientX <= rect.right + 8 &&
        clientY >= rect.top - rect.height &&
        clientY <= rect.bottom + rect.height
      );
    });
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
    const pageTarget = await bookmarkPageTarget(pageNumber, offsetIntoPage);
    await createBookmarkFromTarget(pageTarget);
  }

  async function createBookmarkFromTarget(pageTarget: Awaited<ReturnType<typeof bookmarkPageTarget>>) {
    if (!pageTarget) {
      status = "Could not resolve current page for bookmark.";
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
    };
    bookmarkEntries = sortBookmarkEntries([...bookmarkEntries, entry]);
    bookmarkStatus = `${bookmarkEntries.length} bookmark${bookmarkEntries.length === 1 ? "" : "s"}.`;
    navigationTab = "bookmarks";
    editingBookmarkId = entry.id;
    isDirty = true;
    status = `Added bookmark ${title}.`;
  }

  function updateBookmarkTitle(id: string, title: string) {
    bookmarkEntries = bookmarkEntries.map((entry) =>
      entry.id === id ? { ...entry, title: title.trim() || `Page ${entry.pageNumber}` } : entry,
    );
    isDirty = true;
  }

  function sortBookmarkEntries(entries: BookmarkEntry[]) {
    return [...entries].sort((left, right) => {
      const pageOrder = left.pageNumber - right.pageNumber;
      if (pageOrder !== 0) return pageOrder;
      const pagePositionOrder = right.targetY - left.targetY;
      if (pagePositionOrder !== 0) return pagePositionOrder;
      return left.id.localeCompare(right.id);
    });
  }

  function handleBookmarkTitleKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      editingBookmarkId = null;
      event.preventDefault();
    }
    if (event.key === "Escape") {
      editingBookmarkId = null;
      event.preventDefault();
    }
  }

  function deleteBookmark(id: string) {
    const removed = bookmarkEntries.find((entry) => entry.id === id);
    bookmarkEntries = bookmarkEntries.filter((entry) => entry.id !== id);
    bookmarkStatus =
      bookmarkEntries.length === 0
        ? "No bookmarks yet."
        : `${bookmarkEntries.length} bookmark${bookmarkEntries.length === 1 ? "" : "s"}.`;
    if (editingBookmarkId === id) {
      editingBookmarkId = null;
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

  function firstWords(text: string, count: number) {
    return text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, count)
      .join(" ")
      .replace(/[,:;.!?]+$/, "");
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

  function flattenOutlineEntries(entries: OutlineEntry[]): OutlineEntry[] {
    return entries.flatMap((entry) => [entry, ...flattenOutlineEntries(entry.items)]);
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
    const scale = pageElement.offsetHeight > 0 ? pageElement.offsetHeight / pageHeight : 1;
    return clampPdfY(pageHeight - offsetIntoPage / scale, pageHeight);
  }

  function bookmarkAnchorInsetPdfPoints(pageNumber: number, pageHeight: number) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const scale = pageElement && pageElement.offsetHeight > 0 ? pageElement.offsetHeight / pageHeight : 1;
    return bookmarkRailAnchorHeightPx / scale;
  }

  function bookmarkDestinationY(pageNumber: number, targetY: number, pageHeight: number) {
    return clampPdfY(targetY + bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }

  function bookmarkAnchorYFromDestination(pageNumber: number, destinationY: number, pageHeight: number) {
    return clampPdfY(destinationY - bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }

  function clampPdfY(value: number, pageHeight: number) {
    return Math.max(0, Math.min(pageHeight, value));
  }

  function explicitDestinationRef(dest: PdfDestination) {
    return Array.isArray(dest) ? dest[0] : null;
  }

  function pdfRefString(ref: unknown) {
    if (typeof ref === "object" && ref !== null && "num" in ref) {
      const candidate = ref as { num: unknown; gen?: unknown };
      if (typeof candidate.num === "number") {
        return `${candidate.num} ${typeof candidate.gen === "number" ? candidate.gen : 0} R`;
      }
    }
    return null;
  }

  async function goToBookmarkEntry(entry: BookmarkEntry) {
    editingBookmarkId = null;
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
    const offsetIntoPage = ((entry.pageHeight - entry.targetY) / entry.pageHeight) * pageElement.offsetHeight;
    containerEl.scrollTop = Math.max(0, pageElement.offsetTop + offsetIntoPage - bookmarkRailAnchorHeightPx);
    return true;
  }

  function bookmarkMarkerStyle(entry: BookmarkEntry) {
    bookmarkRailLayoutVersion;
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
    if (!pageElement || entry.pageHeight <= 0) {
      return "left: 12px; top: 18px";
    }
    const offsetIntoPage = ((entry.pageHeight - entry.targetY) / entry.pageHeight) * pageElement.offsetHeight;
    const left = pageElement.offsetLeft;
    const top = pageElement.offsetTop + offsetIntoPage;
    return `left: ${left}px; top: ${top}px`;
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
    try {
      await pdfLinkService.goToDestination(entry.dest as string | unknown[]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (pdfViewer && entry.pageNumber && pdfViewer.currentPageNumber !== entry.pageNumber) {
        await scrollToPage(entry.pageNumber);
      }
      lastActivatedOutlineEntry = entry;
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
    return activateAnnotationEntry(first);
  }

  async function activateAnnotationBySourceId(sourceId: string) {
    await refreshAnnotationSidebar();
    const entry = annotationEntries.find((candidate) => candidate.sourceId === sourceId);
    if (!entry) return false;
    return activateAnnotationEntry(entry);
  }

  function groupAnnotationEntriesByPage(entries: AnnotationEntry[]): AnnotationPageGroup[] {
    const groups: AnnotationPageGroup[] = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      if (last?.page === entry.page) {
        last.entries.push(entry);
      } else {
        groups.push({ page: entry.page, entries: [entry] });
      }
    }
    return groups;
  }

  function itemCountLabel(count: number) {
    return `${count} item${count === 1 ? "" : "s"}`;
  }

  async function activateAnnotationEntry(entry: AnnotationEntry) {
    selectedAnnotationEntryId = entry.id;
    await scrollToPage(entry.page);
    if (entry.source === "live") {
      return activateLiveAnnotationEntry(entry);
    }
    return activatePdfAnnotationEntry(entry);
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

  async function activatePdfAnnotationEntry(entry: AnnotationEntry) {
    if (entry.kind === "ink" && focusPersistedAnnotationBounds(entry)) {
      return true;
    }
    annotationEditorUIManager?.unselectAll();
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
          setTool("none");
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      const element = annotationTargetElementForEntry(entry);
      if (element) {
        selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        await focusAnnotationElement(element);
        if (entry.kind === "ink") {
          return locatePdfAnnotationEntry(entry);
        }
        if (await activatePersistedEditorEntry(entry)) {
          return true;
        }
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + Math.min(Math.max(rect.width / 2, 4), Math.max(rect.width - 4, 4)));
        const y = Math.round(rect.top + Math.min(Math.max(rect.height / 2, 4), Math.max(rect.height - 4, 4)));
        const activated =
          entry.kind === "highlight"
            ? await activateHighlightEditorAtPoint(x, y)
            : entry.kind === "freetext"
              ? await activateFreeTextEditorAtPoint(x, y)
              : await activateInkEditorAtPoint(x, y);
        return activated;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (entry.kind === "ink" && focusPersistedAnnotationBounds(entry)) {
      return true;
    }
    status = `Could not find ${entry.label.toLowerCase()} on page ${entry.page}.`;
    return false;
  }

  function focusPersistedAnnotationBounds(entry: AnnotationEntry) {
    const pageElement = viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
    if (!pageElement || !entry.bounds) return false;
    if (activeTool !== "none") {
      setTool("none");
    }
    const left = pageElement.offsetLeft + entry.bounds.left * pageElement.offsetWidth - 3;
    const top = pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight - 3;
    const width = Math.max(6, (entry.bounds.right - entry.bounds.left) * pageElement.offsetWidth + 6);
    const height = Math.max(6, (entry.bounds.bottom - entry.bounds.top) * pageElement.offsetHeight + 6);
    containerEl.scrollLeft = Math.max(0, left + width / 2 - containerEl.clientWidth / 2);
    containerEl.scrollTop = Math.max(0, top + height / 2 - containerEl.clientHeight / 2);
    annotationFocusBox = { left, top, width, height };
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    return true;
  }

  function locatePdfAnnotationEntry(entry: AnnotationEntry) {
    if (activeTool !== "none") {
      setTool("none");
    }
    annotationEditorUIManager?.unselectAll();
    selectedAnnotationEntryId = entry.id;
    selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    selectedAnnotationKind = null;
    selectedAnnotationColor = null;
    hasSelectedHighlight = false;
    selectedHighlightColor = null;
    status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    return true;
  }

  async function activatePersistedEditorEntry(entry: AnnotationEntry) {
    const manager = annotationEditorUIManager;
    const tool = editorToolForAnnotationKind(entry.kind);
    if (!manager || !tool || !managerHasValidSignal(manager)) return false;
    if (activeTool !== tool) {
      setTool(tool);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    let editor = findEditorByPersistedSourceId(entry.sourceId, entry.kind, manager);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findEditorByPersistedSourceId(entry.sourceId, entry.kind, manager);
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
    await focusEditorById(editor.id);
    if (entry.kind === "highlight") {
      selectedAnnotationKind = "highlight";
      selectedAnnotationColor = editor.color ?? null;
      hasSelectedHighlight = true;
      selectedHighlightColor = highlightColorNameForValue(editor.color ?? null);
      selectedAnnotationEntryId = entry.id;
      status = "Selected highlight. Change color or delete it, then save.";
      return true;
    }
    selectEditorIgnoringPdfjsSignalBug(manager, editor);
    syncSelectedEditorState(persistedKey);
    selectedAnnotationEntryId = entry.id;
    if (entry.kind === "freetext") {
      status = "Selected free text. Press Enter to edit text, change color, or delete it.";
    } else {
      status = "Selected ink. Change color or delete it, then save.";
    }
    return true;
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

  function editorBelongsToManager(
    editor: AnnotationEditor | null | undefined,
    manager: AnnotationEditorUIManager,
  ) {
    return Boolean(editor && (editor as unknown as { _uiManager?: unknown })._uiManager === manager);
  }

  function managerHasValidSignal(manager: AnnotationEditorUIManager) {
    return isUsableAbortSignal((manager as unknown as { _signal?: unknown })._signal);
  }

  function editorHasValidManagerSignal(editor: AnnotationEditor) {
    const manager = (editor as unknown as { _uiManager?: { _signal?: unknown } })._uiManager;
    return isUsableAbortSignal(manager?._signal);
  }

  function isUsableAbortSignal(signal: unknown) {
    if (!(signal instanceof AbortSignal)) return false;
    const target = new EventTarget();
    try {
      target.addEventListener("pdfspike-signal-check", () => undefined, { signal });
      return true;
    } catch {
      return false;
    }
  }

  function selectEditorIgnoringPdfjsSignalBug(manager: AnnotationEditorUIManager, editor: AnnotationEditor) {
    try {
      manager.setSelected(editor);
    } catch (error) {
      const message = formatError(error);
      if (
        !message.includes("AbortSignal") &&
        !message.includes("addEventListener") &&
        !message.includes("signal")
      ) {
        throw error;
      }
    }
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

  function boundsOverlapRatio(left: RectLike, right: RectLike) {
    const intersectionWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const intersectionHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const intersectionArea = intersectionWidth * intersectionHeight;
    const smallerArea = Math.min(rectArea(left), rectArea(right));
    return smallerArea > 0 ? intersectionArea / smallerArea : 0;
  }

  function rectCenterDistance(left: RectLike, right: RectLike) {
    const leftX = (left.left + left.right) / 2;
    const leftY = (left.top + left.bottom) / 2;
    const rightX = (right.left + right.right) / 2;
    const rightY = (right.top + right.bottom) / 2;
    return Math.hypot(leftX - rightX, leftY - rightY);
  }

  async function focusAnnotationElement(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const left = rect.left - containerRect.left + containerEl.scrollLeft - 3;
    const top = rect.top - containerRect.top + containerEl.scrollTop - 3;
    const width = rect.width + 6;
    const height = rect.height + 6;

    containerEl.scrollLeft = Math.max(0, left + width / 2 - containerEl.clientWidth / 2);
    containerEl.scrollTop = Math.max(0, top + height / 2 - containerEl.clientHeight / 2);
    annotationFocusBox = { left, top, width, height };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  async function focusEditorById(editorId: string) {
    const element = document.getElementById(editorId);
    if (element instanceof HTMLElement) {
      await focusAnnotationElement(element);
    }
  }

  function setTool(tool: EditorTool) {
    if (!pdfViewer) return;
    const previousTool = activeTool;
    if (tool === "highlight" && annotationEditorUIManager) {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        highlightColors[defaultHighlightColor],
      );
    }
    activeTool = tool;
    pdfViewer.annotationEditorMode = { mode: editorModes[tool] };
    if (tool === "highlight" && annotationEditorUIManager && previousTool === "highlight") {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        highlightColors[defaultHighlightColor],
      );
    }
    if (tool === "text" && annotationEditorUIManager && previousTool === "text") {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
        freeTextColors[defaultFreeTextColor],
      );
    }
    if (tool === "ink" && annotationEditorUIManager) {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
        { color: inkColors[defaultInkColor], opacity: defaultInkOpacity },
      );
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
        defaultInkThickness,
      );
    }
    status =
      tool === "none"
        ? "Selection mode."
        : tool === "highlight"
          ? "Highlight mode. Drag across text to create a highlight, or click an existing highlight to edit it."
          : `${toolLabel(tool)} mode. Create an annotation, then save.`;
  }

  async function activateHighlightEditorAtPoint(clientX: number, clientY: number) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = selectedPersistedAnnotationKey;
    if (activeTool !== "highlight") {
      setTool("highlight");
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = document.elementFromPoint(clientX, clientY)?.closest(".highlightEditor");
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
        annotationEditorUIManager.unselectAll();
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

  async function activateExistingHighlightEditor(editorId: string) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    if (activeTool !== "highlight") {
      setTool("highlight");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    let editor = findHighlightEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findHighlightEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked highlight for editing.";
      return false;
    }
    await focusEditorById(editor.id);
    annotationEditorUIManager.setSelected(editor);
    selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  async function activateExistingFreeTextEditor(editorId: string) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Free text unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    if (activeTool !== "text") {
      setTool("text");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    let editor = findFreeTextEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findFreeTextEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked free text for editing.";
      return false;
    }
    await focusEditorById(editor.id);
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
    if (activeTool !== "text") {
      setTool("text");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = document.elementFromPoint(clientX, clientY)?.closest(".freeTextEditor");
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
        annotationEditorUIManager.unselectAll();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    status = "Could not activate clicked free text for editing.";
    return false;
  }

  async function activateExistingInkEditor(editorId: string) {
    if (!annotationEditorUIManager || !pdfViewer) {
      status = "Ink unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    if (activeTool !== "ink") {
      setTool("ink");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    let editor = findInkEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findInkEditorById(editorId);
    }
    if (!editor) {
      status = "Could not activate clicked ink for editing.";
      return false;
    }
    await focusEditorById(editor.id);
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
    if (activeTool !== "ink") {
      setTool("ink");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const editorElement = document.elementFromPoint(clientX, clientY)?.closest(".inkEditor");
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
        annotationEditorUIManager.unselectAll();
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

  function handlePdfPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element) || activeTool !== "none") {
      return;
    }
    const savedAnnotation = target.closest(".highlightAnnotation");
    const savedFreeTextAnnotation = target.closest(".freeTextAnnotation");
    const savedInkAnnotation = target.closest(".inkAnnotation");
    const disabledEditorId = findDisabledHighlightEditorIdAtPoint(event.clientX, event.clientY);
    const freeTextEditorId =
      target.closest<HTMLElement>(".freeTextEditor")?.id ?? findFreeTextEditorIdAtPoint(event.clientX, event.clientY);
    const inkEditorId =
      target.closest<HTMLElement>(".inkEditor")?.id ?? findInkEditorIdAtPoint(event.clientX, event.clientY);
    if (
      !disabledEditorId &&
      !savedAnnotation &&
      !savedFreeTextAnnotation &&
      !savedInkAnnotation &&
      !freeTextEditorId &&
      !inkEditorId
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (disabledEditorId) {
      void activateExistingHighlightEditor(disabledEditorId);
      return;
    }
    if (freeTextEditorId) {
      void activateExistingFreeTextEditor(freeTextEditorId);
      return;
    }
    if (inkEditorId) {
      void activateExistingInkEditor(inkEditorId);
      return;
    }
    if (savedFreeTextAnnotation) {
      rememberPersistedAnnotationElement(savedFreeTextAnnotation);
      void activateFreeTextEditorAtPoint(event.clientX, event.clientY);
      return;
    }
    if (savedInkAnnotation) {
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
    allowModeSwitchAutoCreate = true,
    createdStatus,
    methodOfCreation,
    resetModeToNone,
  }: {
    allowModeSwitchAutoCreate?: boolean;
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
      status = "Select text in the PDF first, then press Highlight Selection.";
      return false;
    }
    const before = countHighlightEditorsInManager();
    const previousHighlightEditorIds = new Set(highlightEditorIds());
    const switchedIntoHighlightMode = activeTool !== "highlight";
    const finishCreatedHighlight = () => {
      cacheNewHighlightDetails(previousHighlightEditorIds, selectionText);
      document.getSelection()?.removeAllRanges();
      if (resetModeToNone) {
        setTool("none");
        annotationEditorUIManager?.unselectAll();
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
      if (allowModeSwitchAutoCreate && countHighlightEditorsInManager() > before) {
        return finishCreatedHighlight();
      }
    }
    uiManager.unselectAll();
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
    for (const id of highlightEditorIds()) {
      if (!previousIds.has(id)) {
        annotationDetailCache.set(`live:${id}`, detail.trim());
      }
    }
  }

  function highlightSelection(event?: PointerEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    void createHighlightFromSelection({
      createdStatus: "Created text highlight. Save to persist it into the PDF.",
      methodOfCreation: "main_toolbar",
      resetModeToNone: true,
    });
  }

  async function createSelectionHighlightInToolMode() {
    return createHighlightFromSelection({
      createdStatus: `Created ${defaultHighlightColor} highlight. Save to persist it into the PDF.`,
      methodOfCreation: "main_toolbar",
      resetModeToNone: false,
    });
  }

  function syncSelectedEditorState(persistedKeyHint: string | null = null) {
    const firstSelectedEditor = annotationEditorUIManager?.firstSelectedEditor;
    const editor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (activeTool === "none") {
      const editorKey = persistedAnnotationKeyForEditor(editor);
      if (!editor || !selectedPersistedAnnotationKey || editorKey !== selectedPersistedAnnotationKey) {
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
    selectedAnnotationColor = editor.color ?? null;
    hasSelectedHighlight = isHighlightEditor(editor);
    selectedHighlightColor = hasSelectedHighlight ? highlightColorNameForValue(editor?.color ?? null) : null;
    selectedAnnotationEntryId = `live:${editor.id}`;
    selectedPersistedAnnotationKey = persistedAnnotationKeyForEditor(editor) ?? persistedKeyHint;
    if (selectedPersistedAnnotationKey) {
      persistedAnnotationKeyByEditorId.set(editor.id, selectedPersistedAnnotationKey);
    }
  }

  function isHighlightEditor(editor: AnnotationEditor | null | undefined): editor is AnnotationEditor {
    return editor?.editorType === editorModes.highlight || editor?.editorType === "highlight";
  }

  function isFreeTextEditor(editor: AnnotationEditor | null | undefined): editor is AnnotationEditor {
    return editor?.editorType === editorModes.text || editor?.editorType === "freetext";
  }

  function isInkEditor(editor: AnnotationEditor | null | undefined): editor is AnnotationEditor {
    return editor?.editorType === editorModes.ink || editor?.editorType === "ink";
  }

  function annotationKindForEditor(editor: AnnotationEditor): SelectedAnnotationKind {
    if (isHighlightEditor(editor)) return "highlight";
    if (isFreeTextEditor(editor)) return "freetext";
    if (isInkEditor(editor)) return "ink";
    return null;
  }

  function highlightColorNameForValue(color: string | null) {
    if (!color) return null;
    const normalized = color.toLowerCase();
    for (const [name, value] of Object.entries(highlightColors) as [HighlightColorName, string][]) {
      if (value === normalized) {
        return name;
      }
    }
    return null;
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
    if (activeTool !== "highlight") {
      syncSelectedEditorState();
      status = `Default highlight color set to ${colorName}.`;
      return;
    }
    annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      highlightColors[colorName],
    );
    if (hasSelectedHighlight) {
      selectedHighlightColor = colorName;
      isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      status = `Changed selected highlight to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    status = `Next highlight will use ${colorName}.`;
  }

  function freeTextColorNameForValue(color: string | null) {
    if (!color) return null;
    const normalized = color.toLowerCase();
    for (const [name, value] of Object.entries(freeTextColors) as [FreeTextColorName, string][]) {
      if (value === normalized) {
        return name;
      }
    }
    return null;
  }

  function applyFreeTextColor(colorName: FreeTextColorName) {
    if (!annotationEditorUIManager) {
      status = "Free text color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultFreeTextColor = colorName;
    if (activeTool !== "text") {
      syncSelectedEditorState();
      status = `Default free-text color set to ${colorName}.`;
      return;
    }
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
    status = `Next free text will use ${colorName}.`;
  }

  function inkColorNameForValue(color: string | null) {
    if (!color) return null;
    const normalized = color.toLowerCase();
    for (const [name, value] of Object.entries(inkColors) as [InkColorName, string][]) {
      if (value === normalized) {
        return name;
      }
    }
    return null;
  }

  function applyInkColor(colorName: InkColorName) {
    if (!annotationEditorUIManager) {
      status = "Ink color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkColor = colorName;
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = `Default ink color set to ${colorName}.`;
      return;
    }
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
    status = `Next ink will use ${colorName}.`;
  }

  function applyInkThickness(thickness: number) {
    if (!annotationEditorUIManager) {
      status = "Ink thickness unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkThickness = thickness;
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = `Default ink thickness set to ${thickness}.`;
      return;
    }
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
    if (activeTool !== "ink") {
      syncSelectedEditorState();
      status = "Marker preset selected.";
      return;
    }
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
    status = "Marker preset selected.";
  }

  function deleteSelectedAnnotation() {
    const manager = annotationEditorUIManager;
    const firstSelectedEditor = manager?.firstSelectedEditor;
    const selectedEditor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (!manager || !selectedEditor) {
      const persistedSelection = selectedPersistedAnnotationKey
        ? persistedAnnotationKeyParts(selectedPersistedAnnotationKey)
        : null;
      const expectedEditor =
        persistedSelection && selectedAnnotationKind
          ? findEditorByPersistedSourceId(persistedSelection.sourceId, selectedAnnotationKind, manager)
          : null;
      if (expectedEditor?.remove && selectedPersistedAnnotationKey) {
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
      focusScope,
      pdfMode,
      pdfCursor,
      pdfVisualSelectionText,
      pdfVisualSelectionRects,
      pdfScrollTop: containerEl?.scrollTop ?? 0,
      pdfViewportHeight: containerEl?.clientHeight ?? 0,
      pdfCursorViewportTop: pdfCursorViewportTop(),
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
      selectedText: pdfVisualSelectionText || document.getSelection()?.toString() || "",
      canvases: document.querySelectorAll(".page canvas").length,
      textLayerSpans: document.querySelectorAll(".textLayer span").length,
      annotationEditorLayers: document.querySelectorAll(".annotationEditorLayer").length,
      highlightEditors: document.querySelectorAll(".highlightEditor").length,
      liveHighlightEditors: countHighlightEditorsInManager(),
      freeTextEditors: document.querySelectorAll(".freeTextEditor").length,
      inkEditors: document.querySelectorAll(".inkEditor").length,
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
    return appendBookmarkOutline(saved, bookmarkEntries);
  }

  function appendBookmarkOutline(bytes: Uint8Array, bookmarks: BookmarkEntry[]) {
    const baseBytes = removeBookmarkOutline(bytes);
    if (bookmarks.length === 0) return baseBytes;

    const bytesWithBookmarksRemoved = baseBytes;
    const text = new TextDecoder("latin1").decode(bytesWithBookmarksRemoved);
    const startxrefMatch = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/g)].at(-1);
    const trailerMatch = [...text.matchAll(/trailer\s*<<(.*?)>>\s*startxref/gs)].at(-1);
    if (!startxrefMatch || !trailerMatch) {
      throw new Error("Could not find PDF trailer for bookmark outline update");
    }

    const trailer = trailerMatch[1];
    const size = Number(trailer.match(/\/Size\s+(\d+)/)?.[1]);
    const rootObject = Number(trailer.match(/\/Root\s+(\d+)\s+\d+\s+R/)?.[1]);
    const previousXref = Number(startxrefMatch[1]);
    if (!size || !rootObject || Number.isNaN(previousXref)) {
      throw new Error("Could not read PDF trailer references for bookmark outline update");
    }

    const catalog = readObjectBody(text, rootObject);
    const outlinesObject = Number(catalog.match(/\/Outlines\s+(\d+)\s+\d+\s+R/)?.[1]);
    if (!outlinesObject) {
      throw new Error("PDF has no outline tree for bookmark insertion");
    }

    const outlineRoot = readObjectBody(text, outlinesObject);
    const oldFirstObject = Number(outlineRoot.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
    const oldLastObject = Number(outlineRoot.match(/\/Last\s+(\d+)\s+\d+\s+R/)?.[1]);
    const oldCount = Number(outlineRoot.match(/\/Count\s+(-?\d+)/)?.[1] ?? 0);
    if (!oldFirstObject || !oldLastObject) {
      throw new Error("PDF outline tree has no top-level entries");
    }

    const bookmarkRootObject = size;
    const firstBookmarkObject = size + 1;
    const nextSize = size + 1 + bookmarks.length * 2;
    const objectWrites: { objectNumber: number; body: string }[] = [];

    const childObjects = bookmarks.map((bookmark, index) => {
      const itemObject = firstBookmarkObject + index * 2;
      const destObject = itemObject + 1;
      const previousObject = index === 0 ? null : firstBookmarkObject + (index - 1) * 2;
      const nextObject = index === bookmarks.length - 1 ? null : firstBookmarkObject + (index + 1) * 2;
      objectWrites.push({
        objectNumber: destObject,
        body: `[ ${bookmark.pageRef} /XYZ 0 ${formatPdfNumber(bookmark.destinationY)} 0 ]`,
      });
      objectWrites.push({
        objectNumber: itemObject,
        body: [
          "<<",
          `/Title ${pdfString(bookmark.title)}`,
          `/Dest ${destObject} 0 R`,
          `/Parent ${bookmarkRootObject} 0 R`,
          previousObject ? `/Prev ${previousObject} 0 R` : "",
          nextObject ? `/Next ${nextObject} 0 R` : "",
          ">>",
        ]
          .filter(Boolean)
          .join(" "),
      });
      return itemObject;
    });

    objectWrites.push({
      objectNumber: bookmarkRootObject,
      body: [
        "<<",
        `/Title ${pdfString(bookmarkRootTitle)}`,
        `/Parent ${outlinesObject} 0 R`,
        `/First ${childObjects[0]} 0 R`,
        `/Last ${childObjects.at(-1)} 0 R`,
        `/Count ${bookmarks.length}`,
        `/Next ${oldFirstObject} 0 R`,
        ">>",
      ].join(" "),
    });
    objectWrites.push({
      objectNumber: outlinesObject,
      body: rewritePdfDictionary(outlineRoot, {
        First: `${bookmarkRootObject} 0 R`,
        Count: String(oldCount + 1),
      }),
    });
    objectWrites.push({
      objectNumber: oldFirstObject,
      body: rewritePdfDictionary(readObjectBody(text, oldFirstObject), {
        Prev: `${bookmarkRootObject} 0 R`,
      }),
    });

    return appendIncrementalPdfUpdate(bytesWithBookmarksRemoved, objectWrites, nextSize, rootObject, previousXref);
  }

  function removeBookmarkOutline(bytes: Uint8Array) {
    const text = new TextDecoder("latin1").decode(bytes);
    const startxrefMatch = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/g)].at(-1);
    const trailerMatch = [...text.matchAll(/trailer\s*<<(.*?)>>\s*startxref/gs)].at(-1);
    if (!startxrefMatch || !trailerMatch) return bytes;

    const trailer = trailerMatch[1];
    const size = Number(trailer.match(/\/Size\s+(\d+)/)?.[1]);
    const rootObject = Number(trailer.match(/\/Root\s+(\d+)\s+\d+\s+R/)?.[1]);
    const previousXref = Number(startxrefMatch[1]);
    if (!size || !rootObject || Number.isNaN(previousXref)) return bytes;

    const catalog = readObjectBody(text, rootObject);
    const outlinesObject = Number(catalog.match(/\/Outlines\s+(\d+)\s+\d+\s+R/)?.[1]);
    if (!outlinesObject) return bytes;

    const bookmarkRootObject = findBookmarkRootObject(text, outlinesObject);
    if (!bookmarkRootObject) return bytes;

    const outlineRoot = readObjectBody(text, outlinesObject);
    const bookmarkRoot = readObjectBody(text, bookmarkRootObject);
    const oldFirstObject = Number(outlineRoot.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
    const oldLastObject = Number(outlineRoot.match(/\/Last\s+(\d+)\s+\d+\s+R/)?.[1]);
    const oldCount = Number(outlineRoot.match(/\/Count\s+(-?\d+)/)?.[1] ?? 0);
    const previousObject = Number(bookmarkRoot.match(/\/Prev\s+(\d+)\s+\d+\s+R/)?.[1]);
    const nextObject = Number(bookmarkRoot.match(/\/Next\s+(\d+)\s+\d+\s+R/)?.[1]);
    const objectWrites: { objectNumber: number; body: string }[] = [];

    const outlineReplacements: Record<string, string> = {
      Count: String(Math.max(0, oldCount - 1)),
    };
    if (oldFirstObject === bookmarkRootObject && nextObject) {
      outlineReplacements.First = `${nextObject} 0 R`;
    }
    if (oldLastObject === bookmarkRootObject && previousObject) {
      outlineReplacements.Last = `${previousObject} 0 R`;
    }
    objectWrites.push({
      objectNumber: outlinesObject,
      body: rewritePdfDictionary(outlineRoot, outlineReplacements),
    });

    if (previousObject) {
      const previousBody = readObjectBody(text, previousObject);
      objectWrites.push({
        objectNumber: previousObject,
        body: nextObject
          ? rewritePdfDictionary(previousBody, { Next: `${nextObject} 0 R` })
          : removePdfDictionaryKeys(previousBody, ["Next"]),
      });
    }
    if (nextObject) {
      const nextBody = readObjectBody(text, nextObject);
      objectWrites.push({
        objectNumber: nextObject,
        body: previousObject
          ? rewritePdfDictionary(nextBody, { Prev: `${previousObject} 0 R` })
          : removePdfDictionaryKeys(nextBody, ["Prev"]),
      });
    }

    return appendIncrementalPdfUpdate(bytes, objectWrites, size, rootObject, previousXref);
  }

  function findBookmarkRootObject(pdfText: string, outlinesObject: number) {
    const objectPattern = /(?:^|\n)(\d+)\s+0\s+obj\s*([\s\S]*?)\s*endobj/g;
    let match: RegExpExecArray | null;
    let found: number | null = null;
    while ((match = objectPattern.exec(pdfText))) {
      const body = match[2];
      if (
        body.includes(`/Title (${bookmarkRootTitle})`) &&
        body.includes(`/Parent ${outlinesObject} 0 R`)
      ) {
        found = Number(match[1]);
      }
    }
    return found;
  }

  function readObjectBody(pdfText: string, objectNumber: number) {
    const matches = [...pdfText.matchAll(new RegExp(`(?:^|\\n)${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`, "g"))];
    const match = matches.at(-1);
    if (!match) throw new Error(`Could not find PDF object ${objectNumber}`);
    return match[1].trim();
  }

  function rewritePdfDictionary(body: string, replacements: Record<string, string>) {
    let rewritten = body.trim();
    for (const [key, value] of Object.entries(replacements)) {
      const keyPattern = new RegExp(`/${key}\\s+(?:-?\\d+|\\[[^\\]]*\\]|\\([^)]*\\)|<<[\\s\\S]*?>>|/\\w+)(?:\\s+\\d+\\s+R)?`);
      if (keyPattern.test(rewritten)) {
        rewritten = rewritten.replace(keyPattern, `/${key} ${value}`);
      } else {
        rewritten = rewritten.replace(/>>\s*$/, `/${key} ${value} >>`);
      }
    }
    return rewritten;
  }

  function removePdfDictionaryKeys(body: string, keys: string[]) {
    let rewritten = body.trim();
    for (const key of keys) {
      const keyPattern = new RegExp(`\\s*/${key}\\s+(?:-?\\d+|\\[[^\\]]*\\]|\\([^)]*\\)|<<[\\s\\S]*?>>|/\\w+)(?:\\s+\\d+\\s+R)?`);
      rewritten = rewritten.replace(keyPattern, "");
    }
    return rewritten;
  }

  function appendIncrementalPdfUpdate(
    bytes: Uint8Array,
    objectWrites: { objectNumber: number; body: string }[],
    size: number,
    rootObject: number,
    previousXref: number,
  ) {
    let update = "\n";
    const offsets = new Map<number, number>();
    for (const objectWrite of objectWrites.sort((left, right) => left.objectNumber - right.objectNumber)) {
      offsets.set(objectWrite.objectNumber, bytes.length + update.length);
      update += `${objectWrite.objectNumber} 0 obj\n${objectWrite.body}\nendobj\n`;
    }
    const xrefOffset = bytes.length + update.length;
    update += "xref\n";
    for (const objectNumber of [...offsets.keys()].sort((left, right) => left - right)) {
      update += `${objectNumber} 1\n${String(offsets.get(objectNumber)).padStart(10, "0")} 00000 n \n`;
    }
    update += `trailer\n<< /Size ${size} /Root ${rootObject} 0 R /Prev ${previousXref} >>\n`;
    update += `startxref\n${xrefOffset}\n%%EOF\n`;

    const encodedUpdate = new TextEncoder().encode(update);
    const output = new Uint8Array(bytes.length + encodedUpdate.length);
    output.set(bytes);
    output.set(encodedUpdate, bytes.length);
    return output;
  }

  function pdfString(value: string) {
    return `(${value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
  }

  function formatPdfNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
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
      setTool("text");
      await new Promise((resolve) => setTimeout(resolve, 150));
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
    isDirty = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
    syncSelectedEditorState();
    await refreshAnnotationSidebar();
    queueEditorStateRefresh(500);
    status = "Edited selected free text. Save to persist it into the PDF.";
    return true;
  }

  function teardownViewer() {
    annotationEditorUIManager?.unselectAll();
    pdfViewer?.setDocument(null as never);
    (pdfDocument as { destroy?: () => void } | null)?.destroy?.();
    pdfViewer = null;
    pdfLinkService = null;
    pdfDocument = null;
    annotationEditorUIManager = null;
    outlineEntries = [];
    outlineStatus = "Open a PDF to inspect its outline.";
    bookmarkEntries = [];
    bookmarkStatus = "Open a PDF to inspect bookmarks.";
    editingBookmarkId = null;
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

  function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
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
      <button
        onpointerdown={highlightSelection}
        disabled={!pdfDocument}
      >
        Highlight Selection
      </button>
      <div class="segmented">
        {#each (["none", "highlight", "text", "ink"] as EditorTool[]) as tool}
          <button
            class:active={activeTool === tool}
            onclick={() => setTool(tool)}
            disabled={!pdfDocument}
          >
            {toolLabel(tool)}
          </button>
        {/each}
      </div>
    </div>

    <div class="group">
      <span class="label">Highlight color</span>
      <div class="swatches">
        {#each (Object.keys(highlightColors) as HighlightColorName[]) as colorName}
          <button
            class:swatch-active={(hasSelectedHighlight ? selectedHighlightColor : defaultHighlightColor) === colorName}
            class="swatch"
            onclick={() => applyHighlightColor(colorName)}
            disabled={!pdfDocument}
            aria-label={`Set highlight color to ${colorName}`}
            title={`Set highlight color to ${colorName}`}
            style={`--swatch-color: ${highlightColors[colorName]}`}
          ></button>
        {/each}
      </div>
      <span class="label">Free-text color</span>
      <div class="swatches">
        {#each (Object.keys(freeTextColors) as FreeTextColorName[]) as colorName}
          <button
            class:swatch-active={activeTool === "text" && (freeTextColorNameForValue(selectedAnnotationColor) ?? defaultFreeTextColor) === colorName}
            class="swatch"
            onclick={() => applyFreeTextColor(colorName)}
            disabled={!pdfDocument}
            aria-label={`Set free-text color to ${colorName}`}
            title={`Set free-text color to ${colorName}`}
            style={`--swatch-color: ${freeTextColors[colorName]}`}
          ></button>
        {/each}
      </div>
      <span class="label">Ink color</span>
      <div class="swatches">
        {#each (Object.keys(inkColors) as InkColorName[]) as colorName}
          <button
            class:swatch-active={activeTool === "ink" && (inkColorNameForValue(selectedAnnotationColor) ?? defaultInkColor) === colorName}
            class="swatch"
            onclick={() => applyInkColor(colorName)}
            disabled={!pdfDocument}
            aria-label={`Set ink color to ${colorName}`}
            title={`Set ink color to ${colorName}`}
            style={`--swatch-color: ${inkColors[colorName]}`}
          ></button>
        {/each}
      </div>
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
          <span>{outlineStatus}</span>
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
          <button class="icon-action" onclick={() => void createBookmarkForCurrentPage()} disabled={!pdfDocument} aria-label="Add bookmark">
            +
          </button>
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
                      role="group"
                      aria-label={`Editing bookmark ${entry.title}`}
                      onmouseenter={() => (hoveredBookmarkId = entry.id)}
                      onmouseleave={() => (hoveredBookmarkId = null)}
                    >
                      <span class="bookmark-icon" aria-hidden="true"></span>
                      <input
                        aria-label="Bookmark title"
                        value={entry.title}
                        oninput={(event) => updateBookmarkTitle(entry.id, event.currentTarget.value)}
                        onkeydown={handleBookmarkTitleKey}
                        onblur={() => (editingBookmarkId = null)}
                      />
                    </div>
                  {:else}
                    <button
                      class="bookmark-item"
                      class:bookmark-hovered={hoveredBookmarkId === entry.id}
                      onclick={() => void goToBookmarkEntry(entry)}
                      onmouseenter={() => (hoveredBookmarkId = entry.id)}
                      onmouseleave={() => (hoveredBookmarkId = null)}
                      title={`${entry.title} on page ${entry.pageNumber}`}
                    >
                      <span class="bookmark-icon" aria-hidden="true"></span>
                      <span>{entry.title}</span>
                    </button>
                  {/if}
                  <button
                    class="bookmark-delete"
                    onclick={() => deleteBookmark(entry.id)}
                    aria-label={`Delete bookmark ${entry.title}`}
                    title={`Delete bookmark ${entry.title}`}
                  >
                    x
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
      <div class="nav-content" role="tabpanel" aria-label="Annotations">
        <div class="nav-heading">
          <span class="label">Annotations</span>
          <span>{annotationStatus}</span>
        </div>
        {#if annotationEntries.length > 0}
          <div class="annotation-list">
            {#each groupAnnotationEntriesByPage(annotationEntries) as group (group.page)}
              <section class="annotation-page-group" aria-label={`Page ${group.page} annotations`}>
                <div class="annotation-page-header">
                  <span>Page {group.page}</span>
                  <span>{itemCountLabel(group.entries.length)}</span>
                </div>
                <ul>
                  {#each group.entries as entry (entry.id)}
                    <li>
                      <button
                        id={`annotation-row-${entry.sourceId}`}
                        class="annotation-item"
                        class:active={selectedAnnotationEntryId === entry.id}
                        data-entry-id={entry.id}
                        data-source-id={entry.sourceId}
                        onclick={() => void activateAnnotationEntry(entry)}
                        title={`${entry.label} on page ${entry.page}`}
                      >
                        <span class="annotation-kind">{entry.label}</span>
                        <span class="annotation-detail">{entry.detail}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
        {:else}
          <p class="empty-state">{annotationStatus}</p>
        {/if}
      </div>
    {/if}
  </aside>

  <section class="viewer-shell">
    <div class="viewer-toolbar">
      <span>{currentPath || "No PDF loaded"}</span>
    </div>
    <div
      class="pdf-container"
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
      {#if focusScope === "pdf" && pdfMode === "visualText"}
        {#each pdfVisualSelectionRects as rect}
          <div class="pdf-visual-selection" style={pdfVisualSelectionStyle(rect)} aria-hidden="true"></div>
        {/each}
      {/if}
      {#if focusScope === "pdf" && pdfCursor}
        <div class="pdf-text-caret" style={pdfCursorStyle(pdfCursor)} aria-hidden="true"></div>
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
    <li>
      <button
        class="outline-item"
        style={`padding-left: ${12 + depth * 16}px`}
        onclick={() => void goToOutlineEntry(entry)}
        disabled={!isOutlineEntryNavigable(entry)}
        title={entry.destinationStatus ? `${entry.title} - ${entry.destinationStatus}` : entry.title}
      >
        <span>{entry.title}</span>
        {#if entry.pageNumber}
          <span class="page-number">Page {entry.pageNumber}</span>
        {:else if entry.destinationStatus}
          <span class="page-number">{entry.destinationStatus}</span>
        {/if}
      </button>
      {#if entry.items.length > 0}
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

  :global(body > div) {
    height: 100%;
  }

  :global(.popupAnnotation),
  :global(.popup) {
    display: none !important;
  }

  :global(.annotationEditorLayer.inkEditing) {
    cursor: var(--pdf-spike-ink-cursor) !important;
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
    padding: 12px 12px 8px;
    color: #5b6470;
    font-size: 12px;
  }

  .nav-heading span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-action {
    display: grid;
    width: 24px;
    min-height: 24px;
    place-items: center;
    border: 1px solid #cfd6df;
    border-radius: 4px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
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
  .bookmark-list,
  .annotation-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .annotation-list {
    display: flex;
    flex-direction: column;
  }

  .annotation-page-group + .annotation-page-group {
    border-top: 1px solid #d8dde5;
  }

  .annotation-page-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px 8px;
    color: #2f3742;
    background: #f3f5f8;
    border-bottom: 1px solid #d8dde5;
    font-size: 12px;
  }

  .annotation-page-header span:last-child {
    color: #8a929c;
  }

  .outline-item,
  .bookmark-item,
  .annotation-item {
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

  .bookmark-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 32px;
    align-items: stretch;
  }

  .bookmark-delete {
    min-height: 34px;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: #8a929c;
    background: transparent;
  }

  .bookmark-delete:hover:not(:disabled) {
    color: #b3261e;
    background: #fff0ee;
  }

  .outline-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .outline-item span:first-child,
  .bookmark-item span:last-child,
  .annotation-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .outline-item:hover:not(:disabled),
  .bookmark-item:hover:not(:disabled),
  .bookmark-item.bookmark-hovered,
  .annotation-item:hover:not(:disabled) {
    background: #edf4ff;
  }

  .bookmark-icon,
  .bookmark-page-marker {
    background: #f04444;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
  }

  .bookmark-icon {
    width: 10px;
    height: 16px;
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

  .annotation-item {
    grid-template-rows: auto auto;
    padding: 10px 12px;
  }

  .annotation-item.active {
    color: #1e2329;
    background: #e5f0ff;
  }

  .annotation-kind {
    font-weight: 700;
  }

  .annotation-detail {
    color: #7a838f;
    font-size: 12px;
  }

  .annotation-detail {
    grid-column: 1 / -1;
  }

  .page-number {
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
    border: 1px dashed #2387d8;
    pointer-events: none;
  }

  .pdf-text-caret {
    position: absolute;
    z-index: 22;
    width: 3px;
    min-height: 18px;
    border-radius: 2px;
    background: #1f6feb;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
    pointer-events: none;
  }

  .pdf-visual-selection {
    position: absolute;
    z-index: 20;
    border-radius: 2px;
    background: rgba(31, 111, 235, 0.3);
    pointer-events: none;
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
