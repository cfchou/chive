import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activateTab,
  createDockState,
  hideSide,
  isSideVisible,
  moveTabToSide,
  showSide,
} from "../../src/lib/ui/dock-state";

describe("dock state", () => {
  it("starts with all tabs on the left and outline active", () => {
    const state = createDockState();

    assert.deepEqual(state.tabsBySide.left, ["outline", "bookmarks", "annotations"]);
    assert.deepEqual(state.tabsBySide.right, []);
    assert.equal(state.activeBySide.left, "outline");
    assert.equal(state.activeBySide.right, null);
  });

  it("activates a tab on its current side and shows that side", () => {
    let state = hideSide(createDockState(), "left");

    state = activateTab(state, "bookmarks");

    assert.equal(state.activeBySide.left, "bookmarks");
    assert.equal(isSideVisible(state, "left"), true);
  });

  it("moves tabs between sides and repairs active tabs", () => {
    let state = createDockState();

    state = moveTabToSide(state, "bookmarks", "right");

    assert.deepEqual(state.tabsBySide.left, ["outline", "annotations"]);
    assert.deepEqual(state.tabsBySide.right, ["bookmarks"]);
    assert.equal(state.activeBySide.right, "bookmarks");
    assert.equal(state.activeBySide.left, "outline");
  });

  it("hides and shows sides without losing tab order", () => {
    let state = createDockState();

    state = hideSide(state, "left");
    assert.equal(isSideVisible(state, "left"), false);

    state = showSide(state, "left");
    assert.equal(isSideVisible(state, "left"), true);
    assert.deepEqual(state.tabsBySide.left, ["outline", "bookmarks", "annotations"]);
  });
});
