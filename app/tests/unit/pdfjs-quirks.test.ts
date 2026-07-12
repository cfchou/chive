import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  createEditorTypeGuards,
  editorBelongsToManager,
  editorHasValidManagerSignal,
  isUsableAbortSignal,
  managerHasValidSignal,
  selectEditorIgnoringPdfjsSignalBug,
  translateSelectedEditorsByClientDelta,
  unselectAllIgnoringPdfjsSignalBug,
  type AnnotationEditor,
  type AnnotationEditorUIManager,
} from "../../src/lib/pdf/pdfjs-quirks";

const signalBugError = new Error(
  "Failed to execute 'addEventListener' on 'EventTarget': The provided AbortSignal is aborted",
);

function editor(overrides: Partial<AnnotationEditor> & Record<string, unknown> = {}): AnnotationEditor {
  return { id: "editor", editorType: 9, ...overrides };
}

function manager(overrides: Record<string, unknown> = {}) {
  return {
    delete: () => undefined,
    findParent: () => null,
    getEditors: function* () {},
    highlightSelection: () => undefined,
    setSelected: () => undefined,
    unselectAll: () => undefined,
    updateParams: () => undefined,
    ...overrides,
  } as unknown as AnnotationEditorUIManager;
}

describe("pdf.js quirk workarounds", () => {
  // Whether an already-aborted signal throws from addEventListener is
  // environment-specific (WebKit throws, Node no-ops), which is exactly what
  // isUsableAbortSignal probes — so these tests only pin the
  // environment-independent cases.
  it("accepts live abort signals and rejects non-signal values", () => {
    assert.equal(isUsableAbortSignal(new AbortController().signal), true);
    assert.equal(isUsableAbortSignal(undefined), false);
    assert.equal(isUsableAbortSignal({}), false);
  });

  it("reads the manager and editor private signal slots", () => {
    const live = new AbortController().signal;
    assert.equal(managerHasValidSignal(manager({ _signal: live })), true);
    assert.equal(managerHasValidSignal(manager()), false);
    assert.equal(editorHasValidManagerSignal(editor({ _uiManager: { _signal: live } })), true);
    assert.equal(editorHasValidManagerSignal(editor()), false);
  });

  it("matches editors to their owning manager", () => {
    const owner = manager();
    assert.equal(editorBelongsToManager(editor({ _uiManager: owner }), owner), true);
    assert.equal(editorBelongsToManager(editor({ _uiManager: manager() }), owner), false);
    assert.equal(editorBelongsToManager(null, owner), false);
  });

  it("swallows only the pdf.js signal bug when selecting", () => {
    let selected: AnnotationEditor | null = null;
    const working = manager({
      setSelected: (candidate: AnnotationEditor) => {
        selected = candidate;
      },
    });
    const target = editor();
    selectEditorIgnoringPdfjsSignalBug(working, target);
    assert.equal(selected, target);

    const buggy = manager({
      setSelected: () => {
        throw signalBugError;
      },
    });
    assert.doesNotThrow(() => selectEditorIgnoringPdfjsSignalBug(buggy, target));

    const broken = manager({
      setSelected: () => {
        throw new Error("something else");
      },
    });
    assert.throws(() => selectEditorIgnoringPdfjsSignalBug(broken, target), /something else/);
  });

  it("swallows only the pdf.js signal bug when unselecting, and tolerates a missing manager", () => {
    assert.doesNotThrow(() => unselectAllIgnoringPdfjsSignalBug(null));
    assert.doesNotThrow(() =>
      unselectAllIgnoringPdfjsSignalBug(
        manager({
          unselectAll: () => {
            throw signalBugError;
          },
        }),
      ),
    );
    assert.throws(
      () =>
        unselectAllIgnoringPdfjsSignalBug(
          manager({
            unselectAll: () => {
              throw new Error("real failure");
            },
          }),
        ),
      /real failure/,
    );
  });

  it("builds type guards that accept both numeric modes and serialized names", () => {
    const guards = createEditorTypeGuards({ highlight: 9, text: 3, ink: 15 });
    assert.equal(guards.isHighlightEditor(editor({ editorType: 9 })), true);
    assert.equal(guards.isHighlightEditor(editor({ editorType: "highlight" })), true);
    assert.equal(guards.isHighlightEditor(editor({ editorType: 3 })), false);
    assert.equal(guards.isFreeTextEditor(editor({ editorType: "freetext" })), true);
    assert.equal(guards.isInkEditor(editor({ editorType: 15 })), true);
    assert.equal(guards.isHighlightEditor(null), false);
    assert.equal(guards.annotationKindForEditor(editor({ editorType: 3 })), "freetext");
    assert.equal(guards.annotationKindForEditor(editor({ editorType: "ink" })), "ink");
    assert.equal(guards.annotationKindForEditor(editor({ editorType: 999 })), null);
  });

  it("converts incremental client-pixel deltas to page units before translating without commit", () => {
    const calls: [number, number, boolean | undefined][] = [];
    const target = editor({ id: "selected" });
    const scaled = manager({
      firstSelectedEditor: target,
      translateSelectedEditors: (dx: number, dy: number, noCommit?: boolean) => calls.push([dx, dy, noCommit]),
      viewParameters: { realScale: 2 },
    });
    assert.equal(translateSelectedEditorsByClientDelta(scaled, "selected", 18, -10), true);
    assert.deepEqual(calls, [[9, -5, true]]);

    const fractionalScale = manager({
      firstSelectedEditor: target,
      translateSelectedEditors: (dx: number, dy: number, noCommit?: boolean) => calls.push([dx, dy, noCommit]),
      viewParameters: { realScale: 1.25 },
    });
    assert.equal(translateSelectedEditorsByClientDelta(fractionalScale, "selected", -5, 7.5), true);
    assert.deepEqual(calls.at(-1), [-4, 6, true]);
  });

  it("rejects invalid or missing movement prerequisites without translating", () => {
    const calls: unknown[][] = [];
    const target = editor({ id: "selected" });
    for (const realScale of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidate = manager({
        firstSelectedEditor: target,
        translateSelectedEditors: (...args: unknown[]) => calls.push(args),
        viewParameters: { realScale },
      });
      assert.equal(translateSelectedEditorsByClientDelta(candidate, "selected", 8, 4), false);
    }
    assert.equal(
      translateSelectedEditorsByClientDelta(manager({ firstSelectedEditor: target, viewParameters: { realScale: 1 } }), "selected", 8, 4),
      false,
    );
    assert.deepEqual(calls, []);
  });

  it("rejects an editor-ID mismatch without translating", () => {
    let translated = false;
    const candidate = manager({
      firstSelectedEditor: editor({ id: "other-editor" }),
      translateSelectedEditors: () => {
        translated = true;
      },
      viewParameters: { realScale: 1 },
    });
    assert.equal(translateSelectedEditorsByClientDelta(candidate, "expected-editor", 8, 4), false);
    assert.equal(translated, false);
  });
});
