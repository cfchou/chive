import { formatError } from "../format";
import type { AnnotationKind } from "./annotation-sidebar";

// Structural typings for the private pdf.js editor objects the app touches.
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
  unselectAll: () => void;
  updateParams: (type: number, value: unknown) => void;
};

export type EditorModeValues = {
  highlight: number | string;
  text: number | string;
  ink: number | string;
};

// pdf.js keeps aborted AbortSignals on stale UI managers; selecting through
// them throws from addEventListener. These helpers detect that state and
// swallow only that specific failure.
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
