import { formatError } from "../format";
import type { AnnotationKind } from "./annotation-sidebar";

// Everything the app knows about pdf.js *private* editor internals lives in
// this module, so a pdfjs-dist upgrade has one file to re-verify.
//
// Background: pdf.js gives each rendered document one AnnotationEditorUIManager
// that owns editor creation and selection. Every time a PDF is (re)loaded the
// viewer builds a fresh manager and aborts the old one's AbortSignal, but
// editor objects and event paths captured earlier can still point at the dead
// manager. Calling setSelected()/unselectAll() through such a stale manager
// makes WebKit throw from addEventListener ("The provided AbortSignal is
// aborted"); other engines, and Node, silently no-op instead. We swallow that
// one failure rather than avoid the call because the app cannot always tell
// which manager a pdf.js-internal event path will route through, and the
// failed call is harmless — the selection is being replaced anyway.

// Structural typings for the private pdf.js editor objects the app touches.
// pdfjs-dist exports no types for these internals, and hand-writing them
// documents exactly which private surface we depend on. When bumping
// pdfjs-dist, confirm these properties — and the _signal/_uiManager slots read
// below — still exist.
export type AnnotationEditor = {
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

export type AnnotationEditorLayerRef = {
  createAndAddNewEditor: (
    event: { offsetX: number; offsetY: number },
    isCentered: boolean,
    data?: Record<string, unknown>,
  ) => AnnotationEditor | null;
};

export type AnnotationEditorUIManager = {
  delete: () => void;
  findParent: (x: number, y: number) => AnnotationEditorLayerRef | null;
  firstSelectedEditor?: AnnotationEditor;
  getEditors: (pageIndex: number) => Generator<AnnotationEditor, void, unknown>;
  highlightSelection: (methodOfCreation?: string, comment?: boolean) => void;
  isDeletedAnnotationElement?: (annotationElementId: string) => boolean;
  setSelected: (editor: AnnotationEditor) => void;
  translateSelectedEditors?: (dx: number, dy: number, noCommit?: boolean) => void;
  unselectAll: () => void;
  updateParams: (type: number, value: unknown) => void;
  viewParameters?: { realScale?: number };
};

// The app-level annotation tool selection; editorModes in the page maps each
// tool to its pdf.js AnnotationEditorType value.
export type EditorTool = "none" | "highlight" | "text" | "ink";

export type EditorModeValues = {
  highlight: number | string;
  text: number | string;
  ink: number | string;
};

// Probes whether the runtime would accept this signal in addEventListener.
// The result is environment-specific by design: WebKit rejects an
// already-aborted signal, Node and Chromium accept it (see module header).
export function isUsableAbortSignal(signal: unknown) {
  if (!(signal instanceof AbortSignal)) return false;
  const target = new EventTarget();
  try {
    target.addEventListener("pdfspike-signal-check", () => undefined, { signal });
    return true;
  } catch {
    return false;
  }
}

export function managerHasValidSignal(manager: AnnotationEditorUIManager) {
  return isUsableAbortSignal((manager as unknown as { _signal?: unknown })._signal);
}

export function editorHasValidManagerSignal(editor: AnnotationEditor) {
  const manager = (editor as unknown as { _uiManager?: { _signal?: unknown } })._uiManager;
  return isUsableAbortSignal(manager?._signal);
}

export function editorBelongsToManager(
  editor: AnnotationEditor | null | undefined,
  manager: AnnotationEditorUIManager,
) {
  return Boolean(editor && (editor as unknown as { _uiManager?: unknown })._uiManager === manager);
}

// Matches only the stale-manager failure described in the module header; any
// other error from pdf.js must keep propagating.
function isPdfjsSignalBugError(error: unknown) {
  const message = formatError(error);
  return message.includes("AbortSignal") && message.includes("addEventListener");
}

export function selectEditorIgnoringPdfjsSignalBug(manager: AnnotationEditorUIManager, editor: AnnotationEditor) {
  try {
    manager.setSelected(editor);
  } catch (error) {
    if (!isPdfjsSignalBugError(error)) {
      throw error;
    }
  }
}

export function unselectAllIgnoringPdfjsSignalBug(manager: AnnotationEditorUIManager | null | undefined) {
  if (!manager) return;
  try {
    manager.unselectAll();
  } catch (error) {
    if (!isPdfjsSignalBugError(error)) {
      throw error;
    }
  }
}

// translateSelectedEditors is a private pdf.js API whose arguments are PDF
// page units. Keep client/CSS-pixel callers behind this conversion boundary so
// UI pointer deltas remain scale-correct.
export function translateSelectedEditorsByClientDelta(
  manager: AnnotationEditorUIManager | null | undefined,
  expectedEditorId: string,
  clientDx: number,
  clientDy: number,
) {
  const realScale = manager?.viewParameters?.realScale;
  if (
    !manager ||
    !Number.isFinite(realScale) ||
    !realScale ||
    realScale < 0 ||
    manager.firstSelectedEditor?.id !== expectedEditorId ||
    typeof manager.translateSelectedEditors !== "function"
  ) {
    return false;
  }
  manager.translateSelectedEditors(clientDx / realScale, clientDy / realScale, true);
  return true;
}

// pdf.js FreeTextEditor#extractText assumes the contenteditable holds one
// <div> child per line and strips every EOL *inside* a child
// (#getNodeContent does innerText.replaceAll(EOL_PATTERN, "")). But typing
// Shift+Enter in Chrome/WebKit inserts a <br> inside the current line div
// instead of splitting it, so on commit pdf.js silently merges those visual
// lines into one ("line1line2") while the stale <br> DOM keeps *looking*
// multi-line. Rewriting the DOM into the canonical per-line shape before any
// commit keeps content and rendering in agreement.
export function normalizeFreeTextEditorLines(editorDiv: HTMLElement): boolean {
  const isCanonicalLine = (node: ChildNode) => {
    if (node.nodeType !== Node.ELEMENT_NODE || (node as Element).tagName !== "DIV") return false;
    const children = node.childNodes;
    if (children.length === 0) return true;
    if (children.length !== 1) return false;
    const only = children[0];
    if (only.nodeType === Node.TEXT_NODE) return !/[\r\n]/.test(only.nodeValue ?? "");
    return only.nodeType === Node.ELEMENT_NODE && (only as Element).tagName === "BR";
  };
  const childNodes = [...editorDiv.childNodes];
  if (childNodes.length === 0 || childNodes.every(isCanonicalLine)) return false;
  const lines = editorDiv.innerText.replace(/\r\n?/g, "\n").split("\n");
  const doc = editorDiv.ownerDocument;
  editorDiv.replaceChildren(
    ...lines.map((line) => {
      const div = doc.createElement("div");
      div.append(line ? doc.createTextNode(line) : doc.createElement("br"));
      return div;
    }),
  );
  return true;
}

// Each guard checks the numeric AnnotationEditorType enum *and* a string name
// because live editors carry the number while editors rebuilt from serialized
// annotation data carry the serialized name. Taking the enum values as a
// parameter (instead of importing pdfjs-dist here) keeps this module loadable
// in plain Node for unit tests.
export function createEditorTypeGuards(editorModes: EditorModeValues) {
  const isHighlightEditor = (editor: AnnotationEditor | null | undefined): editor is AnnotationEditor =>
    editor?.editorType === editorModes.highlight || editor?.editorType === "highlight";
  const isFreeTextEditor = (editor: AnnotationEditor | null | undefined): editor is AnnotationEditor =>
    editor?.editorType === editorModes.text || editor?.editorType === "freetext";
  const isInkEditor = (editor: AnnotationEditor | null | undefined): editor is AnnotationEditor =>
    editor?.editorType === editorModes.ink || editor?.editorType === "ink";
  const annotationKindForEditor = (editor: AnnotationEditor): AnnotationKind | null => {
    if (isHighlightEditor(editor)) return "highlight";
    if (isFreeTextEditor(editor)) return "freetext";
    if (isInkEditor(editor)) return "ink";
    return null;
  };
  return { isHighlightEditor, isFreeTextEditor, isInkEditor, annotationKindForEditor };
}
