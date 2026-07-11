import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DRAG_START_PX, hasPointerDragStarted } from "../../src/lib/ui/pointer-drag";

describe("pointer drag threshold", () => {
  it("uses one shared 4px threshold, including the boundary", () => {
    const start = { clientX: 40, clientY: 80 };
    assert.equal(DRAG_START_PX, 4);
    assert.equal(hasPointerDragStarted(start, { clientX: 43.99, clientY: 80 }), false);
    assert.equal(hasPointerDragStarted(start, { clientX: 44, clientY: 80 }), true);
    assert.equal(hasPointerDragStarted(start, { clientX: 40, clientY: 84 }), true);
  });
});
