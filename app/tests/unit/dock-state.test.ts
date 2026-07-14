import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  activateTab,
  createDefaultDockState,
  hideSide,
  isSidebarTabId,
  isSideOpen,
  moveTabToSide,
  shouldShowEdgeReopen,
  showSide,
  sideHasTabs,
  sideOfTab,
} from "../../src/lib/ui/dock-state";

describe("dock-state", () => {
  it("recognizes only canonical sidebar tab ids", () => {
    assert.equal(isSidebarTabId("outline"), true);
    assert.equal(isSidebarTabId("ai-chat"), true);
    assert.equal(isSidebarTabId("unknown"), false);
    assert.equal(isSidebarTabId(undefined), false);
  });

  it("starts with document navigation on the left and AI Chat active on the right", () => {
    const state = createDefaultDockState();
    assert.deepEqual(state.order.left, ["outline", "bookmarks", "annotations"]);
    assert.deepEqual(state.order.right, ["ai-chat"]);
    assert.equal(state.active.left, "outline");
    assert.equal(state.active.right, "ai-chat");
    assert.equal(isSideOpen(state, "left"), true);
    assert.equal(isSideOpen(state, "right"), true);
  });

  it("activateTab selects the tab on its own side and unhides that side", () => {
    let state = hideSide(createDefaultDockState(), "left");
    state = activateTab(state, "outline");
    assert.equal(state.active.left, "outline");
    assert.equal(state.hidden.left, false);
  });

  it("moveTabToSide moves an inactive tab and keeps both actives valid", () => {
    const state = moveTabToSide(createDefaultDockState(), "annotations", "right");
    assert.deepEqual(state.order.left, ["outline", "bookmarks"]);
    assert.deepEqual(state.order.right, ["ai-chat", "annotations"]);
    assert.equal(state.active.left, "outline");
    assert.equal(state.active.right, "ai-chat");
  });

  it("moving the active tab keeps it active on the target side and falls back on the source side", () => {
    const state = moveTabToSide(createDefaultDockState(), "outline", "right");
    assert.equal(state.active.right, "outline");
    assert.equal(state.active.left, "bookmarks");
  });

  it("moveTabToSide inserts before the given tab", () => {
    let state = moveTabToSide(createDefaultDockState(), "annotations", "right");
    state = moveTabToSide(state, "outline", "right", "annotations");
    assert.deepEqual(state.order.right, ["ai-chat", "outline", "annotations"]);
  });

  it("moving a tab within its own side reorders it", () => {
    const state = moveTabToSide(createDefaultDockState(), "annotations", "left", "outline");
    assert.deepEqual(state.order.left, ["annotations", "outline", "bookmarks"]);
  });

  it("moving the last tab away empties the source side", () => {
    let state = createDefaultDockState();
    state = moveTabToSide(state, "outline", "right");
    state = moveTabToSide(state, "bookmarks", "right");
    state = moveTabToSide(state, "annotations", "right");
    assert.deepEqual(state.order.left, []);
    assert.equal(state.active.left, null);
    assert.equal(sideHasTabs(state, "left"), false);
    // Each move carried the source side's active tab along (mock behavior:
    // a moved selected tab stays selected on its target side).
    assert.equal(state.active.right, "annotations");
  });

  it("moving into a hidden side unhides it", () => {
    let state = moveTabToSide(createDefaultDockState(), "annotations", "right");
    state = hideSide(state, "right");
    state = moveTabToSide(state, "outline", "right");
    assert.equal(state.hidden.right, false);
  });

  it("hideSide only hides sides that have tabs and showSide restores them", () => {
    const emptyRight = moveTabToSide(createDefaultDockState(), "ai-chat", "left");
    assert.deepEqual(emptyRight.order.right, []);
    assert.equal(hideSide(emptyRight, "right").hidden.right, false);

    let state = createDefaultDockState();
    assert.equal(hideSide(state, "right").hidden.right, true);
    state = hideSide(state, "left");
    assert.equal(state.hidden.left, true);
    assert.equal(isSideOpen(state, "left"), false);
    assert.equal(shouldShowEdgeReopen(state, "left"), true);
    state = showSide(state, "left");
    assert.equal(isSideOpen(state, "left"), true);
  });

  it("sideOfTab reports the owning side", () => {
    const state = moveTabToSide(createDefaultDockState(), "outline", "right");
    assert.equal(sideOfTab(state, "outline"), "right");
    assert.equal(sideOfTab(state, "bookmarks"), "left");
  });
});
