import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addTab,
  removeTab,
  activateTab,
  moveTab,
  nextTabId,
  previousTabId,
  findByPath,
  createEmptyTabsState,
  type DocumentTabId,
} from "../../src/lib/tabs/tab-state";

describe("tab-state", () => {
  it("addTab adds a tab to an empty state and activates it", () => {
    const state = createEmptyTabsState();
    const next = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    assert.equal(next.order.length, 1);
    assert.equal(next.activeId, next.order[0]);
    assert.notEqual(next.activeId, null);
  });

  it("addTab appends without changing the active tab", () => {
    const state = addTab(createEmptyTabsState(), { path: "/a.pdf", label: "a.pdf" });
    const firstId = state.activeId;
    const next = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    assert.equal(next.order.length, 2);
    assert.equal(next.activeId, firstId);
  });

  it("addTab with null path never dedupes", () => {
    const state = addTab(createEmptyTabsState(), { path: null, label: "sample.pdf" });
    const next = addTab(state, { path: null, label: "sample.pdf" });
    assert.equal(next.order.length, 2);
  });

  it("removeTab returns nearest right as next active, else left, else null", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    const aId = state.order[0];
    state = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    const bId = state.order[1];
    state = addTab(state, { path: "/c.pdf", label: "c.pdf" });
    const cId = state.order[2];
    state = activateTab(state, bId);

    // Remove B (middle) → next active should be C (nearest right)
    const afterRemoveB = removeTab(state, bId);
    assert.equal(afterRemoveB.activeId, cId);

    // Remove C (last) → next active should be A (nearest left)
    const afterRemoveC = removeTab(afterRemoveB, cId);
    assert.equal(afterRemoveC.activeId, aId);

    // Remove A (only) → null
    const afterRemoveA = removeTab(afterRemoveC, aId);
    assert.equal(afterRemoveA.activeId, null);
    assert.equal(afterRemoveA.order.length, 0);
  });

  it("activateTab sets the active id", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    state = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    const bId = state.order[1];
    const next = activateTab(state, bId);
    assert.equal(next.activeId, bId);
  });

  it("moveTab reorders within the order array", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    state = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    state = addTab(state, { path: "/c.pdf", label: "c.pdf" });
    const aId = state.order[0];
    const cId = state.order[2];
    const next = moveTab(state, 2, 0);
    assert.deepEqual(next.order, [cId, aId, state.order[1]]);
  });

  it("nextTabId wraps around", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    state = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    state = addTab(state, { path: "/c.pdf", label: "c.pdf" });
    const aId = state.order[0];
    const bId = state.order[1];
    const cId = state.order[2];
    state = activateTab(state, cId);
    assert.equal(nextTabId(state), aId);
    state = activateTab(state, aId);
    assert.equal(nextTabId(state), bId);
  });

  it("previousTabId wraps around", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/a.pdf", label: "a.pdf" });
    state = addTab(state, { path: "/b.pdf", label: "b.pdf" });
    state = addTab(state, { path: "/c.pdf", label: "c.pdf" });
    const aId = state.order[0];
    const cId = state.order[2];
    state = activateTab(state, aId);
    assert.equal(previousTabId(state), cId);
    state = activateTab(state, cId);
    assert.equal(previousTabId(state), state.order[1]);
  });

  it("findByPath returns the tab id for a matching path, or null", () => {
    let state = createEmptyTabsState();
    state = addTab(state, { path: "/abs/a.pdf", label: "a.pdf" });
    state = addTab(state, { path: "/abs/b.pdf", label: "b.pdf" });
    assert.equal(findByPath(state, "/abs/b.pdf"), state.order[1]);
    assert.equal(findByPath(state, "/abs/missing.pdf"), null);
    assert.equal(findByPath(state, null), null);
  });

  it("nextTabId and previousTabId return null with zero tabs", () => {
    const state = createEmptyTabsState();
    assert.equal(nextTabId(state), null);
    assert.equal(previousTabId(state), null);
  });
});
