<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import * as pdfjsLib from "pdfjs-dist";
  import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
  import {
    EventBus,
    PDFLinkService,
    PDFViewer,
  } from "pdfjs-dist/web/pdf_viewer.mjs";
  import "pdfjs-dist/web/pdf_viewer.css";

  type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
  type EditorTool = "none" | "highlight" | "text" | "ink";
  type HighlightColorName = "yellow" | "green" | "blue" | "pink";
  type AnnotationEditor = {
    id: string;
    color?: string | null;
    deleted?: boolean;
    editorType: number | string;
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
    setSelected: (editor: AnnotationEditor) => void;
    unselectAll: () => void;
    updateParams: (type: number, value: unknown) => void;
  };
  type SpikeDebugApi = {
    annotationSummary: () => Promise<Record<string, unknown>[]>;
    createPageFreeText: (text?: string, pageNumber?: number) => Promise<boolean>;
    createSelectionHighlightInToolMode: () => Promise<boolean>;
    editorSummary: () => Record<string, unknown>[];
    loadSample: () => Promise<void>;
    loadPath: (path: string) => Promise<void>;
    saveToPath: (path: string) => Promise<void>;
    selectFirstHighlight: () => Promise<boolean>;
    selectFirstText: () => string;
    recolorSelectedHighlight: (color: HighlightColorName) => void;
    deleteSelected: () => boolean;
    highlightSelection: () => void;
    stats: () => Record<string, unknown>;
    setTool: (tool: EditorTool) => void;
  };

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  let containerEl: HTMLDivElement;
  let viewerEl: HTMLDivElement;
  let pdfViewer: PDFViewer | null = null;
  let pdfDocument = $state<PdfDocument | null>(null);
  let annotationEditorUIManager = $state<AnnotationEditorUIManager | null>(null);
  let currentPath = $state("");
  let status = $state("Open a PDF, add highlight/text/ink annotations, then save.");
  let activeTool = $state<EditorTool>("none");
  let defaultHighlightColor = $state<HighlightColorName>("yellow");
  let hasSelectedHighlight = $state(false);
  let selectedHighlightColor = $state<HighlightColorName | null>(null);
  let scaleLabel = $state("Fit Width");
  let isBusy = $state(false);
  let isDirty = $state(false);
  let rememberedSelectionText = "";
  let rememberedSelectionRanges: Range[] = [];
  const debugFileStore = new Map<string, Uint8Array>();

  const highlightColors: Record<HighlightColorName, string> = {
    yellow: "#fff35c",
    green: "#7cf2aa",
    blue: "#8ecbff",
    pink: "#ffb6de",
  };

  const editorModes = {
    none: pdfjsLib.AnnotationEditorType.NONE,
    highlight: pdfjsLib.AnnotationEditorType.HIGHLIGHT,
    text: pdfjsLib.AnnotationEditorType.FREETEXT,
    ink: pdfjsLib.AnnotationEditorType.INK,
  } as const;

  onMount(() => {
    const debugWindow = window as Window & { __pdfSpike?: SpikeDebugApi };
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
    containerEl?.addEventListener("pointerdown", handlePdfPointerDown, { capture: true });
    debugWindow.__pdfSpike = {
      annotationSummary: getAnnotationSummary,
      createPageFreeText,
      createSelectionHighlightInToolMode,
      editorSummary: getEditorSummary,
      loadSample: loadSamplePdf,
      loadPath: debugLoadPath,
      saveToPath: debugSaveToPath,
      selectFirstHighlight: () => selectFirstHighlight(),
      selectFirstText,
      recolorSelectedHighlight: applyHighlightColor,
      deleteSelected: deleteSelectedAnnotation,
      highlightSelection: () => highlightSelection(),
      stats: getDebugStats,
      setTool,
    };
    return () => {
      containerEl?.removeEventListener("pointerdown", handlePdfPointerDown, { capture: true });
      document.removeEventListener("selectionchange", rememberSelection);
      delete debugWindow.__pdfSpike;
    };
  });

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
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const nextDocument = await loadingTask.promise;

    teardownViewer();
    rememberedSelectionText = "";
    rememberedSelectionRanges = [];

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
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

    eventBus.on("pagesinit", () => {
      if (!pdfViewer) return;
      pdfViewer.currentScaleValue = "page-width";
      scaleLabel = "Fit Width";
      status = `Rendered ${label}`;
    });
    eventBus.on("editingstateschanged", syncSelectedHighlightState);
    eventBus.on("annotationeditorparamschanged", syncSelectedHighlightState);
  }

  function setTool(tool: EditorTool) {
    if (!pdfViewer) return;
    const previousTool = activeTool;
    activeTool = tool;
    pdfViewer.annotationEditorMode = { mode: editorModes[tool] };
    if (tool === "highlight" && annotationEditorUIManager && previousTool === "highlight") {
      annotationEditorUIManager.updateParams(
        pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        highlightColors[defaultHighlightColor],
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
        syncSelectedHighlightState();
        if (annotationEditorUIManager.firstSelectedEditor) {
          status = "Selected highlight. Change color or delete it, then save.";
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 100));
    }
    status = "Could not activate clicked highlight for editing.";
    return false;
  }

  function findHighlightEditorById(editorId: string) {
    if (!annotationEditorUIManager || !pdfDocument) {
      return null;
    }
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        if (isHighlightEditor(editor) && !editor.deleted && editor.id === editorId) {
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
    annotationEditorUIManager.setSelected(editor);
    syncSelectedHighlightState();
    status = "Selected highlight. Change color or delete it, then save.";
    return true;
  }

  function findDisabledHighlightEditorIdAtPoint(clientX: number, clientY: number) {
    const matchingEditors = [...document.querySelectorAll<HTMLElement>(".highlightEditor.disabled")]
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

  function handlePdfPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element) || activeTool !== "none") {
      return;
    }
    const savedAnnotation = target.closest(".highlightAnnotation");
    const disabledEditorId = findDisabledHighlightEditorIdAtPoint(event.clientX, event.clientY);
    if (!disabledEditorId && !savedAnnotation) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (disabledEditorId) {
      void activateExistingHighlightEditor(disabledEditorId);
      return;
    }
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
      status = "Select text in the PDF first, then press Highlight Selection.";
      return false;
    }
    const before = countHighlightEditorsInManager();
    const switchedIntoHighlightMode = activeTool !== "highlight";
    if (switchedIntoHighlightMode) {
      setTool("highlight");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    uiManager.unselectAll();
    syncSelectedHighlightState();
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
        document.getSelection()?.removeAllRanges();
        if (resetModeToNone) {
          setTool("none");
          annotationEditorUIManager?.unselectAll();
          syncSelectedHighlightState();
        }
        rememberedSelectionText = "";
        rememberedSelectionRanges = [];
        isDirty = true;
        status = createdStatus;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    status = "PDF.js did not create a visible highlight. Try Highlight mode, then drag across text.";
    return false;
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

  function syncSelectedHighlightState() {
    if (activeTool !== "highlight") {
      hasSelectedHighlight = false;
      selectedHighlightColor = null;
      return;
    }
    const editor = annotationEditorUIManager?.firstSelectedEditor;
    if (!isHighlightEditor(editor)) {
      hasSelectedHighlight = false;
      selectedHighlightColor = null;
      return;
    }
    hasSelectedHighlight = true;
    selectedHighlightColor = colorNameForValue(editor?.color ?? null);
  }

  function isHighlightEditor(editor: AnnotationEditor | null | undefined) {
    return editor?.editorType === editorModes.highlight || editor?.editorType === "highlight";
  }

  function colorNameForValue(color: string | null) {
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
    syncSelectedHighlightState();
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
      hasSelectedHighlight = false;
      selectedHighlightColor = null;
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
      status = `Changed selected highlight to ${colorName}. Save to persist it into the PDF.`;
      return;
    }
    status = `Next highlight will use ${colorName}.`;
  }

  function deleteSelectedAnnotation() {
    if (activeTool !== "highlight" || !annotationEditorUIManager?.firstSelectedEditor) {
      status = "Select an annotation first, then delete it.";
      return false;
    }
    const wasHighlight = isHighlightEditor(annotationEditorUIManager.firstSelectedEditor);
    annotationEditorUIManager.delete();
    syncSelectedHighlightState();
    isDirty = true;
    status = wasHighlight
      ? "Deleted selected highlight. Save to persist it into the PDF."
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
      status,
      activeTool,
      defaultHighlightColor,
      hasSelectedHighlight,
      selectedHighlightColor,
      selectedEditorType: selectedEditor?.editorType ?? null,
      selectedEditorColor: selectedEditor?.color ?? null,
      selectedText: document.getSelection()?.toString() ?? "",
      textLayerSpans: document.querySelectorAll(".textLayer span").length,
      annotationEditorLayers: document.querySelectorAll(".annotationEditorLayer").length,
      highlightEditors: document.querySelectorAll(".highlightEditor").length,
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
    const selectedEditorId =
      document.querySelector<HTMLElement>(".highlightEditor.selectedEditor")?.id ?? null;
    const entries: Record<string, unknown>[] = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      for (const editor of annotationEditorUIManager.getEditors(pageIndex)) {
        entries.push({
          color: editor.color ?? null,
          deleted: editor.deleted ?? false,
          editorType: editor.editorType,
          id: editor.id,
          isDomSelected: editor.id === selectedEditorId,
          isFirstSelectedEditor: annotationEditorUIManager.firstSelectedEditor?.id === editor.id,
          page: pageIndex + 1,
        });
      }
    }
    return entries;
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
      const saved = await pdfDocument.saveDocument();
      await invoke("write_pdf_atomic", {
        path,
        bytes: Array.from(saved),
      });
      currentPath = path;
      isDirty = false;
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
    const saved = await pdfDocument.saveDocument();
    debugFileStore.set(path, new Uint8Array(saved));
    currentPath = path;
    isDirty = false;
    status = `Saved debug snapshot ${path}`;
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
    status = `Loaded debug snapshot ${path}`;
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
          id: annotation.id,
          popupRef: "popupRef" in annotation ? annotation.popupRef : null,
          rect: "rect" in annotation ? annotation.rect : null,
          subtype: "subtype" in annotation ? annotation.subtype : null,
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
    layer.createAndAddNewEditor({ offsetX: 160, offsetY: 220 }, false);
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
    isDirty = true;
    return true;
  }

  function teardownViewer() {
    pdfViewer?.setDocument(null as never);
    (pdfDocument as { destroy?: () => void } | null)?.destroy?.();
    pdfViewer = null;
    pdfDocument = null;
    annotationEditorUIManager = null;
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
      <button onclick={deleteSelectedAnnotation} disabled={activeTool !== "highlight" || !hasSelectedHighlight}>
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

  <section class="viewer-shell">
    <div class="viewer-toolbar">
      <span>{currentPath || "No PDF loaded"}</span>
    </div>
    <div class="pdf-container" bind:this={containerEl}>
      <div class="pdfViewer" bind:this={viewerEl}></div>
    </div>
  </section>
</main>

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

  .app {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
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
