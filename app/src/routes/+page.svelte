<script lang="ts">
  // ---- Official-app shell imports (dock, tokens, native menu) ----
  import "../lib/ui/tokens.css";
  import TabStrip from "../lib/ui/TabStrip.svelte";
  import Toolbar from "../lib/ui/Toolbar.svelte";
  import ColorPlate from "../lib/ui/ColorPlate.svelte";
  import ToolPopover from "../lib/ui/ToolPopover.svelte";
  import {
    activateTab,
    createDefaultDockState,
    hideSide,
    isSideOpen,
    moveTabToSide,
    shouldShowEdgeReopen,
    showSide,
    sideHasTabs,
    type SidebarSide,
    type SidebarTabId,
  } from "../lib/ui/dock-state";
  import {
    parseSidebarWidths,
    resizedSidebarWidth,
    serializeSidebarWidths,
    type SidebarWidths,
  } from "../lib/ui/sidebar-resize";
  import { tabMeta } from "../lib/ui/tab-meta";
  import { installAppMenu, type AppMenuControls } from "../lib/tauri/menu";
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount, tick } from "svelte";
  import AnnotationsSidebar from "$lib/pdf/AnnotationsSidebar.svelte";
  import BookmarksSidebar from "$lib/pdf/BookmarksSidebar.svelte";
  import OutlineSidebar from "$lib/pdf/OutlineSidebar.svelte";
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
    normalizeFreeTextEditorLines,
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
    annotationPaletteEntry,
    defaultBookmarkColor,
    defaultHeaderColorNames,
    freeTextColorNameForValue,
    freeTextColors,
    highlightColorNameForValue,
    highlightColors,
    inkColorNameForValue,
    inkColors,
    normalizeOutlineColor,
    type AnnotationColorName,
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
  import { createSpikeDebugHarness } from "$lib/debug/spike-harness";
  import { DocumentSession } from "$lib/tabs/document-session.svelte";
  import {
    addTab as addDocTab,
    removeTab as removeDocTab,
    activateTab as activateDocTab,
    moveTab as moveDocTab,
    nextTabId,
    previousTabId,
    findByPath,
    createEmptyTabsState,
    type DocumentTabId,
  } from "$lib/tabs/tab-state";

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

  const nullSession = new DocumentSession();
  const sessions = new Map<DocumentTabId, DocumentSession>();
  let tabsState = $state(createEmptyTabsState());

  // Start with one empty tab (preserves existing single-doc behavior).
  {
    const initialId = crypto.randomUUID();
    sessions.set(initialId, new DocumentSession());
    tabsState = {
      order: [initialId],
      activeId: initialId,
      tabs: { [initialId]: { id: initialId, path: null, label: "New Document" } },
    };
  }

  const activeSession = $derived(
    tabsState.activeId ? (sessions.get(tabsState.activeId) ?? nullSession) : nullSession,
  );
  let navigationTab = $state<NavigationTab>("outline");
  let defaultHighlightColor = $state<HighlightColorName>("yellow");
  let defaultFreeTextColor = $state<FreeTextColorName>("yellow");
  let defaultInkColor = $state<InkColorName>("red");
  let defaultInkThickness = $state(3);
  let defaultInkOpacity = $state(1);

  const debugHarness = createSpikeDebugHarness({
    getPdfDocument: () => activeSession.pdfDocument,
    getPdfViewer: () => activeSession.pdfViewer,
    getAnnotationEditorUIManager: () => activeSession.annotationEditorUIManager,
    getContainerEl: () => activeSession.containerEl,
    getDomDocument: () => document,
    getWindow: () => window,
    getStatsSnapshot: () => ({
      status: activeSession.status,
      outlineStatus: activeSession.outlineStatus,
      activeTool: activeSession.activeTool,
      defaultHighlightColor,
      defaultFreeTextColor,
      defaultInkColor,
      defaultInkThickness,
      defaultInkOpacity,
      defaultFreeTextFontSize,
      selectedAnnotationKind: activeSession.selectedAnnotationKind,
      selectedPersistedAnnotationKey: activeSession.selectedPersistedAnnotationKey,
      pendingDeletedPersistedAnnotationKeys: [...activeSession.pendingDeletedPersistedAnnotationKeys],
      selectedAnnotationColor: activeSession.selectedAnnotationColor,
      hasSelectedHighlight: activeSession.hasSelectedHighlight,
      selectedHighlightColor: activeSession.selectedHighlightColor,
      annotationFocusBox: activeSession.annotationFocusBox,
    }),
    persistPdf,
    loadPdf,
    loadPdfBytes,
    savePdfDocumentBytes,
    refreshAnnotationSidebar,
    setCurrentPath: (path) => (activeSession.currentPath = path),
    setDirty: (dirty) => (activeSession.isDirty = dirty),
    setBusy: (busy) => (activeSession.isBusy = busy),
    setActiveTool: (tool) => (activeSession.activeTool = tool),
    setStatus: (nextStatus) => (activeSession.status = nextStatus),
  });

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
      activeSession.rememberedSelectionText = selectionText;
      activeSession.rememberedSelectionRanges = Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      );
    };
    document.addEventListener("selectionchange", rememberSelection);
    document.addEventListener("pointerdown", handleDocumentPointerDown, { capture: true });
    document.addEventListener("keydown", handleAnnotationEscapeKey, { capture: true });
    document.addEventListener("keydown", handleAnnotationDeleteKey, { capture: true });
    document.addEventListener("keydown", handleFreeTextEditorKeydown, { capture: true });
    activeSession.containerEl?.addEventListener("pointerdown", handleHighlightTextLayerPointerDown, { capture: true });
    activeSession.containerEl?.addEventListener("pointerdown", handlePdfPointerDown, { capture: true });
    activeSession.containerEl?.addEventListener("dblclick", handlePdfDoubleClick, { capture: true });
    let activeOutlineFrame = 0;
    const handlePdfScroll = () => {
      if (activeOutlineFrame) return;
      activeOutlineFrame = requestAnimationFrame(() => {
        activeOutlineFrame = 0;
        refreshActiveOutlineFromScroll();
      });
    };
    const handleRailClick = (event: MouseEvent) => void handlePdfContainerClick(event);
    const clearRailHoverCue = () => (activeSession.bookmarkRailHoverCue = null);
    activeSession.containerEl?.addEventListener("click", handleRailClick);
    activeSession.containerEl?.addEventListener("scroll", handlePdfScroll);
    activeSession.containerEl?.addEventListener("mousemove", handlePdfContainerMouseMove);
    activeSession.containerEl?.addEventListener("mouseleave", clearRailHoverCue);
    const teardownSpikeDebugApi = installSpikeDebugApi(window, {
      annotationSummary: debugHarness.annotationSummary,
      annotationSidebarSummary: () => activeSession.annotationEntries,
      bookmarkSummary: () => activeSession.bookmarkEntries,
      outlineSummary: () => activeSession.outlineEntries,
      activateFirstOutlineItem,
      activateFirstAnnotationItem,
      activateAnnotationBySourceId,
      createBookmarkForCurrentPage,
      createPageFreeText,
      createSelectionHighlightInToolMode,
      editorSummary: debugHarness.editorSummary,
      loadSample: loadSamplePdf,
      loadPath: debugHarness.loadPath,
      loadUrl: debugHarness.loadUrl,
      saveToPath: debugHarness.saveToPath,
      selectFirstHighlight: () => selectFirstHighlight(),
      selectFirstText,
      recolorSelectedHighlight: applyHighlightColor,
      recolorSelectedFreeText: applyFreeTextColor,
      recolorSelectedInk: applyInkColor,
      setInkThickness: applyInkThickness,
      setFreeTextFontSize: applyFreeTextFontSize,
      setInkMarkerPreset: applyInkMarkerPreset,
      moveSelected: moveSelectedAnnotation,
      editSelectedFreeText,
      deleteSelected: deleteSelectedAnnotation,
      debugSavedBytes: debugHarness.debugSavedBytes,
      stats: debugHarness.stats,
      setTool,
      tabs: {
        list: () =>
          tabsState.order.map((id) => ({
            id,
            label: tabsState.tabs[id]?.label ?? "?",
            path: tabsState.tabs[id]?.path ?? null,
            dirty: sessions.get(id)?.isDirty ?? false,
            active: id === tabsState.activeId,
          })),
        open: async (path: string) => {
          await openPathAsTab(path);
          const id = findByPath(tabsState, path);
          if (!id) throw new Error(`Failed to open tab for ${path}`);
          return id;
        },
        openBytes: async (bytes: Uint8Array, label: string) => {
          const id = crypto.randomUUID();
          const session = new DocumentSession();
          sessions.set(id, session);
          tabsState = addDocTab(tabsState, { path: null, label });
          tabsState = activateDocTab(tabsState, id);
          await syncActiveTabUI();
          session.isBusy = true;
          session.status = `Loading ${label}...`;
          try {
            await loadPdfBytesInto(session, bytes, label);
            session.isDirty = false;
            session.activeTool = "none";
            session.status = `Loaded ${label}`;
          } catch (error) {
            session.status = `Load failed: ${formatError(error)}`;
          } finally {
            session.isBusy = false;
          }
          return id;
        },
        activate: async (id: string) => {
          await switchToTab(id);
        },
        close: async (id: string, opts?: { force?: boolean }) => {
          // Phase B: force-only, no modal (D3/D9 land in Phase D).
          if (!opts?.force) return "prompted" as const;
          const session = sessions.get(id);
          if (session) {
            teardownSessionViewer(session);
            sessions.delete(id);
          }
          tabsState = removeDocTab(tabsState, id);
          await syncActiveTabUI();
          // Wake rendering on the new active tab.
          if (tabsState.activeId) {
            const active = sessions.get(tabsState.activeId);
            if (active?.pdfViewer) {
              active.pdfViewer.update();
              active.pdfViewer.forceRendering(undefined);
            }
          }
          return "closed" as const;
        },
        reorder: (from: number, to: number) => {
          tabsState = moveDocTab(tabsState, from, to);
        },
      },
    });
    // Official-app additions: collapsible/dockable sidebars resize the viewer
    // container mid-session (the spike never did), so the viewer and the
    // bookmark-rail geometry must be re-synced on container resize.
    const containerResizeObserver = new ResizeObserver(() => {
      if (!activeSession.pdfViewer) return;
      activeSession.pdfViewer.update();
      refreshBookmarkRailLayout();
    });
    if (activeSession.containerEl) containerResizeObserver.observe(activeSession.containerEl);
    void installAppMenu({ openPdf, savePdf, savePdfAs }).then((controls) => {
      menuControls = controls;
      void controls?.setSaveEnabled(Boolean(activeSession.pdfDocument));
    });
    return () => {
      containerResizeObserver.disconnect();
      activeSession.containerEl?.removeEventListener("mouseleave", clearRailHoverCue);
      activeSession.containerEl?.removeEventListener("mousemove", handlePdfContainerMouseMove);
      activeSession.containerEl?.removeEventListener("scroll", handlePdfScroll);
      activeSession.containerEl?.removeEventListener("click", handleRailClick);
      activeSession.containerEl?.removeEventListener("dblclick", handlePdfDoubleClick, { capture: true });
      activeSession.containerEl?.removeEventListener("pointerdown", handlePdfPointerDown, { capture: true });
      activeSession.containerEl?.removeEventListener("pointerdown", handleHighlightTextLayerPointerDown, { capture: true });
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
    if (resetTool && activeSession.activeTool !== "none") {
      setTool("none");
    }
    activeSession.annotationFocusBox = null;
    activeSession.selectedAnnotationEntryId = null;
    activeSession.selectedPersistedAnnotationKey = null;
    activeSession.selectedAnnotationKind = null;
    activeSession.selectedAnnotationColor = null;
    activeSession.hasSelectedHighlight = false;
    activeSession.selectedHighlightColor = null;
    unselectAllIgnoringPdfjsSignalBug();
    setPdfjsEditorMode(activeSession.activeTool);
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
    if (!activeSession.annotationFocusBox && !activeSession.selectedAnnotationEntryId && !activeSession.selectedPersistedAnnotationKey && !activeSession.selectedAnnotationKind) {
      return;
    }
    clearAnnotationFocusSelection(true);
    blurFocusedAnnotationRow();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    const target = event.target;
    // A pointerdown outside an in-edit free text editor is about to blur it,
    // and pdf.js commits on blur — repair the DOM shape first so Shift+Enter
    // lines survive that commit (see normalizeFreeTextEditorLines).
    const editingFreeText = activeSession.containerEl.querySelector<HTMLElement>(
      ".freeTextEditor .internal[contenteditable='true'], .freeTextEditor [contenteditable='true']",
    );
    if (editingFreeText && target instanceof Node && !editingFreeText.contains(target)) {
      normalizeFreeTextEditorLines(editingFreeText);
    }
    if (
      !(target instanceof Element) ||
      (!activeSession.annotationFocusBox && !activeSession.selectedAnnotationEntryId && !activeSession.selectedPersistedAnnotationKey && !activeSession.selectedAnnotationKind)
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
    if (!activeSession.selectedAnnotationKind || isEditableKeyboardTarget(event.target)) {
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
    if ((event.key !== "Enter" && event.key !== "Escape") || event.shiftKey || event.isComposing) {
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
    if (event.key === "Escape") {
      // pdf.js commits on Escape itself; just repair the DOM shape first so
      // its #extractText does not merge Shift+Enter lines (see quirk module).
      normalizeFreeTextEditorLines(textElement);
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
    normalizeFreeTextEditorLines(textElement);
    editor.commit?.();
    activeSession.isDirty = true;
    syncSelectedEditorState();
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(150, 500);
    activeSession.status = "Edited selected free text. Save to persist it into the PDF.";
  }

  async function openPdf() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!selected || Array.isArray(selected)) return;

    await openPathAsTab(selected);
  }

  async function openPathAsTab(path: string) {
    // D4: dedupe by absolute path — if already open, activate that tab.
    const existingId = findByPath(tabsState, path);
    if (existingId) {
      await switchToTab(existingId);
      return;
    }

    // Create a new tab + session, activate it, then load the PDF.
    const id = crypto.randomUUID();
    const label = path.split("/").pop() ?? path;
    const session = new DocumentSession();
    sessions.set(id, session);
    tabsState = addDocTab(tabsState, { path, label });
    tabsState = activateDocTab(tabsState, id);
    await syncActiveTabUI();

    session.isBusy = true;
    session.status = "Loading PDF...";
    try {
      const rawBytes = await invoke<number[]>("read_pdf", { path });
      await loadPdfBytesInto(session, new Uint8Array(rawBytes), label);
      session.currentPath = path;
      session.isDirty = false;
      session.activeTool = "none";
      session.status = `Loaded ${label}`;
    } catch (error) {
      session.status = `Open failed: ${formatError(error)}`;
    } finally {
      session.isBusy = false;
    }
  }

  async function switchToTab(id: DocumentTabId) {
    if (tabsState.activeId === id) return;
    const prev = tabsState.activeId ? sessions.get(tabsState.activeId) : null;
    const next = sessions.get(id);
    if (!next) return;

    // §4.4: Save scroll, flip active, restore scroll, wake rendering.
    if (prev) {
      prev.savedScrollTop = prev.containerEl?.scrollTop ?? 0;
    }

    tabsState = activateDocTab(tabsState, id);
    await syncActiveTabUI();

    // Restore scroll and wake rendering.
    next.containerEl.scrollTop = next.savedScrollTop;
    if (next.pdfViewer) {
      next.pdfViewer.update();
      next.pdfViewer.forceRendering(undefined);
      requestAnimationFrame(() => {
        next.pdfViewer?.update();
        next.pdfViewer?.forceRendering(undefined);
      });
    }
  }

  async function syncActiveTabUI() {
    await tick();
    // Sync window title.
    if (tabsState.activeId) {
      const tab = tabsState.tabs[tabsState.activeId];
      const title = tab?.label ?? "Chive";
      if (isTauriRuntime()) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setTitle(title);
        } catch {
          // Browser build — no window title API.
        }
      }
    }
    // Sync save menu state.
    menuControls?.setSaveEnabled(Boolean(activeSession.pdfDocument));
  }

  function isTauriRuntime() {
    return "__TAURI_INTERNALS__" in window;
  }

  async function loadPdfBytesInto(session: DocumentSession, bytes: Uint8Array, label: string) {
    const loadingTask = pdfjsLib.getDocument({ data: bytes, wasmUrl: pdfjsWasmUrl });
    const nextDocument = await loadingTask.promise;

    // Tear down this session's existing viewer (if any).
    teardownSessionViewer(session);
    session.rememberedSelectionText = "";
    session.rememberedSelectionRanges = [];

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    session.pdfLinkService = linkService;
    session.eventBus = eventBus;
    eventBus.on("annotationeditoruimanager", (event: { uiManager: AnnotationEditorUIManager }) => {
      session.annotationEditorUIManager = event.uiManager;
    });

    session.pdfViewer = new PDFViewer({
      container: session.containerEl,
      viewer: session.viewerEl,
      eventBus,
      linkService,
      annotationEditorMode: editorModes.none,
      enableHighlightFloatingButton: false,
      annotationEditorHighlightColors:
        "red=#ffb3ab,orange=#ffd1a1,yellow=#fff35c,green=#7cf2aa,cyan=#a5ecf2,blue=#8ecbff,purple=#d7bfff,rose=#ffb6de",
    } as ConstructorParameters<typeof PDFViewer>[0] & { enableHighlightFloatingButton: boolean });
    linkService.setViewer(session.pdfViewer);
    session.pdfViewer.setDocument(nextDocument);
    linkService.setDocument(nextDocument, null);
    session.pdfDocument = nextDocument;
    void loadOutlineInto(session, nextDocument);

    eventBus.on("pagesinit", () => {
      if (!session.pdfViewer) return;
      session.pdfViewer.currentScaleValue = "page-width";
      session.pdfViewer.update();
      session.pdfViewer.forceRendering(undefined);
      requestAnimationFrame(() => {
        session.pdfViewer?.update();
        session.pdfViewer?.forceRendering(undefined);
      });
      session.scaleLabel = "Fit Width";
      session.status = `Rendered ${label}`;
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
    eventBus.on("scalechanging", (event: { scale: number }) => {
      session.zoomPercent = Math.round(event.scale * 100);
    });
  }

  function teardownSessionViewer(session: DocumentSession) {
    unselectAllIgnoringPdfjsSignalBugForSession(session);
    session.pdfViewer?.setDocument(null as never);
    (session.pdfDocument as { destroy?: () => void } | null)?.destroy?.();
    session.pdfViewer = null;
    session.pdfLinkService = null;
    session.pdfDocument = null;
    session.annotationEditorUIManager = null;
    session.eventBus = null;
    session.outlineEntries = [];
    session.outlineStatus = "Open a PDF to inspect its outline.";
    session.collapsedOutlineIds = [];
    session.activeOutlineEntryId = null;
    session.bookmarkEntries = [];
    session.bookmarkStatus = "Open a PDF to inspect bookmarks.";
    session.editingBookmarkId = null;
    session.activeBookmarkId = null;
    session.annotationEntries = [];
    session.annotationStatus = "Open a PDF to inspect annotations.";
    session.selectedAnnotationEntryId = null;
    session.selectedPersistedAnnotationKey = null;
    session.selectedAnnotationKind = null;
    session.selectedAnnotationColor = null;
    session.hasSelectedHighlight = false;
    session.selectedHighlightColor = null;
    session.activeTool = "none";
    session.lastActivatedOutlineEntry = null;
    session.annotationFocusBox = null;
    session.annotationDetailCache.clear();
    session.pendingDeletedPersistedAnnotationKeys.clear();
    session.persistedAnnotationKeyByEditorId.clear();
    session.persistedPositionByKey.clear();
    if (session.annotationRefreshTimer) {
      clearTimeout(session.annotationRefreshTimer);
      session.annotationRefreshTimer = null;
    }
    session.viewerEl?.replaceChildren();
  }

  function unselectAllIgnoringPdfjsSignalBugForSession(session: DocumentSession) {
    const mgr = session.annotationEditorUIManager;
    if (!mgr) return;
    unselectAllForManagerIgnoringSignalBug(mgr);
  }

  async function loadOutlineInto(session: DocumentSession, document: PdfDocument) {
    // Delegate to the existing loadOutline function but scoped to the session.
    // For Phase B, we reuse the existing loadOutline which reads from activeSession.
    // When this session IS the active session, it works directly.
    if (session === activeSession) {
      await loadOutline(document);
    }
  }

  async function loadPdf(path: string) {
    activeSession.isBusy = true;
    activeSession.status = "Loading PDF...";
    try {
      const rawBytes = await invoke<number[]>("read_pdf", { path });
      await loadPdfBytes(new Uint8Array(rawBytes), path);
      activeSession.currentPath = path;
      activeSession.isDirty = false;
      activeSession.activeTool = "none";
      activeSession.status = `Loaded ${path}`;
    } catch (error) {
      activeSession.status = `Open failed: ${formatError(error)}`;
    } finally {
      activeSession.isBusy = false;
    }
  }

  async function loadSamplePdf() {
    activeSession.isBusy = true;
    activeSession.status = "Loading bundled sample PDF...";
    try {
      const response = await fetch("/sample.pdf");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadPdfBytes(new Uint8Array(await response.arrayBuffer()), "sample.pdf");
      activeSession.currentPath = "sample.pdf";
      activeSession.isDirty = false;
      activeSession.activeTool = "none";
      activeSession.rememberedSelectionText = "";
      activeSession.rememberedSelectionRanges = [];
      activeSession.status = "Loaded bundled sample PDF.";
    } catch (error) {
      activeSession.status = `Sample load failed: ${formatError(error)}`;
    } finally {
      activeSession.isBusy = false;
    }
  }

  async function loadPdfBytes(bytes: Uint8Array, label: string) {
    // D8: Legacy loads replace the active tab's document in-place.
    await loadPdfBytesInto(activeSession, bytes, label);
  }

  function scheduleAnnotationSidebarRefresh(delay = 120) {
    if (activeSession.annotationRefreshTimer) {
      clearTimeout(activeSession.annotationRefreshTimer);
    }
    activeSession.annotationRefreshTimer = setTimeout(() => {
      activeSession.annotationRefreshTimer = null;
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
    if (!activeSession.pdfDocument) {
      activeSession.annotationEntries = [];
      activeSession.annotationStatus = "Open a PDF to inspect annotations.";
      return;
    }
    try {
      const pdfEntries = await getPdfAnnotationEntries();
      for (const entry of pdfEntries) {
        activeSession.persistedPositionByKey.set(persistedAnnotationKey(entry.page, entry.sourceId), {
          top: entry.sortTop,
          left: entry.sortLeft,
        });
      }
      const liveEntries = getLiveAnnotationEntries(pdfEntries);
      const merged = [...liveEntries, ...pdfEntries].sort(
        (left, right) =>
          left.page - right.page ||
          left.sortTop - right.sortTop ||
          left.sortLeft - right.sortLeft ||
          left.label.localeCompare(right.label),
      );
      activeSession.annotationEntries = merged;
      activeSession.annotationStatus = annotationCountLabel(merged.length);
    } catch (error) {
      activeSession.annotationStatus = `Annotation scan failed: ${formatError(error)}`;
    }
  }

  async function getPdfAnnotationEntries() {
    const pages = await debugHarness.annotationSummary();
    return buildPdfAnnotationEntries({
      pdfDocument: activeSession.pdfDocument,
      pages,
      detailCache: activeSession.annotationDetailCache,
      isHidden: isPersistedAnnotationHidden,
      fallbackText: textForAnnotationDom,
      fallbackPosition: annotationTargetPosition,
    });
  }

  function getLiveAnnotationEntries(persistedEntries: AnnotationEntry[]) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return [];
    return buildLiveAnnotationEntries({
      pageCount: activeSession.pdfDocument.numPages,
      persistedEntries,
      detailCache: activeSession.annotationDetailCache,
      getEditors: (pageIndex) => activeSession.annotationEditorUIManager?.getEditors(pageIndex) ?? [],
      editorId: (editor) => editor.id,
      editorColor: (editor) => editor.color ?? null,
      isDeleted: (editor) => Boolean(editor.deleted),
      kindForEditor: annotationKindForEditor,
      isUnmodifiedMirrorOfPersistedAnnotation: isUnmodifiedEditorMirrorOfPersistedAnnotation,
      targetIndexForEditor: (pageNumber, kind, editor, fallbackTargetIndex) =>
        targetIndexForEditor(pageNumber, kind, editor.id, fallbackTargetIndex),
      positionForEditor: (pageNumber, kind, targetIndex, editor) => {
        // A stand-in for a persisted annotation keeps the persisted sort
        // geometry: a text edit must not move the entry in the sidebar.
        const persistedKey = persistedAnnotationKeyForEditor(editor);
        const cached = persistedKey ? activeSession.persistedPositionByKey.get(persistedKey) : undefined;
        return cached ?? annotationTargetPosition(pageNumber, kind, targetIndex, editor.id);
      },
      boundsForEditor: (pageNumber, kind, targetIndex, editor) =>
        annotationTargetBounds(pageNumber, kind, targetIndex, editor.id),
      detailForEditor: liveAnnotationDetail,
    });
  }

  function isPersistedAnnotationHidden(pageNumber: number, sourceId: string) {
    return (
      activeSession.pendingDeletedPersistedAnnotationKeys.has(persistedAnnotationKey(pageNumber, sourceId)) ||
      isPersistedAnnotationDeleted(sourceId) ||
      isPersistedAnnotationModified(pageNumber, sourceId)
    );
  }

  function isPersistedAnnotationDeleted(sourceId: string) {
    if (!activeSession.annotationEditorUIManager?.isDeletedAnnotationElement) return false;
    const annotationElementId = pdfAnnotationElementId(sourceId);
    return (
      activeSession.annotationEditorUIManager.isDeletedAnnotationElement(annotationElementId) ||
      activeSession.annotationEditorUIManager.isDeletedAnnotationElement(sourceId)
    );
  }

  function isPersistedAnnotationModified(pageNumber: number, sourceId: string) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return false;
    const pageIndex = pageNumber - 1;
    for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
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
      : activeSession.persistedAnnotationKeyByEditorId.get(editor.id) ?? null;
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
    return activeSession.annotationEntries.find(
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
      activeSession.annotationEntries.find((entry) => entry.source === "live" && entry.sourceId === editorId) ??
      persistedAnnotationEntryForEditorId(editorId)
    );
  }

  function annotationEntryMatchesCurrentSelection(entry: AnnotationEntry) {
    if (entry.source === "live") {
      return activeSession.selectedAnnotationEntryId === entry.id;
    }
    return activeSession.selectedPersistedAnnotationKey === persistedAnnotationKey(entry.page, entry.sourceId);
  }

  function isRepeatedAnnotationPointerClick(entry: AnnotationEntry, event: PointerEvent) {
    const previous = activeSession.lastAnnotationPointerClick;
    activeSession.lastAnnotationPointerClick = {
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
    activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(pageNumber, sourceId);
    return activeSession.selectedPersistedAnnotationKey;
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
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) {
      return null;
    }
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const candidate of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
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
    // innerText keeps rendered line breaks (textContent glues multi-line
    // free text into one word); collapse them to spaces for the snippet.
    if (kind === "freetext") return (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
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
    activeSession.outlineEntries = [];
    activeSession.outlineStatus = "Loading outline...";
    activeSession.activeOutlineEntryId = null;
    activeSession.bookmarkEntries = [];
    activeSession.bookmarkStatus = "Loading bookmarks...";
    try {
      const documentWithOutline = document as PdfDocument & {
        getDestination: (id: string) => Promise<unknown[] | null>;
        getOutline: () => Promise<PdfOutlineRaw[] | null>;
        getPageIndex: (ref: unknown) => Promise<number>;
      };
      const rawOutline = await documentWithOutline.getOutline();
      if (!rawOutline || rawOutline.length === 0) {
        activeSession.outlineStatus = "This PDF has no outline.";
        activeSession.bookmarkStatus = bookmarkCountLabel(0);
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
        activeSession.bookmarkEntries = sortBookmarkEntries(
          normalizedBookmarks.filter((entry): entry is BookmarkEntry => Boolean(entry)),
        );
      }
      activeSession.bookmarkStatus = bookmarkCountLabel(activeSession.bookmarkEntries.length);
      if (documentOutline.length === 0) {
        activeSession.outlineStatus = "This PDF has no outline.";
        return;
      }
      activeSession.outlineEntries = await Promise.all(
        documentOutline.map((item, index) => normalizeOutlineEntry(documentWithOutline, item, `${index + 1}`)),
      );
      activeSession.collapsedOutlineIds = [];
      const count = countOutlineEntries(activeSession.outlineEntries);
      const unavailableCount = countUnavailableOutlineEntries(activeSession.outlineEntries);
      activeSession.outlineStatus =
        unavailableCount > 0
          ? `${count} outline ${count === 1 ? "item" : "items"}; ${unavailableCount} not navigable`
          : `${count} outline ${count === 1 ? "item" : "items"}`;
      requestAnimationFrame(refreshActiveOutlineFromScroll);
    } catch (error) {
      activeSession.outlineStatus = `Outline failed: ${formatError(error)}`;
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
    activeSession.outlineEntries = updateOutlineEntryColor(activeSession.outlineEntries, id, color);
    activeSession.outlineColorMenuId = null;
    activeSession.isDirty = true;
  }

  function isOutlineCollapsed(id: string) {
    return activeSession.collapsedOutlineIds.includes(id);
  }

  function toggleOutlineCollapsed(id: string) {
    activeSession.collapsedOutlineIds = isOutlineCollapsed(id)
      ? activeSession.collapsedOutlineIds.filter((candidate) => candidate !== id)
      : [...activeSession.collapsedOutlineIds, id];
    activeSession.outlineColorMenuId = null;
  }

  function collapseAllOutlineItems() {
    activeSession.collapsedOutlineIds = flattenOutlineEntries(activeSession.outlineEntries)
      .filter((entry) => entry.items.length > 0)
      .map((entry) => entry.id);
    activeSession.outlineColorMenuId = null;
  }

  function expandAllOutlineItems() {
    activeSession.collapsedOutlineIds = [];
    activeSession.outlineColorMenuId = null;
  }

  function isActiveOutlineRow(id: string) {
    return visibleActiveOutlineEntryId(activeSession.outlineEntries, activeSession.activeOutlineEntryId, isOutlineCollapsed) === id;
  }

  function refreshActiveOutlineFromScroll() {
    if (!activeSession.containerEl || activeSession.outlineEntries.length === 0) {
      activeSession.activeOutlineEntryId = null;
      return;
    }
    const anchorTop = activeSession.containerEl.scrollTop + 96;
    const pageElements = [...(activeSession.viewerEl?.querySelectorAll<HTMLElement>(".page[data-page-number]") ?? [])]
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
      activeSession.activeOutlineEntryId = null;
      return;
    }
    const flatEntries = flattenOutlineEntries(activeSession.outlineEntries).filter((entry) => entry.pageNumber);
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
    activeSession.activeOutlineEntryId = active?.id ?? null;
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
    if (!activeSession.pdfDocument || !activeSession.pdfViewer) {
      activeSession.status = "Open a PDF before creating bookmarks.";
      return;
    }
    const pageNumber = activeSession.pdfViewer.currentPageNumber || 1;
    const pageTarget = await bookmarkPageTarget(pageNumber);
    await createBookmarkFromTarget(pageTarget, editAfterCreate);
  }

  async function handlePdfContainerClick(event: MouseEvent) {
    if ((event.target as Element | null)?.closest("button, input")) return;
    activeSession.editingBookmarkId = null;
    const cueHit = bookmarkRailHoverCueHitAtPoint(event.clientX, event.clientY);
    if (cueHit) {
      await createBookmarkAtPageRailPoint(cueHit.clientY, cueHit.pageNumber);
      return;
    }
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit) return;
    if (bookmarkRailPointConflicts(hit.pageElement, event.clientY)) {
      activeSession.bookmarkRailHoverCue = null;
      return;
    }
    await createBookmarkAtPageRailPoint(event.clientY, hit.pageNumber);
  }

  function handlePdfContainerMouseMove(event: MouseEvent) {
    if (bookmarkRailHoverCueHitAtPoint(event.clientX, event.clientY)) {
      return;
    }
    const hit = bookmarkRailHitAtPoint(event.clientX, event.clientY);
    if (!hit || !activeSession.containerEl) {
      activeSession.bookmarkRailHoverCue = null;
      return;
    }
    if (bookmarkRailPointConflicts(hit.pageElement, event.clientY)) {
      activeSession.bookmarkRailHoverCue = null;
      return;
    }
    const containerRect = activeSession.containerEl.getBoundingClientRect();
    const pointerLeft = activeSession.containerEl.scrollLeft + event.clientX - containerRect.left;
    const pointerTop = activeSession.containerEl.scrollTop + event.clientY - containerRect.top;
    const pagePosition = pagePositionInContainer(hit.pageElement);
    activeSession.bookmarkRailHoverCue = {
      pageNumber: hit.pageNumber,
      focusLeft: pagePosition.left,
      focusTop: pointerTop,
      hintLeft: pointerLeft + bookmarkRailAddCueOffsetPx,
      hintTop: pointerTop + bookmarkRailAddCueOffsetPx,
    };
  }

  function bookmarkRailHoverCueHitAtPoint(clientX: number, clientY: number) {
    if (!activeSession.bookmarkRailHoverCue || !activeSession.containerEl) return null;
    const containerRect = activeSession.containerEl.getBoundingClientRect();
    const focusCenter = {
      x: containerRect.left + activeSession.bookmarkRailHoverCue.focusLeft - activeSession.containerEl.scrollLeft,
      y: containerRect.top + activeSession.bookmarkRailHoverCue.focusTop - activeSession.containerEl.scrollTop,
    };
    const addCenter = {
      x: containerRect.left + activeSession.bookmarkRailHoverCue.hintLeft - activeSession.containerEl.scrollLeft,
      y: containerRect.top + activeSession.bookmarkRailHoverCue.hintTop - activeSession.containerEl.scrollTop,
    };
    const withinFocusCue = withinSquareCue(clientX, clientY, focusCenter.x, focusCenter.y, bookmarkRailFocusCueSizePx);
    const withinAddCue = withinSquareCue(clientX, clientY, addCenter.x, addCenter.y, bookmarkRailAddCueSizePx);
    return withinFocusCue || withinAddCue
      ? { pageNumber: activeSession.bookmarkRailHoverCue.pageNumber, clientY: focusCenter.y }
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
      ...[...activeSession.containerEl.querySelectorAll<HTMLElement>(".bookmark-page-marker")].map((marker) => {
        const rect = marker.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
      ...activeSession.pendingBookmarkRailMarkerRects,
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
    return activeSession.bookmarkEntries.some((entry) => {
      const markerRect = bookmarkRailMarkerContentRect(entry.pageNumber, entry.targetY, entry.pageHeight);
      return markerRect ? bookmarkRailRectsConflict(candidateRect, markerRect) : false;
    });
  }

  function reserveBookmarkRailMarkerRect(rect: BookmarkRailRect) {
    activeSession.pendingBookmarkRailMarkerRects = [...activeSession.pendingBookmarkRailMarkerRects, rect];
    return () => {
      activeSession.pendingBookmarkRailMarkerRects = activeSession.pendingBookmarkRailMarkerRects.filter((pendingRect) => pendingRect !== rect);
    };
  }

  function bookmarkRailHitAtPoint(clientX: number, clientY: number) {
    const pageElements = [...(activeSession.viewerEl?.querySelectorAll<HTMLElement>(".page[data-page-number]") ?? [])];
    // Pointer events carry integer client coordinates while page rects can sit
    // at half-pixel offsets (the reader centers pages, so the gutter is often
    // fractional). Allow 1px so a click on the rail's outer edge still counts.
    const railHitTolerancePx = bookmarkRailAnchorWidthPx + 1;
    const pageElement = pageElements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        Math.abs(clientX - rect.left) <= railHitTolerancePx &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    });
    const pageNumber = Number(pageElement?.dataset.pageNumber);
    return pageElement && Number.isInteger(pageNumber) && pageNumber > 0 ? { pageElement, pageNumber } : null;
  }

  async function createBookmarkAtPageRailPoint(clientY: number, pageNumber: number) {
    if (!activeSession.pdfDocument) {
      activeSession.status = "Open a PDF before creating bookmarks.";
      return;
    }
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (!pageElement) {
      activeSession.status = "Could not resolve page rail for bookmark.";
      return;
    }
    const pageRect = pageElement.getBoundingClientRect();
    const offsetIntoPage = Math.max(0, Math.min(pageRect.height, clientY - pageRect.top));
    const markerRect = bookmarkRailMarkerRectAtPoint(pageElement, clientY);
    if (bookmarkRailPointConflicts(pageElement, clientY)) {
      activeSession.bookmarkRailHoverCue = null;
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
      activeSession.status = "Could not resolve current page for bookmark.";
      return;
    }
    if (bookmarkTargetConflictsWithExistingBookmarks(pageTarget)) {
      activeSession.bookmarkRailHoverCue = null;
      activeSession.status = "Bookmark too close to existing bookmark.";
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
    activeSession.bookmarkEntries = sortBookmarkEntries([...activeSession.bookmarkEntries, entry]);
    activeSession.bookmarkStatus = bookmarkCountLabel(activeSession.bookmarkEntries.length);
    navigationTab = "bookmarks";
    activateDockTab("bookmarks");
    activeSession.editingBookmarkId = editAfterCreate ? entry.id : null;
    activeSession.bookmarkColorMenuId = null;
    activeSession.hoveredBookmarkId = null;
    activeSession.bookmarkRailHoverCue = null;
    activeSession.isDirty = true;
    activeSession.status = `Added bookmark ${title}.`;
  }

  function bookmarkTargetConflictsWithExistingBookmarks(pageTarget: NonNullable<Awaited<ReturnType<typeof bookmarkPageTarget>>>) {
    const candidateRect = bookmarkRailMarkerContentRect(pageTarget.pageNumber, pageTarget.targetY, pageTarget.pageHeight);
    if (!candidateRect) return false;
    return activeSession.bookmarkEntries.some((entry) => {
      const markerRect = bookmarkRailMarkerContentRect(entry.pageNumber, entry.targetY, entry.pageHeight);
      return markerRect ? bookmarkRailRectsConflict(candidateRect, markerRect) : false;
    });
  }

  function bookmarkRailMarkerContentRect(pageNumber: number, targetY: number, pageHeight: number) {
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
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
    activeSession.bookmarkEntries = activeSession.bookmarkEntries.map((entry) =>
      entry.id === id ? { ...entry, title: title.trim() || `Page ${entry.pageNumber}` } : entry,
    );
    activeSession.isDirty = true;
  }

  function startEditingBookmark(id: string) {
    activeSession.editingBookmarkId = id;
    activeSession.bookmarkColorMenuId = null;
    activeSession.hoveredBookmarkId = null;
  }

  function updateBookmarkColor(id: string, color: string | null) {
    activeSession.bookmarkEntries = activeSession.bookmarkEntries.map((entry) => (entry.id === id ? { ...entry, color } : entry));
    activeSession.bookmarkColorMenuId = null;
    activeSession.isDirty = true;
  }

  function handleBookmarkTitleKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      activeSession.editingBookmarkId = null;
      activeSession.bookmarkColorMenuId = null;
      activeSession.hoveredBookmarkId = null;
      event.preventDefault();
    }
    if (event.key === "Escape") {
      activeSession.editingBookmarkId = null;
      activeSession.bookmarkColorMenuId = null;
      activeSession.hoveredBookmarkId = null;
      event.preventDefault();
    }
  }

  function deleteBookmark(id: string) {
    const removed = activeSession.bookmarkEntries.find((entry) => entry.id === id);
    activeSession.bookmarkEntries = activeSession.bookmarkEntries.filter((entry) => entry.id !== id);
    activeSession.bookmarkStatus = bookmarkCountLabel(activeSession.bookmarkEntries.length);
    if (activeSession.editingBookmarkId === id) {
      activeSession.editingBookmarkId = null;
    }
    if (activeSession.bookmarkColorMenuId === id) {
      activeSession.bookmarkColorMenuId = null;
    }
    activeSession.isDirty = true;
    activeSession.status = removed ? `Deleted bookmark ${removed.title}.` : "Deleted bookmark.";
  }

  function defaultBookmarkTitle(pageNumber: number, targetY: number, pageHeight: number) {
    return textLineBookmarkTitle(pageNumber, targetY, pageHeight) ?? outlineBookmarkTitle(pageNumber, targetY);
  }

  function textLineBookmarkTitle(pageNumber: number, targetY: number, pageHeight: number) {
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
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
    const candidates = flattenOutlineEntries(activeSession.outlineEntries).filter(
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
    if (!activeSession.pdfDocument) return null;
    const page = await activeSession.pdfDocument.getPage(pageNumber);
    const ref = (page as unknown as { ref?: { num: number; gen?: number } }).ref;
    const view = (page as unknown as { view?: number[] }).view;
    const viewport = page.getViewport({ scale: 1 });
    const pageRef =
      pdfRefString(ref) ??
      (activeSession.lastActivatedOutlineEntry?.pageNumber === pageNumber
        ? pdfRefString(explicitDestinationRef(activeSession.lastActivatedOutlineEntry.dest))
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
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (!activeSession.containerEl || !pageElement) return pageHeight;
    const offsetIntoPage = explicitOffsetIntoPage ?? Math.max(0, activeSession.containerEl.scrollTop - pageElement.offsetTop);
    return targetYForOffsetIntoPage(offsetIntoPage, renderedPageScale(pageElement.offsetHeight, pageHeight), pageHeight);
  }

  function bookmarkAnchorInsetPdfPoints(pageNumber: number, pageHeight: number) {
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    return bookmarkAnchorInsetForScale(renderedPageScale(pageElement?.offsetHeight ?? 0, pageHeight));
  }

  function bookmarkDestinationY(pageNumber: number, targetY: number, pageHeight: number) {
    return bookmarkDestinationYForInset(targetY, bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }

  function bookmarkAnchorYFromDestination(pageNumber: number, destinationY: number, pageHeight: number) {
    return bookmarkAnchorYForInset(destinationY, bookmarkAnchorInsetPdfPoints(pageNumber, pageHeight), pageHeight);
  }


  async function goToBookmarkEntry(entry: BookmarkEntry) {
    activeSession.editingBookmarkId = null;
    activeSession.activeBookmarkId = entry.id;
    await scrollToBookmarkTarget(entry);
    activeSession.status = `Navigated to ${entry.title}.`;
  }

  async function editBookmarkAndGoToEntry(entry: BookmarkEntry) {
    activeSession.activeBookmarkId = entry.id;
    startEditingBookmark(entry.id);
    await scrollToBookmarkTarget(entry);
    activeSession.status = `Navigated to ${entry.title}.`;
  }

  async function scrollToBookmarkTarget(entry: BookmarkEntry) {
    if (scrollBookmarkTargetIntoView(entry)) return;
    await scrollToPage(entry.pageNumber);
    await new Promise((resolve) => setTimeout(resolve, 100));
    scrollBookmarkTargetIntoView(entry);
  }

  function scrollBookmarkTargetIntoView(entry: BookmarkEntry) {
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
    if (!pageElement || !activeSession.containerEl) return false;
    const offsetIntoPage = offsetIntoPageForTargetY(entry.targetY, entry.pageHeight, pageElement.offsetHeight);
    const pagePosition = pagePositionInContainer(pageElement);
    activeSession.containerEl.scrollTop = Math.max(0, pagePosition.top + offsetIntoPage - bookmarkRailAnchorHeightPx);
    return true;
  }

  function bookmarkMarkerStyle(entry: BookmarkEntry) {
    activeSession.bookmarkRailLayoutVersion;
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
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
    if (!activeSession.containerEl) {
      return { left: pageElement.offsetLeft, top: pageElement.offsetTop };
    }
    const containerRect = activeSession.containerEl.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    return {
      left: activeSession.containerEl.scrollLeft + pageRect.left - containerRect.left,
      top: activeSession.containerEl.scrollTop + pageRect.top - containerRect.top,
    };
  }

  function bookmarkColorStyle(entry: BookmarkEntry) {
    return `--bookmark-color: ${entry.color ?? defaultBookmarkColor}`;
  }

  function refreshBookmarkRailLayout() {
    activeSession.bookmarkRailLayoutVersion += 1;
  }

  async function goToOutlineEntry(entry: OutlineEntry) {
    if (entry.url) {
      activeSession.status = "External outline links are not opened in this spike.";
      return false;
    }
    if (!entry.dest || !entry.pageNumber || !activeSession.pdfLinkService) {
      activeSession.status = "Outline item has no navigable PDF destination.";
      return false;
    }
    activeSession.activeOutlineEntryId = entry.id;
    try {
      await activeSession.pdfLinkService.goToDestination(entry.dest as string | unknown[]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (activeSession.pdfViewer && entry.pageNumber && activeSession.pdfViewer.currentPageNumber !== entry.pageNumber) {
        await scrollToPage(entry.pageNumber);
      }
      activeSession.lastActivatedOutlineEntry = entry;
      requestAnimationFrame(refreshActiveOutlineFromScroll);
      activeSession.status = `Navigated to ${entry.title}.`;
      return true;
    } catch (error) {
      activeSession.status = `Outline navigation failed: ${formatError(error)}`;
      return false;
    }
  }

  async function activateFirstOutlineItem() {
    const first = activeSession.outlineEntries[0];
    if (!first) return false;
    return goToOutlineEntry(first);
  }

  async function activateFirstAnnotationItem() {
    await refreshAnnotationSidebar();
    const first = activeSession.annotationEntries[0];
    if (!first) return false;
    return locateAnnotationEntry(first);
  }

  async function activateAnnotationBySourceId(sourceId: string) {
    await refreshAnnotationSidebar();
    const entry = activeSession.annotationEntries.find((candidate) => candidate.sourceId === sourceId);
    if (!entry) return false;
    return activateAnnotationEntry(entry);
  }


  async function activateAnnotationEntry(entry: AnnotationEntry) {
    activeSession.selectedAnnotationEntryId = entry.id;
    await scrollToPage(entry.page);
    if (entry.source === "live") {
      return activateLiveAnnotationEntry(entry);
    }
    return activatePdfAnnotationEntry(entry);
  }

  async function locateAnnotationEntry(entry: AnnotationEntry) {
    activeSession.selectedAnnotationEntryId = entry.id;
    await scrollToPage(entry.page);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (locateAnnotationBounds(entry)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    activeSession.status = `Could not find ${entry.label.toLowerCase()} on page ${entry.page}.`;
    return false;
  }

  async function scrollToPage(pageNumber: number) {
    const pageElement = activeSession.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      activeSession.containerEl.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } else if (activeSession.pdfViewer) {
      activeSession.pdfViewer.currentPageNumber = pageNumber;
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
    options: { enterEditMode?: boolean; scrollIntoView?: boolean } = {},
  ) {
    unselectAllIgnoringPdfjsSignalBug();
    activeSession.selectedAnnotationKind = null;
    activeSession.selectedAnnotationColor = null;
    activeSession.hasSelectedHighlight = false;
    activeSession.selectedHighlightColor = null;
    activeSession.selectedAnnotationEntryId = entry.id;
    activeSession.selectedPersistedAnnotationKey = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (entry.kind === "ink" && activeSession.activeTool !== "none") {
        const exactElement = document.getElementById(pdfAnnotationElementId(entry.sourceId));
        if (!isUsableAnnotationElement(exactElement, entry)) {
          setPdfjsEditorMode("none");
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      const element = annotationTargetElementForEntry(entry);
      if (element) {
        activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        await focusAnnotationElement(element, {
          scrollIntoView: options.scrollIntoView,
          showFocusBox: false,
        });
        if (await activatePersistedEditorEntry(entry, { enterEditMode: options.enterEditMode, scrollIntoView: options.scrollIntoView })) {
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
              ? await activateFreeTextEditorAtPoint(x, y, { enterEditMode: options.enterEditMode })
              : await activateInkEditorAtPoint(x, y);
        if (!activated && entry.kind === "ink") {
          return locatePdfAnnotationEntry(entry);
        }
        return activated;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    activeSession.status = `Could not find ${entry.label.toLowerCase()} on page ${entry.page}.`;
    if (entry.kind === "ink" && entry.bounds && locatePdfAnnotationBounds(entry)) {
      return true;
    }
    return false;
  }

  function locatePdfAnnotationEntry(entry: AnnotationEntry) {
    clearLocateOnlyEditorSelection();
    activeSession.selectedAnnotationEntryId = entry.id;
    activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    activeSession.selectedAnnotationKind = null;
    activeSession.selectedAnnotationColor = null;
    activeSession.hasSelectedHighlight = false;
    activeSession.selectedHighlightColor = null;
    activeSession.status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    queueLocateOnlyEditorSelectionClear();
    return true;
  }

  function locatePdfAnnotationBounds(entry: AnnotationEntry) {
    return locateAnnotationBounds(entry);
  }

  function locateAnnotationBounds(entry: AnnotationEntry, options: { scrollIntoView?: boolean } = {}) {
    if (!activeSession.containerEl) return false;
    clearLocateOnlyEditorSelection();
    const focusBox = renderedAnnotationShapeFocusBox(entry) ?? annotationEntryFocusBox(entry);
    if (!focusBox) return false;
    const { left, top, width, height } = focusBox;

    if (options.scrollIntoView !== false) {
      activeSession.containerEl.scrollLeft = Math.max(0, left + width / 2 - activeSession.containerEl.clientWidth / 2);
      activeSession.containerEl.scrollTop = Math.max(0, top + height / 2 - activeSession.containerEl.clientHeight / 2);
    }
    activeSession.annotationFocusBox = focusBox;
    unselectAllIgnoringPdfjsSignalBug();
    activeSession.selectedAnnotationEntryId = entry.id;
    activeSession.selectedPersistedAnnotationKey = entry.source === "pdf" ? persistedAnnotationKey(entry.page, entry.sourceId) : null;
    activeSession.selectedAnnotationKind = null;
    activeSession.selectedAnnotationColor = null;
    activeSession.hasSelectedHighlight = false;
    activeSession.selectedHighlightColor = null;
    activeSession.status = `Located ${entry.label.toLowerCase()} on page ${entry.page}.`;
    queueLocateOnlyEditorSelectionClear();
    return true;
  }

  function annotationEntryFocusBox(entry: AnnotationEntry): FocusBox | null {
    const pageElement = activeSession.viewerEl?.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
    if (!pageElement || !entry.bounds) return null;
    return {
      left: pageElement.offsetLeft + entry.bounds.left * pageElement.offsetWidth - 3,
      top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight - 3,
      width: Math.max(6, (entry.bounds.right - entry.bounds.left) * pageElement.offsetWidth + 6),
      height: Math.max(6, (entry.bounds.bottom - entry.bounds.top) * pageElement.offsetHeight + 6),
    };
  }

  function renderedAnnotationShapeFocusBox(entry: AnnotationEntry): FocusBox | null {
    if (!isInkHighlightEntry(entry) || !activeSession.containerEl) return null;
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
    const containerRect = activeSession.containerEl.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left + activeSession.containerEl.scrollLeft - 3,
      top: rect.top - containerRect.top + activeSession.containerEl.scrollTop - 3,
      width: Math.max(6, rect.right - rect.left + 6),
      height: Math.max(6, rect.bottom - rect.top + 6),
    };
  }

  function clearLocateOnlyEditorSelection() {
    unselectAllIgnoringPdfjsSignalBug();
    setPdfjsEditorMode(activeSession.activeTool);
    activeSession.containerEl.querySelectorAll<HTMLElement>(".editToolbar:not(.hidden)").forEach((toolbar) => {
      toolbar.classList.add("hidden");
    });
    activeSession.containerEl.querySelectorAll<HTMLElement>(".selectedEditor").forEach((editor) => {
      editor.classList.remove("selectedEditor");
    });
  }

  function queueLocateOnlyEditorSelectionClear() {
    for (const delay of [0, 50, 150]) {
      setTimeout(() => {
        if (!activeSession.selectedAnnotationKind && activeSession.annotationFocusBox) {
          clearLocateOnlyEditorSelection();
        }
      }, delay);
    }
  }

  async function activatePersistedEditorEntry(
    entry: AnnotationEntry,
    options: { enterEditMode?: boolean; scrollIntoView?: boolean } = {},
  ) {
    const manager = activeSession.annotationEditorUIManager;
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
      activeSession.annotationEditorUIManager !== manager ||
      !managerHasValidSignal(manager) ||
      !editorBelongsToManager(editor, manager) ||
      !editorHasValidManagerSignal(editor)
    ) {
      return false;
    }
    const persistedKey = persistedAnnotationKey(entry.page, entry.sourceId);
    activeSession.selectedPersistedAnnotationKey = persistedKey;
    activeSession.persistedAnnotationKeyByEditorId.set(editor.id, persistedKey);
    await focusEditorById(editor.id, { scrollIntoView: options.scrollIntoView, showFocusBox: false });
    selectEditorIgnoringPdfjsSignalBug(manager, editor);
    syncSelectedEditorState(persistedKey);
    activeSession.selectedAnnotationEntryId = entry.id;
    if (editorKind === "highlight") {
      activeSession.status = "Selected highlight. Change color or delete it, then save.";
    } else if (editorKind === "freetext") {
      if (options.enterEditMode) {
        enterFreeTextEditMode(editor);
        activeSession.status = "Editing free text. Press Enter to finish editing.";
      } else {
        activeSession.status = "Selected free text. Press Enter to edit text, change color, or delete it.";
      }
    } else {
      activeSession.status = "Selected ink. Change color or delete it, then save.";
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
    manager = activeSession.annotationEditorUIManager,
  ) {
    if (!manager || !activeSession.pdfDocument) return null;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
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
    if (!editor || !activeSession.annotationEditorUIManager) return false;
    return editorBelongsToManager(editor, activeSession.annotationEditorUIManager);
  }

  function unselectAllIgnoringPdfjsSignalBug(manager = activeSession.annotationEditorUIManager) {
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
    return [...activeSession.containerEl.querySelectorAll<HTMLElement>(selector)]
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
    const containerRect = activeSession.containerEl.getBoundingClientRect();
    const left = rect.left - containerRect.left + activeSession.containerEl.scrollLeft - 3;
    const top = rect.top - containerRect.top + activeSession.containerEl.scrollTop - 3;
    const width = rect.width + 6;
    const height = rect.height + 6;

    if (options.scrollIntoView !== false) {
      activeSession.containerEl.scrollLeft = Math.max(0, left + width / 2 - activeSession.containerEl.clientWidth / 2);
      activeSession.containerEl.scrollTop = Math.max(0, top + height / 2 - activeSession.containerEl.clientHeight / 2);
    }
    if (options.showFocusBox !== false) {
      activeSession.annotationFocusBox = { left, top, width, height };
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
    if (!activeSession.pdfViewer) return;
    activeSession.activeTool = tool;
    setPdfjsEditorMode(tool);
    activeSession.status =
      tool === "none"
        ? "Selection mode."
        : tool === "highlight"
          ? "Highlight mode. Drag across text to create a highlight."
          : `${toolLabel(tool)} mode. Create an annotation, then save.`;
  }

  function setPdfjsEditorMode(tool: EditorTool, options: { applyDefaultParams?: boolean } = {}) {
    if (!activeSession.pdfViewer) return;
    const applyDefaultParams = options.applyDefaultParams !== false;
    if (applyDefaultParams && tool === "highlight" && activeSession.annotationEditorUIManager) {
      activeSession.annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        highlightColors[defaultHighlightColor],
      );
    }
    activeSession.pdfViewer.annotationEditorMode = { mode: editorModes[tool] };
    if (applyDefaultParams && tool === "text" && activeSession.annotationEditorUIManager) {
      activeSession.annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
        freeTextColors[defaultFreeTextColor],
      );
      activeSession.annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.FREETEXT_SIZE,
        defaultFreeTextFontSize,
      );
    }
    if (applyDefaultParams && tool === "ink" && activeSession.annotationEditorUIManager) {
      activeSession.annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
        { color: inkColors[defaultInkColor], opacity: defaultInkOpacity },
      );
      activeSession.annotationEditorUIManager.updateParams(
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
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = activeSession.selectedPersistedAnnotationKey;
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
        if (selectedEditorMatchesPersistedHint(activeSession.annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)) {
          activeSession.status = "Selected highlight. Change color or delete it, then save.";
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    activeSession.status = "Could not activate clicked highlight for editing.";
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
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) {
      return null;
    }
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
        if (editorBelongsToCurrentManager(editor) && predicate(editor) && !editor.deleted && editor.id === editorId) {
          return editor;
        }
      }
    }
    return null;
  }

  async function activateExistingHighlightEditor(editorId: string, options: { focusEditor?: boolean } = {}) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("highlight");
    let editor = findHighlightEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findHighlightEditorById(editorId);
    }
    if (!editor) {
      activeSession.status = "Could not activate clicked highlight for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    activeSession.annotationEditorUIManager.setSelected(editor);
    activeSession.selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    activeSession.status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  function enterFreeTextEditMode(editor: AnnotationEditor) {
    editor.enterInEditMode?.();
  }

  async function activateExistingFreeTextEditor(editorId: string, options: { enterEditMode?: boolean; focusEditor?: boolean } = {}) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Free text unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("text");
    let editor = findFreeTextEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findFreeTextEditorById(editorId);
    }
    if (!editor) {
      activeSession.status = "Could not activate clicked free text for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    activeSession.annotationEditorUIManager.setSelected(editor);
    activeSession.selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    if (options.enterEditMode) {
      enterFreeTextEditMode(editor);
      activeSession.status = "Editing free text. Press Enter to finish editing.";
    } else {
      activeSession.status = "Selected free text. Press Enter to edit text, change color, or delete it.";
    }
    return true;
  }

  async function activateFreeTextEditorAtPoint(
    clientX: number,
    clientY: number,
    options: { enterEditMode?: boolean } = {},
  ) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Free text unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = activeSession.selectedPersistedAnnotationKey;
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
          activeSession.annotationEditorUIManager.setSelected(editor);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        syncSelectedEditorState(persistedKeyHint);
        if (
          isFreeTextEditor(activeSession.annotationEditorUIManager.firstSelectedEditor) &&
          selectedEditorMatchesPersistedHint(activeSession.annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)
        ) {
          if (options.enterEditMode) {
            enterFreeTextEditMode(activeSession.annotationEditorUIManager.firstSelectedEditor);
            activeSession.status = "Editing free text. Press Enter to finish editing.";
          } else {
            activeSession.status = "Selected free text. Press Enter to edit text, change color, or delete it.";
          }
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    activeSession.status = "Could not activate clicked free text for editing.";
    return false;
  }

  async function activateExistingInkEditor(editorId: string, options: { focusEditor?: boolean } = {}) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Ink unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    await preparePdfjsEditorModeForEdit("ink");
    let editor = findInkEditorById(editorId);
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findInkEditorById(editorId);
    }
    if (!editor) {
      activeSession.status = "Could not activate clicked ink for editing.";
      return false;
    }
    if (options.focusEditor !== false) {
      await focusEditorById(editor.id);
    }
    activeSession.annotationEditorUIManager.setSelected(editor);
    activeSession.selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    activeSession.status = "Selected ink. Change color or delete it, then save.";
    return true;
  }

  async function activateInkEditorAtPoint(clientX: number, clientY: number) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfViewer) {
      activeSession.status = "Ink unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const persistedKeyHint = activeSession.selectedPersistedAnnotationKey;
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
          activeSession.annotationEditorUIManager.setSelected(editor);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        syncSelectedEditorState(persistedKeyHint);
        if (
          isInkEditor(activeSession.annotationEditorUIManager.firstSelectedEditor) &&
          selectedEditorMatchesPersistedHint(activeSession.annotationEditorUIManager.firstSelectedEditor, persistedKeyHint)
        ) {
          activeSession.status = "Selected ink. Change color or delete it, then save.";
          return true;
        }
        unselectAllIgnoringPdfjsSignalBug();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    activeSession.status = "Could not activate clicked ink for editing.";
    return false;
  }

  function findEditorElementIdAtPoint(selector: string, clientX: number, clientY: number) {
    const matchingEditors = [...activeSession.containerEl.querySelectorAll<HTMLElement>(selector)]
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
    const visualMatches = activeSession.annotationEntries
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

    const boundsMatches = activeSession.annotationEntries
      .filter((entry) => entry.kind === "ink" && predicate(entry) && entry.bounds)
      .map((entry) => {
        const pageElement = activeSession.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
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
    const matches = activeSession.annotationEntries
      .filter((entry) => entry.kind !== "ink" && entry.bounds)
      .map((entry) => {
        const pageElement = activeSession.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
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
    let selectedEditor: AnnotationEditor | null | undefined = activeSession.annotationEditorUIManager?.firstSelectedEditor;
    if (!selectedEditor && activeSession.annotationEditorUIManager) {
      selectedEditor =
        findEditorByPersistedSourceId(entry.sourceId, "highlight") ??
        findEditorByPersistedSourceId(entry.sourceId, "ink");
      if (selectedEditor) {
        activeSession.annotationEditorUIManager.setSelected(selectedEditor);
      }
    }
    const persistedKey = persistedAnnotationKey(entry.page, entry.sourceId);
    activeSession.selectedAnnotationKind = "highlight";
    activeSession.hasSelectedHighlight = true;
    activeSession.selectedAnnotationEntryId = entry.id;
    activeSession.selectedPersistedAnnotationKey = persistedKey;
    activeSession.selectedAnnotationColor = selectedEditor?.color ?? activeSession.selectedAnnotationColor;
    activeSession.selectedHighlightColor = highlightColorNameForValue(activeSession.selectedAnnotationColor);
    if (selectedEditor) {
      activeSession.persistedAnnotationKeyByEditorId.set(selectedEditor.id, persistedKey);
    }
    activeSession.status = "Selected highlight. Change color or delete it, then save.";
  }

  function remapSelectedInkHighlightEntry() {
    const entry =
      persistedAnnotationEntryForKey(activeSession.selectedPersistedAnnotationKey) ??
      activeSession.annotationEntries.find((candidate) => candidate.id === activeSession.selectedAnnotationEntryId);
    if (!entry || !isInkHighlightEntry(entry)) {
      return false;
    }
    markInkHighlightEntrySelected(entry);
    return true;
  }

  function activateInkHighlightEntryAtPoint(entry: AnnotationEntry, clientX: number, clientY: number) {
    activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
    void (async () => {
      let activated = false;
      if (findInkEditorIdAtPoint(clientX, clientY)) {
        activated = await activateInkEditorAtPoint(clientX, clientY);
      }
      if (!activated) {
        activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
        activated = await activateHighlightEditorAtPoint(clientX, clientY);
      }
      if (!activated) {
        activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(entry.page, entry.sourceId);
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
          activeSession.selectedAnnotationKind = "highlight";
          activeSession.hasSelectedHighlight = true;
          activeSession.selectedAnnotationEntryId = directInkHighlightEntry.id;
          activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(
            directInkHighlightEntry.page,
            directInkHighlightEntry.sourceId,
          );
          activeSession.status = "Selected highlight. Change color or delete it, then save.";
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
      void activateExistingFreeTextEditor(directFreeTextEditorId, { enterEditMode: true, focusEditor: false });
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
      void activateFreeTextEditorAtPoint(clientX, clientY, { enterEditMode: true });
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
        void activateExistingFreeTextEditor(entry.sourceId, { enterEditMode: true, focusEditor: false });
      } else {
        void activateExistingInkEditor(entry.sourceId, { focusEditor: false });
      }
      return true;
    }
    if (isInkHighlightEntry(entry)) {
      activateInkHighlightEntryAtPoint(entry, clientX, clientY);
      return true;
    }
    void activatePdfAnnotationEntry(entry, { enterEditMode: entry.kind === "freetext", scrollIntoView: false });
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
    if (!(target instanceof Element) || activeSession.activeTool !== "highlight") {
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
    if (clickedEntry && (!activeSession.selectedAnnotationKind || !annotationEntryMatchesCurrentSelection(clickedEntry))) {
      if (isRepeatedAnnotationPointerClick(clickedEntry, event)) {
        activeSession.lastAnnotationPointerClick = null;
        event.preventDefault();
        event.stopPropagation();
        activateAnnotationEntryForEdit(clickedEntry, event.clientX, event.clientY);
        return;
      }
      // In pure creation mode, only a pointer that landed on an annotation
      // *visual* (free-text glyphs, ink strokes, sections — the DOM-target
      // hits pinned by the double-click-edit specs) reserves the click for
      // select/edit. Entries matched purely by geometry (the pointer target
      // is the bare text/drawing layer inside an annotation's rect) must not
      // block the active tool from creating there. Live highlight editors
      // are rect-sized interactive surfaces, not thin visuals, so they don't
      // reserve the click either — highlights stay reachable via double
      // click in selection mode and via the sidebar.
      const pointerHitAnnotationVisual = Boolean(
        (editableEditor && !editableEditor.classList.contains("highlightEditor")) ||
          directDisabledEditorId ||
          savedAnnotation ||
          savedFreeTextAnnotation ||
          savedInkAnnotation,
      );
      if (isAnnotationCreationMode() && !pointerHitAnnotationVisual) {
        activeSession.lastAnnotationPointerClick = null;
        return;
      }
      if (activeSession.selectedAnnotationKind || isAnnotationCreationMode()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    activeSession.lastAnnotationPointerClick = null;
    if (directHighlightEditorId) {
      const directInkHighlightEntry = isAnnotationCreationMode()
        ? null
        : inkHighlightEntryAtPoint(event.clientX, event.clientY);
      if (directInkHighlightEntry) {
        void activateExistingHighlightEditor(directHighlightEditorId, { focusEditor: false }).then((activated) => {
          if (!activated) return;
          activeSession.selectedAnnotationKind = "highlight";
          activeSession.hasSelectedHighlight = true;
          activeSession.selectedAnnotationEntryId = directInkHighlightEntry.id;
          activeSession.selectedPersistedAnnotationKey = persistedAnnotationKey(
            directInkHighlightEntry.page,
            directInkHighlightEntry.sourceId,
          );
          activeSession.status = "Selected highlight. Change color or delete it, then save.";
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
      if (activeSession.annotationFocusBox || activeSession.selectedAnnotationEntryId || activeSession.selectedPersistedAnnotationKey || activeSession.selectedAnnotationKind) {
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
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) {
      return 0;
    }
    let count = 0;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
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
    const uiManager = activeSession.annotationEditorUIManager;
    const viewer = activeSession.pdfViewer;
    if (!uiManager || !viewer) {
      activeSession.status = "Highlight unavailable: PDF.js annotation manager not ready yet.";
      return false;
    }
    const selection = document.getSelection();
    const liveSelectionText = selection?.toString().trim() ?? "";
    const selectionText = liveSelectionText || activeSession.rememberedSelectionText;
    const ranges =
      selection && liveSelectionText
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : activeSession.rememberedSelectionRanges.map((range) => range.cloneRange());
    if (!selectionText || ranges.length === 0) {
      activeSession.status = "Select text in the PDF first, then press Highlight.";
      return false;
    }
    let before = countHighlightEditorsInManager();
    let previousHighlightEditorIds = new Set(highlightEditorIds());
    const switchedIntoHighlightMode = activeSession.activeTool !== "highlight";
    const finishCreatedHighlight = () => {
      cacheNewHighlightDetails(previousHighlightEditorIds, selectionText);
      document.getSelection()?.removeAllRanges();
      if (resetModeToNone) {
        setTool("none");
        unselectAllIgnoringPdfjsSignalBug();
        syncSelectedEditorState();
      }
      activeSession.rememberedSelectionText = "";
      activeSession.rememberedSelectionRanges = [];
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = createdStatus;
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
    activeSession.status = `Creating highlight from ${selectionText.length} selected characters...`;

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
      activeSession.status = "PDF.js could not build highlight geometry from the current selection.";
      return false;
    }
    uiManager.highlightSelection(methodOfCreation);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (countHighlightEditorsInManager() > before) {
        return finishCreatedHighlight();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    activeSession.status = "PDF.js did not create a visible highlight. Try Highlight mode, then drag across text.";
    return false;
  }

  function highlightEditorIds() {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return [];
    const ids: string[] = [];
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted) {
          ids.push(editor.id);
        }
      }
    }
    return ids;
  }

  function cacheNewHighlightDetails(previousIds: Set<string>, detail: string) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
        if (
          isHighlightEditor(editor) &&
          !editor.deleted &&
          !previousIds.has(editor.id) &&
          !persistedSourceIdForEditor(editor)
        ) {
          activeSession.annotationDetailCache.set(`live:${editor.id}`, detail.trim());
        }
      }
    }
  }

  function hasNewUnsavedHighlightEditor(previousIds: Set<string>) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return false;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
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
    return Boolean(selectionText || activeSession.rememberedSelectionText);
  }

  function clearRememberedSelection() {
    activeSession.rememberedSelectionText = "";
    activeSession.rememberedSelectionRanges = [];
  }

  function toggleAnnotationTool(tool: Exclude<EditorTool, "none">, event?: PointerEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (activeSession.activeTool === tool) {
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
    return activeSession.activeTool !== "none" && !activeSession.selectedAnnotationKind;
  }

  function syncInkEditorHitAreas() {
    activeSession.containerEl.querySelectorAll(".ink-hit-area").forEach((element) => element.remove());
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
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
    const firstSelectedEditor = activeSession.annotationEditorUIManager?.firstSelectedEditor;
    const editor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (activeSession.activeTool === "none") {
      const editorKey = persistedAnnotationKeyForEditor(editor);
      const liveKey = editor ? `live:${editor.id}` : null;
      const staleSelection =
        !editor ||
        (activeSession.selectedPersistedAnnotationKey
          ? editorKey !== activeSession.selectedPersistedAnnotationKey
          : activeSession.selectedAnnotationEntryId !== liveKey && !activeSession.selectedAnnotationKind);
      if (staleSelection) {
        if (remapSelectedInkHighlightEntry()) {
          return;
        }
        activeSession.selectedAnnotationKind = null;
        activeSession.selectedAnnotationColor = null;
        activeSession.hasSelectedHighlight = false;
        activeSession.selectedHighlightColor = null;
        activeSession.selectedAnnotationEntryId = null;
        activeSession.selectedPersistedAnnotationKey = null;
        return;
      }
    }
    if (!editor) {
      activeSession.selectedAnnotationKind = null;
      activeSession.selectedAnnotationColor = null;
      activeSession.hasSelectedHighlight = false;
      activeSession.selectedHighlightColor = null;
      activeSession.selectedAnnotationEntryId = null;
      activeSession.selectedPersistedAnnotationKey = null;
      return;
    }
    activeSession.selectedAnnotationKind = annotationKindForEditor(editor);
    if (activeSession.selectedAnnotationKind) {
      activeSession.annotationFocusBox = null;
    }
    activeSession.selectedAnnotationColor = editor.color ?? null;
    activeSession.hasSelectedHighlight = isHighlightEditor(editor);
    activeSession.selectedHighlightColor = activeSession.hasSelectedHighlight ? highlightColorNameForValue(editor?.color ?? null) : null;
    activeSession.selectedAnnotationEntryId = `live:${editor.id}`;
    activeSession.selectedPersistedAnnotationKey = persistedAnnotationKeyForEditor(editor) ?? normalizedPersistedKeyHint;
    if (activeSession.selectedPersistedAnnotationKey) {
      activeSession.persistedAnnotationKeyByEditorId.set(editor.id, activeSession.selectedPersistedAnnotationKey);
    }
    remapSelectedInkHighlightEntry();
  }


  function findFirstHighlightEditor() {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) return null;
    for (let pageIndex = 0; pageIndex < activeSession.pdfDocument.numPages; pageIndex += 1) {
      for (const editor of activeSession.annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted) {
          return editor;
        }
      }
    }
    return null;
  }

  async function selectFirstHighlight() {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) {
      activeSession.status = "No PDF loaded.";
      return false;
    }
    if (activeSession.activeTool !== "highlight") {
      setTool("highlight");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let editor = findFirstHighlightEditor();
    for (let attempt = 0; !editor && attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      editor = findFirstHighlightEditor();
    }
    if (!editor || !activeSession.annotationEditorUIManager) {
      activeSession.status = "No highlight found to select.";
      return false;
    }
    activeSession.annotationEditorUIManager.setSelected(editor);
    activeSession.selectedAnnotationEntryId = `live:${editor.id}`;
    syncSelectedEditorState();
    activeSession.status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  function applyHighlightColor(colorName: HighlightColorName) {
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Highlight color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultHighlightColor = colorName;
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      highlightColors[colorName],
    );
    if (activeSession.hasSelectedHighlight) {
      if (isInkEditor(activeSession.annotationEditorUIManager.firstSelectedEditor)) {
        activeSession.annotationEditorUIManager.updateParams(
          pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
          { color: highlightColors[colorName], opacity: defaultInkOpacity },
        );
      }
      activeSession.selectedHighlightColor = colorName;
      activeSession.selectedAnnotationColor = highlightColors[colorName];
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = `Changed selected highlight to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeSession.activeTool !== "highlight") {
      syncSelectedEditorState();
      activeSession.status = `Default highlight color set to ${colorName}.`;
      return;
    }
    activeSession.status = `Next highlight will use ${colorName}.`;
  }


  function applyFreeTextColor(colorName: FreeTextColorName) {
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Free text color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultFreeTextColor = colorName;
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
      freeTextColors[colorName],
    );
    if (activeSession.selectedAnnotationKind === "freetext") {
      activeSession.selectedAnnotationColor = freeTextColors[colorName];
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = `Changed selected free text to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeSession.activeTool !== "text") {
      syncSelectedEditorState();
      activeSession.status = `Default free-text color set to ${colorName}.`;
      return;
    }
    activeSession.status = `Next free text will use ${colorName}.`;
  }

  function applyInkColor(colorName: InkColorName) {
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Ink color unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkColor = colorName;
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
      { color: inkColors[colorName], opacity: defaultInkOpacity },
    );
    if (activeSession.selectedAnnotationKind === "ink") {
      activeSession.selectedAnnotationColor = inkColors[colorName];
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = `Changed selected ink to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    if (activeSession.activeTool !== "ink") {
      syncSelectedEditorState();
      activeSession.status = `Default ink color set to ${colorName}.`;
      return;
    }
    activeSession.status = `Next ink will use ${colorName}.`;
  }

  function isHighlightSwatchActive(colorName: string) {
    return (activeSession.hasSelectedHighlight ? activeSession.selectedHighlightColor : defaultHighlightColor) === colorName;
  }

  function isFreeTextSwatchActive(colorName: string) {
    return activeSession.activeTool === "text" && (freeTextColorNameForValue(activeSession.selectedAnnotationColor) ?? defaultFreeTextColor) === colorName;
  }

  function isInkSwatchActive(colorName: string) {
    return activeSession.activeTool === "ink" && (inkColorNameForValue(activeSession.selectedAnnotationColor) ?? defaultInkColor) === colorName;
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
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Ink thickness unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkThickness = thickness;
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
      thickness,
    );
    if (activeSession.selectedAnnotationKind === "ink") {
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = `Changed selected ink thickness to ${thickness}. Save to persist it into the PDF.`;
      return;
    }
    if (activeSession.activeTool !== "ink") {
      syncSelectedEditorState();
      activeSession.status = `Default ink thickness set to ${thickness}.`;
      return;
    }
    activeSession.status = `Next ink thickness will be ${thickness}.`;
  }

  function applyInkMarkerPreset() {
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Ink marker unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    defaultInkColor = "yellow";
    defaultInkThickness = 14;
    defaultInkOpacity = 0.45;
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_COLOR_AND_OPACITY,
      // Marker preset is highlighter-intent ink (ADR 0012): it uses the pastel
      // highlight yellow, not the saturated ink yellow.
      { color: highlightColors.yellow, opacity: defaultInkOpacity },
    );
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
      defaultInkThickness,
    );
    if (activeSession.selectedAnnotationKind === "ink") {
      activeSession.selectedAnnotationColor = highlightColors.yellow;
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = "Changed selected ink to marker. Save to persist it into the PDF.";
      return;
    }
    if (activeSession.activeTool !== "ink") {
      syncSelectedEditorState();
      activeSession.status = "Marker preset selected.";
      return;
    }
    activeSession.status = "Marker preset selected.";
  }

  function deleteSelectedAnnotation() {
    const manager = activeSession.annotationEditorUIManager;
    const firstSelectedEditor = manager?.firstSelectedEditor;
    const selectedEditor = editorBelongsToCurrentManager(firstSelectedEditor) ? firstSelectedEditor : null;
    if (!manager || !selectedEditor) {
      activeSession.status = "Select an annotation first, then delete it.";
      return false;
    }
    if (activeSession.selectedPersistedAnnotationKey && persistedAnnotationKeyForEditor(selectedEditor) !== activeSession.selectedPersistedAnnotationKey) {
      const persistedSelection = persistedAnnotationKeyParts(activeSession.selectedPersistedAnnotationKey);
      const expectedEditor =
        persistedSelection && activeSession.selectedAnnotationKind
          ? findEditorByPersistedSourceId(persistedSelection.sourceId, activeSession.selectedAnnotationKind, manager)
          : null;
      if (expectedEditor && editorBelongsToManager(expectedEditor, manager) && expectedEditor.remove) {
        const wasHighlight = activeSession.selectedAnnotationKind === "highlight";
        const wasFreeText = activeSession.selectedAnnotationKind === "freetext";
        activeSession.pendingDeletedPersistedAnnotationKeys.add(activeSession.selectedPersistedAnnotationKey);
        expectedEditor.remove();
        activeSession.selectedAnnotationKind = null;
        activeSession.selectedAnnotationColor = null;
        activeSession.hasSelectedHighlight = false;
        activeSession.selectedHighlightColor = null;
        activeSession.selectedAnnotationEntryId = null;
        activeSession.selectedPersistedAnnotationKey = null;
        activeSession.isDirty = true;
        void refreshAnnotationSidebar();
        queueEditorStateRefresh(100, 250, 500);
        activeSession.status = wasHighlight
          ? "Deleted selected highlight. Save to persist it into the PDF."
          : wasFreeText
            ? "Deleted selected free text. Save to persist it into the PDF."
            : "Deleted selected annotation. Save to persist it into the PDF.";
        return true;
      }
      if (
        !activeSession.selectedAnnotationKind ||
        !persistedSelection ||
        !isPersistedAnnotationHidden(persistedSelection.pageNumber, persistedSelection.sourceId)
      ) {
        activeSession.status = "Selected annotation changed before delete. Select it again, then delete.";
        return false;
      }
      activeSession.pendingDeletedPersistedAnnotationKeys.add(activeSession.selectedPersistedAnnotationKey);
      activeSession.selectedAnnotationKind = null;
      activeSession.selectedAnnotationColor = null;
      activeSession.hasSelectedHighlight = false;
      activeSession.selectedHighlightColor = null;
      activeSession.selectedAnnotationEntryId = null;
      activeSession.selectedPersistedAnnotationKey = null;
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(100, 250, 500);
      activeSession.status = "Deleted selected annotation. Save to persist it into the PDF.";
      return true;
    }
    const wasHighlight = isHighlightEditor(selectedEditor);
    const wasFreeText = isFreeTextEditor(selectedEditor);
    const pendingDeleteKey = persistedAnnotationKeyForEditor(selectedEditor) ?? activeSession.selectedPersistedAnnotationKey;
    if (pendingDeleteKey) {
      activeSession.pendingDeletedPersistedAnnotationKeys.add(pendingDeleteKey);
    }
    manager.delete();
    activeSession.selectedAnnotationKind = null;
    activeSession.selectedAnnotationColor = null;
    activeSession.hasSelectedHighlight = false;
    activeSession.selectedHighlightColor = null;
    activeSession.selectedAnnotationEntryId = null;
    activeSession.selectedPersistedAnnotationKey = null;
    activeSession.isDirty = true;
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(100, 250, 500);
    activeSession.status = wasHighlight
      ? "Deleted selected highlight. Save to persist it into the PDF."
      : wasFreeText
        ? "Deleted selected free text. Save to persist it into the PDF."
        : "Deleted selected annotation. Save to persist it into the PDF.";
    return true;
  }

  function selectFirstText() {
    const spans = [...activeSession.containerEl.querySelectorAll<HTMLElement>(".textLayer span")];
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

  function moveSelectedAnnotation(x: number, y: number) {
    if (!activeSession.annotationEditorUIManager?.firstSelectedEditor) {
      return false;
    }
    const movableManager = activeSession.annotationEditorUIManager as AnnotationEditorUIManager & {
      translateSelectedEditors?: (x: number, y: number, noCommit?: boolean) => void;
    };
    movableManager.translateSelectedEditors?.(x, y, true);
    syncSelectedEditorState();
    activeSession.isDirty = true;
    void refreshAnnotationSidebar();
    return true;
  }

  function zoomIn() {
    if (!activeSession.pdfViewer) return;
    activeSession.pdfViewer.currentScale = Math.min(activeSession.pdfViewer.currentScale * 1.1, 5);
    activeSession.scaleLabel = `${Math.round(activeSession.pdfViewer.currentScale * 100)}%`;
  }

  function zoomOut() {
    if (!activeSession.pdfViewer) return;
    activeSession.pdfViewer.currentScale = Math.max(activeSession.pdfViewer.currentScale / 1.1, 0.2);
    activeSession.scaleLabel = `${Math.round(activeSession.pdfViewer.currentScale * 100)}%`;
  }

  function fitWidth() {
    if (!activeSession.pdfViewer) return;
    activeSession.pdfViewer.currentScaleValue = "page-width";
    activeSession.scaleLabel = "Fit Width";
  }

  async function savePdf() {
    if (!activeSession.currentPath) {
      await savePdfAs();
      return;
    }
    await persistPdf(activeSession.currentPath);
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
    if (!activeSession.pdfDocument) return;

    activeSession.isBusy = true;
    activeSession.status = "Saving annotations into PDF...";
    try {
      const saved = await savePdfDocumentBytes();
      await invoke("write_pdf_atomic", {
        path,
        bytes: Array.from(saved),
      });
      activeSession.currentPath = path;
      activeSession.isDirty = false;
      await refreshAnnotationSidebar();
      activeSession.status = `Saved ${path}`;
    } catch (error) {
      activeSession.status = `Save failed: ${formatError(error)}`;
    } finally {
      activeSession.isBusy = false;
    }
  }

  async function savePdfDocumentBytes() {
    if (!activeSession.pdfDocument) throw new Error("No PDF loaded");
    const saved = new Uint8Array(await activeSession.pdfDocument.saveDocument());
    return writePdfOutlineState(saved, {
      bookmarkRootTitle,
      bookmarks: activeSession.bookmarkEntries,
      documentOutlineEntries: activeSession.outlineEntries,
    });
  }

  async function createPageFreeText(text = "Regression free text", pageNumber = 1) {
    if (!activeSession.annotationEditorUIManager || !activeSession.pdfDocument) {
      throw new Error("No PDF loaded");
    }
    setTool("text");
    await new Promise((resolve) => setTimeout(resolve, 100));
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR,
      freeTextColors[defaultFreeTextColor],
    );
    const pageElement = activeSession.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      activeSession.containerEl.scrollTop = Math.max(pageElement.offsetTop - 20, 0);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const layerElement = activeSession.containerEl.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .annotationEditorLayer`,
    );
    if (!layerElement) {
      throw new Error(`No annotation editor layer for page ${pageNumber}`);
    }
    const rect = layerElement.getBoundingClientRect();
    const layer = activeSession.annotationEditorUIManager.findParent(rect.x + 20, rect.y + 20);
    if (!layer) {
      throw new Error(`No editor layer instance for page ${pageNumber}`);
    }
    const createdEditor = layer.createAndAddNewEditor({ offsetX: 160, offsetY: 220 }, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editor = activeSession.containerEl.querySelector<HTMLElement>(
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
    activeSession.isDirty = true;
    void refreshAnnotationSidebar();
    queueEditorStateRefresh(150, 500);
    return true;
  }

  async function editSelectedFreeText(text: string) {
    const editor = activeSession.annotationEditorUIManager?.firstSelectedEditor;
    if (!isFreeTextEditor(editor)) {
      activeSession.status = "Select free text first, then edit it.";
      return false;
    }
    if (activeSession.activeTool !== "text") {
      await preparePdfjsEditorModeForEdit("text");
      activeSession.annotationEditorUIManager?.setSelected(editor);
    }
    editor.enterInEditMode?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editorElement = document.getElementById(editor.id);
    const textElement = editorElement?.querySelector<HTMLElement>(".internal, [contenteditable='true']");
    if (!textElement) {
      activeSession.status = "Could not find selected free-text editor content.";
      return false;
    }
    textElement.focus();
    // Match pdf.js #setContent's one-div-per-line DOM; a bare text node with
    // "\n" in it would get its lines merged by #extractText on commit.
    textElement.replaceChildren(
      ...text.split("\n").map((line) => {
        const lineDiv = document.createElement("div");
        lineDiv.append(line ? document.createTextNode(line) : document.createElement("br"));
        return lineDiv;
      }),
    );
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
    activeSession.annotationDetailCache.delete(`live:${editor.id}`);
    const persistedEntry = persistedAnnotationEntryForKey(
      activeSession.selectedPersistedAnnotationKey ?? persistedAnnotationKeyForEditor(editor),
    );
    if (persistedEntry) {
      activeSession.annotationDetailCache.delete(persistedEntry.id);
    }
    activeSession.isDirty = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
    syncSelectedEditorState();
    await refreshAnnotationSidebar();
    queueEditorStateRefresh(500);
    activeSession.status = "Edited selected free text. Save to persist it into the PDF.";
    return true;
  }

  function teardownViewer() {
    teardownSessionViewer(activeSession);
  }

  function defaultSavePath() {
    if (!activeSession.currentPath) return "annotated.pdf";
    return activeSession.currentPath.replace(/\.pdf$/i, "-annotated.pdf");
  }

  function toolLabel(tool: EditorTool) {
    if (tool === "text") return "Free text";
    if (tool === "highlight") return "Highlight";
    return tool[0].toUpperCase() + tool.slice(1);
  }


  // ---- Official-app shell: dock state, tab drag-docking, header ----

  const EDGE_DOCK_PX = 38;
  const DRAG_START_PX = 4;
  const dockSides: SidebarSide[] = ["left", "right"];

  let dock = $state(createDefaultDockState());
  let draggingTab = $state<SidebarTabId | null>(null);
  let dropTargetSide = $state<SidebarSide | null>(null);
  let dragGhost = $state<{ x: number; y: number } | null>(null);
  let zoomPercent = $state(100);

  // Pointer-drag session bookkeeping; intentionally non-reactive (updated on
  // pointermove).
  let dragSession: { tab: SidebarTabId; startX: number; startY: number; started: boolean } | null =
    null;
  let suppressNextTabClick = false;
  let menuControls: AppMenuControls | null = null;

  const SIDEBAR_WIDTHS_STORAGE_KEY = "chive.sidebarWidths";
  let sidebarWidths = $state<SidebarWidths>(
    parseSidebarWidths(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SIDEBAR_WIDTHS_STORAGE_KEY),
    ),
  );
  let resizingSide = $state<SidebarSide | null>(null);
  let resizeSession: { side: SidebarSide; startX: number; startWidth: number } | null = null;

  const workspaceColumns = $derived(
    `${isSideOpen(dock, "left") ? `${sidebarWidths.left}px` : "0"} minmax(0, 1fr) ${
      isSideOpen(dock, "right") ? `${sidebarWidths.right}px` : "0"
    }`,
  );

  function handleResizerPointerDown(side: SidebarSide, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeSession = { side, startX: event.clientX, startWidth: sidebarWidths[side] };
    resizingSide = side;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  }

  function handleResizerPointerMove(event: PointerEvent) {
    if (!resizeSession) return;
    sidebarWidths = {
      ...sidebarWidths,
      [resizeSession.side]: resizedSidebarWidth(
        resizeSession.side,
        resizeSession.startWidth,
        resizeSession.startX,
        event.clientX,
      ),
    };
  }

  function handleResizerPointerUp() {
    if (!resizeSession) return;
    resizeSession = null;
    resizingSide = null;
    try {
      localStorage.setItem(SIDEBAR_WIDTHS_STORAGE_KEY, serializeSidebarWidths(sidebarWidths));
    } catch {
      // Persisting the width is best-effort; resizing still works this session.
    }
  }

  const fileName = $derived(
    activeSession.currentPath ? (activeSession.currentPath.split("/").pop() ?? activeSession.currentPath) : "No document",
  );

  $effect(() => {
    void menuControls?.setSaveEnabled(Boolean(activeSession.pdfDocument));
  });

  function activateDockTab(tab: SidebarTabId) {
    dock = activateTab(dock, tab);
    if (tab === "annotations") {
      queueAnnotationSidebarRefresh(0);
      queueAnnotationSidebarRefresh(300);
      queueAnnotationSidebarRefresh(1000);
    }
  }

  function dockSideAtPoint(x: number, y: number): SidebarSide | null {
    const strip = document
      .elementFromPoint(x, y)
      ?.closest?.("[data-tab-strip]") as HTMLElement | null;
    const stripSide = strip?.dataset.tabStrip;
    if (stripSide === "left" || stripSide === "right") return stripSide;
    if (x <= EDGE_DOCK_PX) return "left";
    if (window.innerWidth - x <= EDGE_DOCK_PX) return "right";
    return null;
  }

  function dropBeforeTab(
    draggedTab: SidebarTabId,
    side: SidebarSide,
    x: number,
  ): SidebarTabId | null {
    const strip = document.querySelector(`[data-tab-strip="${side}"]`);
    if (!strip) return null;
    const buttons = Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'));
    const hit = buttons.find((button) => {
      if (button.dataset.tab === draggedTab) return false;
      const rect = button.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    const tab = hit?.dataset.tab;
    return tab === "outline" || tab === "bookmarks" || tab === "annotations" ? tab : null;
  }

  function handleTabPointerDown(tab: SidebarTabId, event: PointerEvent) {
    if (event.button !== 0) return;
    dragSession = { tab, startX: event.clientX, startY: event.clientY, started: false };
    window.addEventListener("pointermove", handleDragPointerMove);
    window.addEventListener("pointerup", handleDragPointerUp);
    window.addEventListener("pointercancel", handleDragPointerCancel);
  }

  function handleDragPointerMove(event: PointerEvent) {
    if (!dragSession) return;
    if (!dragSession.started) {
      const distance = Math.hypot(
        event.clientX - dragSession.startX,
        event.clientY - dragSession.startY,
      );
      if (distance < DRAG_START_PX) return;
      dragSession.started = true;
      draggingTab = dragSession.tab;
    }
    event.preventDefault();
    dropTargetSide = dockSideAtPoint(event.clientX, event.clientY);
    dragGhost = { x: event.clientX, y: event.clientY };
  }

  function handleDragPointerUp(event: PointerEvent) {
    const session = dragSession;
    const targetSide = dropTargetSide;
    endDragSession();
    if (!session?.started) return;
    suppressNextTabClick = true;
    if (targetSide) {
      dock = moveTabToSide(
        dock,
        session.tab,
        targetSide,
        dropBeforeTab(session.tab, targetSide, event.clientX),
      );
    }
  }

  function handleDragPointerCancel() {
    const started = dragSession?.started ?? false;
    endDragSession();
    if (started) suppressNextTabClick = true;
  }

  function endDragSession() {
    dragSession = null;
    draggingTab = null;
    dropTargetSide = null;
    dragGhost = null;
    window.removeEventListener("pointermove", handleDragPointerMove);
    window.removeEventListener("pointerup", handleDragPointerUp);
    window.removeEventListener("pointercancel", handleDragPointerCancel);
  }

  function handleTabClick(tab: SidebarTabId) {
    if (suppressNextTabClick) {
      suppressNextTabClick = false;
      return;
    }
    activateDockTab(tab);
  }

  // ---- Official-app toolbar: global color model, plate, tool popovers ----

  let annotationColorName = $state<AnnotationColorName>("yellow");
  let headerColorNames = $state<AnnotationColorName[]>([...defaultHeaderColorNames]);
  let colorPlate = $state<{ slotIndex: number; anchor: DOMRect } | null>(null);
  let toolPopover = $state<{ tool: "text" | "ink"; anchor: DOMRect } | null>(null);
  let defaultFreeTextFontSize = $state(14);

  const headerColorEntries = $derived(headerColorNames.map((name) => annotationPaletteEntry(name)));

  $effect(() => {
    if (toolPopover && activeSession.activeTool !== toolPopover.tool) {
      toolPopover = null;
    }
  });

  // One global annotation color (ui-spec): selecting a header swatch updates
  // the defaults for all three tools, and recolors the current selection (or
  // pushes pdf.js default params for the active tool) through the existing
  // per-kind paths. The per-kind functions stay separate on purpose — they
  // carry kind-specific quirk handling.
  function applyAnnotationColor(name: AnnotationColorName) {
    annotationColorName = name;
    defaultHighlightColor = name;
    defaultFreeTextColor = name;
    defaultInkColor = name;
    if (!activeSession.annotationEditorUIManager) return;
    if (activeSession.hasSelectedHighlight) applyHighlightColor(name);
    else if (activeSession.selectedAnnotationKind === "freetext") applyFreeTextColor(name);
    else if (activeSession.selectedAnnotationKind === "ink") applyInkColor(name);
    else if (activeSession.activeTool === "highlight") applyHighlightColor(name);
    else if (activeSession.activeTool === "text") applyFreeTextColor(name);
    else if (activeSession.activeTool === "ink") applyInkColor(name);
    else activeSession.status = `Annotation color set to ${name}.`;
  }

  function applyFreeTextFontSize(size: number) {
    defaultFreeTextFontSize = size;
    if (!activeSession.annotationEditorUIManager) {
      activeSession.status = "Free text size unavailable: PDF.js annotation manager not ready yet.";
      return;
    }
    activeSession.annotationEditorUIManager.updateParams(
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_SIZE,
      size,
    );
    if (activeSession.selectedAnnotationKind === "freetext") {
      activeSession.isDirty = true;
      void refreshAnnotationSidebar();
      queueEditorStateRefresh(150, 500);
      activeSession.status = `Changed selected free text size to ${size}. Save to persist it into the PDF.`;
      return;
    }
    activeSession.status = `Free text size set to ${size}px.`;
  }

  function handleToolbarToggle(tool: Exclude<EditorTool, "none">, event: PointerEvent) {
    const anchor = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null;
    toggleAnnotationTool(tool, event);
    const popoverTool = activeSession.activeTool === "text" || activeSession.activeTool === "ink" ? activeSession.activeTool : null;
    toolPopover =
      popoverTool && anchor && popoverTool === tool ? { tool: popoverTool, anchor } : null;
  }

  function openColorPlate(slotIndex: number, anchor: HTMLElement) {
    toolPopover = null;
    colorPlate = { slotIndex, anchor: anchor.getBoundingClientRect() };
  }

  function chooseColorFromPlate(name: AnnotationColorName) {
    const slot = colorPlate;
    colorPlate = null;
    if (!slot) return;
    headerColorNames = headerColorNames.map((existing, index) =>
      index === slot.slotIndex ? name : existing,
    );
    applyAnnotationColor(name);
  }
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="file">{fileName}</span>
      {#if activeSession.isDirty}
        <span class="dirty-dot" role="img" aria-label="Unsaved changes"></span>
      {/if}
    </div>
    <div class="toolbar" aria-label="Reader toolbar">
      <Toolbar
        canAnnotate={Boolean(activeSession.pdfDocument)}
        activeTool={activeSession.activeTool}
        headerColors={headerColorEntries}
        selectedColorName={annotationColorName}
        onToggleTool={handleToolbarToggle}
        onSelectColor={applyAnnotationColor}
        onOpenPlate={openColorPlate}
      />
      <button class="icon-btn" onclick={zoomOut} disabled={!activeSession.pdfDocument} aria-label="Zoom out">
        −
      </button>
      <span class="zoom-value">{activeSession.zoomPercent}%</span>
      <button class="icon-btn" onclick={zoomIn} disabled={!activeSession.pdfDocument} aria-label="Zoom in">
        +
      </button>
    </div>
  </header>

  <main
    class="workspace"
    class:no-left={!isSideOpen(dock, "left")}
    class:has-right={isSideOpen(dock, "right")}
    class:is-resizing={resizingSide !== null}
    style={`grid-template-columns: ${workspaceColumns};`}
    id="content"
  >
    {#each dockSides as side (side)}
      <aside
        class="sidebar"
        class:is-empty={!sideHasTabs(dock, side)}
        class:is-hidden={sideHasTabs(dock, side) && dock.hidden[side]}
        data-side={side}
      >
        <button
          class="side-collapse"
          type="button"
          aria-label={side === "left" ? "Hide left sidebar" : "Hide right sidebar"}
          onclick={() => (dock = hideSide(dock, side))}
        >
          {side === "left" ? "‹" : "›"}
        </button>
        <div
          class="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={side === "left" ? "Resize left sidebar" : "Resize right sidebar"}
          onpointerdown={(event) => handleResizerPointerDown(side, event)}
          onpointermove={handleResizerPointerMove}
          onpointerup={handleResizerPointerUp}
          onpointercancel={handleResizerPointerUp}
        ></div>
        <TabStrip
          {side}
          tabs={dock.order[side]}
          activeTab={dock.active[side]}
          {draggingTab}
          isDropTarget={dropTargetSide === side}
          onTabClick={handleTabClick}
          onTabPointerDown={handleTabPointerDown}
        />
        <div class="panel-stack">
          {#each dock.order[side] as tab (tab)}
            <div
              class="sidebar-panel"
              class:is-active={dock.active[side] === tab}
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              {#if tab === "outline"}
                <OutlineSidebar
                  outlineEntries={activeSession.outlineEntries}
                  outlineStatus={activeSession.outlineStatus}
                  bind:outlineColorMenuId={activeSession.outlineColorMenuId}
                  {isOutlineCollapsed}
                  {isActiveOutlineRow}
                  {toggleOutlineCollapsed}
                  {expandAllOutlineItems}
                  {collapseAllOutlineItems}
                  {goToOutlineEntry}
                  {updateOutlineColor}
                />
              {:else if tab === "bookmarks"}
                <BookmarksSidebar
                  bookmarkEntries={activeSession.bookmarkEntries}
                  bookmarkStatus={activeSession.bookmarkStatus}
                  bind:editingBookmarkId={activeSession.editingBookmarkId}
                  bind:hoveredBookmarkId={activeSession.hoveredBookmarkId}
                  activeBookmarkId={activeSession.activeBookmarkId}
                  bind:bookmarkColorMenuId={activeSession.bookmarkColorMenuId}
                  {bookmarkColorStyle}
                  {updateBookmarkTitle}
                  {handleBookmarkTitleKey}
                  {goToBookmarkEntry}
                  {editBookmarkAndGoToEntry}
                  {updateBookmarkColor}
                  {deleteBookmark}
                />
              {:else}
                <AnnotationsSidebar
                  annotationEntries={activeSession.annotationEntries}
                  annotationStatus={activeSession.annotationStatus}
                  selectedAnnotationEntryId={activeSession.selectedAnnotationEntryId}
                  {locateAnnotationEntry}
                />
              {/if}
            </div>
          {/each}
        </div>
      </aside>
    {/each}
    <section class="reader viewer-shell">
      {#if tabsState.order.length === 0 || !activeSession.pdfDocument}
        <div class="reader-empty">Open a PDF to start reading (⌘O).</div>
      {/if}
      {#each tabsState.order as tabId (tabId)}
        {@const session = sessions.get(tabId) ?? nullSession}
        <div
          class="pdf-container"
          class:annotation-tool-active={tabId === tabsState.activeId && isAnnotationCreationMode()}
          style:display={tabId === tabsState.activeId ? "block" : "none"}
          bind:this={session.containerEl}
          role="region"
          aria-label="PDF pages"
        >
          {#if session.annotationFocusBox}
            <div
              class="annotation-focus-box"
              style={`left: ${session.annotationFocusBox.left}px; top: ${session.annotationFocusBox.top}px; width: ${session.annotationFocusBox.width}px; height: ${session.annotationFocusBox.height}px`}
              aria-hidden="true"
            ></div>
          {/if}
          {#each session.bookmarkEntries as entry (entry.id)}
            <button
              type="button"
              class="bookmark-page-marker"
              class:bookmark-hovered={session.hoveredBookmarkId === entry.id}
              data-page-number={entry.pageNumber}
              style={bookmarkMarkerStyle(entry)}
              onclick={(event) => {
                event.stopPropagation();
                deleteBookmark(entry.id);
              }}
              onmouseenter={() => (session.hoveredBookmarkId = entry.id)}
              onmouseleave={() => (session.hoveredBookmarkId = null)}
              title={`Remove bookmark: ${entry.title}`}
              aria-label={`Remove bookmark ${entry.title}`}
            ></button>
          {/each}
          {#if session.bookmarkRailHoverCue}
            <div
              class="bookmark-rail-focus-cue"
              data-page-number={session.bookmarkRailHoverCue.pageNumber}
              style={`left: ${session.bookmarkRailHoverCue.focusLeft}px; top: ${session.bookmarkRailHoverCue.focusTop}px`}
              aria-hidden="true"
            >
              +
            </div>
            <div
              class="bookmark-rail-add-cue"
              data-page-number={session.bookmarkRailHoverCue.pageNumber}
              style={`left: ${session.bookmarkRailHoverCue.hintLeft}px; top: ${session.bookmarkRailHoverCue.hintTop}px`}
              aria-hidden="true"
            >
              +
            </div>
          {/if}
          <div class="pdfViewer" bind:this={session.viewerEl}></div>
        </div>
      {/each}
    </section>
  </main>
</div>

{#each dockSides as side (side)}
  {#if draggingTab && dropTargetSide === side && (!sideHasTabs(dock, side) || dock.hidden[side])}
    <div class="edge-dock-cue" data-side={side} aria-hidden="true"></div>
  {/if}
{/each}

{#if draggingTab && dragGhost}
  <div class="tab-drag-ghost" style={`left: ${dragGhost.x}px; top: ${dragGhost.y}px;`} aria-hidden="true">
    <span class="tab-drag-ghost-chip">
      <svg viewBox="0 0 24 24">
        <path d={tabMeta[draggingTab].icon}></path>
      </svg>
    </span>
    <svg class="tab-drag-ghost-hand" viewBox="0 0 24 24">
      <path
        d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
      ></path>
    </svg>
  </div>
{/if}

{#each dockSides as side (side)}
  <button
    class="edge-reopen"
    class:is-visible={shouldShowEdgeReopen(dock, side)}
    type="button"
    data-show-side={side}
    aria-label={side === "left" ? "Show left sidebar" : "Show right sidebar"}
    onclick={() => (dock = showSide(dock, side))}
  >
    {side === "left" ? "›" : "‹"}
  </button>
{/each}

<ColorPlate
  anchor={colorPlate?.anchor ?? null}
  activeName={colorPlate ? headerColorNames[colorPlate.slotIndex] : null}
  onChoose={chooseColorFromPlate}
  onClose={() => (colorPlate = null)}
/>
<ToolPopover
  tool={toolPopover?.tool ?? null}
  anchor={toolPopover?.anchor ?? null}
  fontSize={defaultFreeTextFontSize}
  thickness={defaultInkThickness}
  onFontSize={applyFreeTextFontSize}
  onThickness={applyInkThickness}
  onClose={() => (toolPopover = null)}
/>

<div class="app-status" role="status" aria-live="polite">{activeSession.status}</div>

<style>
  /* ---- Official-app shell (topbar, workspace, sidebars, reader host) ---- */

  .app {
    position: relative;
    height: 100vh;
    min-width: var(--app-min-width);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface);
  }
  .topbar {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: 0 var(--space-4);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .brand .file {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--warn);
    flex: none;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: nowrap;
    justify-content: flex-end;
    min-width: max-content;
  }
  .icon-btn {
    display: inline-flex;
    width: 34px;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    transition:
      background var(--motion-fast) var(--ease-standard),
      border-color var(--motion-fast) var(--ease-standard);
  }
  .icon-btn:hover:not(:disabled) {
    border-color: var(--fg);
  }
  .icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
  .icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .zoom-value {
    min-height: 34px;
    min-width: 56px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--surface);
  }

  .workspace {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(302px, 367px) minmax(0, 1fr) 0;
    transition: grid-template-columns var(--motion-base) var(--ease-standard);
  }
  .workspace > .sidebar,
  .workspace > .reader {
    grid-row: 1;
  }
  .workspace.has-right {
    grid-template-columns: minmax(302px, 367px) minmax(0, 1fr) minmax(302px, 367px);
  }
  .workspace.no-left {
    grid-template-columns: 0 minmax(0, 1fr) 0;
  }
  .workspace.no-left.has-right {
    grid-template-columns: 0 minmax(0, 1fr) minmax(302px, 367px);
  }

  .sidebar {
    grid-column: 1;
    position: relative;
    width: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: var(--bg);
    border-right: 1px solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .sidebar[data-side="right"] {
    grid-column: 3;
    border-right: 0;
    border-left: 1px solid var(--border);
  }
  .sidebar.is-empty,
  .sidebar.is-hidden {
    display: none;
  }
  /* Kebab-case on purpose: pdf_viewer.css owns `.sidebarResizer` inside its
     own `.sidebar` rule and must not style this handle. */
  .sidebar-resizer {
    position: absolute;
    z-index: 5;
    top: 0;
    bottom: 0;
    right: 0;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
    transition: background var(--motion-fast) var(--ease-standard);
  }
  .sidebar[data-side="right"] .sidebar-resizer {
    right: auto;
    left: 0;
  }
  .sidebar-resizer:hover,
  .workspace.is-resizing .sidebar-resizer {
    background: color-mix(in oklab, var(--fg), transparent 86%);
  }
  .workspace.is-resizing {
    transition: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .side-collapse {
    position: absolute;
    z-index: 4;
    top: var(--space-3);
    right: var(--space-3);
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--bg);
    color: var(--muted);
    display: grid;
    place-items: center;
    font-size: var(--text-lg);
    line-height: 1;
    transition:
      color var(--motion-fast) var(--ease-standard),
      border-color var(--motion-fast) var(--ease-standard),
      background var(--motion-fast) var(--ease-standard);
  }
  .sidebar[data-side="right"] .side-collapse {
    right: auto;
    left: var(--space-3);
  }
  .side-collapse:hover,
  .side-collapse:focus-visible {
    color: var(--fg);
    border-color: var(--fg);
    background: var(--surface);
    outline: none;
  }

  .panel-stack {
    min-height: 0;
    display: grid;
  }
  .sidebar-panel {
    min-height: 0;
    min-width: 0;
    display: none;
    grid-template-rows: minmax(0, 1fr);
  }
  .sidebar-panel.is-active {
    display: grid;
  }

  .reader {
    grid-column: 2;
    position: relative;
    min-width: 0;
    min-height: 0;
    background: var(--surface-warm);
  }
  .reader-empty {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: var(--text-sm);
    pointer-events: none;
  }

  .edge-reopen {
    position: fixed;
    z-index: 6;
    top: 96px;
    width: 30px;
    height: 48px;
    border: 1px solid var(--border);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--elev-raised);
    font-size: var(--text-lg);
    line-height: 1;
    display: none;
    place-items: center;
  }
  .edge-reopen[data-show-side="left"] {
    left: 0;
  }
  .edge-reopen[data-show-side="right"] {
    right: 0;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  .edge-reopen.is-visible {
    display: grid;
  }

  /* Dock-zone cue for a side whose sidebar is empty or hidden: those render
     display: none, so the tab strip's is-drop-target tint can never show
     there; this fixed overlay is the only "release here to dock" signal. */
  .edge-dock-cue {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    width: 38px;
    pointer-events: none;
    background: color-mix(in oklab, var(--accent), transparent 88%);
  }
  .edge-dock-cue[data-side="left"] {
    left: 0;
    border-right: 2px dashed color-mix(in oklab, var(--accent), transparent 40%);
  }
  .edge-dock-cue[data-side="right"] {
    right: 0;
    border-left: 2px dashed color-mix(in oklab, var(--accent), transparent 40%);
  }

  .tab-drag-ghost {
    position: fixed;
    z-index: 40;
    pointer-events: none;
    transform: translate(-50%, -100%);
  }
  .tab-drag-ghost-chip {
    display: grid;
    place-items: center;
    width: 40px;
    height: 38px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 6px 16px color-mix(in oklab, var(--fg), transparent 82%);
    transform: rotate(-6deg);
  }
  .tab-drag-ghost-chip svg {
    width: 17px;
    height: 17px;
    stroke: var(--fg);
    stroke-width: 1.8;
    fill: none;
  }
  .tab-drag-ghost-hand {
    position: absolute;
    left: 50%;
    top: 100%;
    width: 22px;
    height: 22px;
    transform: translate(-40%, -60%) rotate(8deg);
    stroke: var(--fg);
    stroke-width: 1.8;
    fill: var(--bg);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .app-status {
    position: fixed;
    left: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
  }

  /* ---- Transplanted spike viewer CSS (behavior-critical; keep verbatim) ---- */

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

  .bookmark-page-marker {
    background: var(--bookmark-color, #f04444);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
  }

  .pdf-container {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--surface-warm);
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

  /* Official-app addition (P0-6): pdf_viewer.css re-enables pointer events on
     a highlight editor's .internal, which spans the editor's whole rect and
     both steals the pointerdown from the active tool and stops pdf.js from
     creating (its layer only creates when the event target is the layer div
     itself). In creation mode the entire highlight editor subtree must be
     pointer-transparent; the editToolbar subtree keeps its own rule below. */
  .pdf-container.annotation-tool-active
    :global(.annotationEditorLayer .highlightEditor :not(.editToolbar, .editToolbar *)) {
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
