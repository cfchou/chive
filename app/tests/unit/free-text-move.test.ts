import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  FREE_TEXT_MOVE_GRIP_INSET_PX,
  FREE_TEXT_MOVE_GRIP_SIZE_PX,
  incrementalFreeTextClientDelta,
  isFreeTextMoveGripHit,
} from "../../src/lib/pdf/free-text-move";
import {
  translateSelectedEditorsByClientDelta,
  type AnnotationEditor,
  type AnnotationEditorUIManager,
} from "../../src/lib/pdf/pdfjs-quirks";

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

describe("free-text move geometry", () => {
  it("places the visual grip across the upper-left border instead of over editable text", () => {
    assert.equal(FREE_TEXT_MOVE_GRIP_SIZE_PX, 14);
    assert.equal(FREE_TEXT_MOVE_GRIP_INSET_PX, -6);
  });

  it("accepts only coordinates inside the upper-left grip boundaries", () => {
    const rect = { left: 100, top: 200, width: 160, height: 48 };
    const left = rect.left + FREE_TEXT_MOVE_GRIP_INSET_PX;
    const top = rect.top + FREE_TEXT_MOVE_GRIP_INSET_PX;
    assert.equal(isFreeTextMoveGripHit(rect, left, top), true);
    assert.equal(isFreeTextMoveGripHit(rect, left + FREE_TEXT_MOVE_GRIP_SIZE_PX - 0.01, top + 1), true);
    assert.equal(isFreeTextMoveGripHit(rect, left - 0.01, top), false);
    assert.equal(isFreeTextMoveGripHit(rect, left + FREE_TEXT_MOVE_GRIP_SIZE_PX, top), false);
    assert.equal(isFreeTextMoveGripHit(rect, left, top + FREE_TEXT_MOVE_GRIP_SIZE_PX), false);
  });

  it("keeps positive and negative movement as incremental client deltas", () => {
    assert.deepEqual(
      incrementalFreeTextClientDelta({ clientX: 12, clientY: 18 }, { clientX: 20, clientY: 27 }),
      { clientDx: 8, clientDy: 9 },
    );
    assert.deepEqual(
      incrementalFreeTextClientDelta({ clientX: 20, clientY: 27 }, { clientX: 12, clientY: 18 }),
      { clientDx: -8, clientDy: -9 },
    );
  });

  it("passes the incremental free-text client delta through the scaled translation seam", () => {
    const calls: unknown[][] = [];
    const selected: AnnotationEditor = { id: "free-text", editorType: 3 };
    const delta = incrementalFreeTextClientDelta({ clientX: 20, clientY: 40 }, { clientX: 28, clientY: 30 });
    const translated = translateSelectedEditorsByClientDelta(
      manager({
        firstSelectedEditor: selected,
        translateSelectedEditors: (...args: unknown[]) => calls.push(args),
        viewParameters: { realScale: 2 },
      }),
      selected.id,
      delta.clientDx,
      delta.clientDy,
    );
    assert.equal(translated, true);
    assert.deepEqual(calls, [[4, -5, true]]);
  });
});
