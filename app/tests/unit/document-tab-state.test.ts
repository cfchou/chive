import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activateTab,
  addTab,
  findByPath,
  moveTab,
  nextTabId,
  previousTabId,
  removeTab,
  type DocumentTab,
  type DocumentTabsState,
} from "../../src/lib/tabs/tab-state";

describe("document tab state", () => {
  const first: DocumentTab = { id: "tab-1", path: "/tmp/a.pdf", label: "a.pdf" };
  const second: DocumentTab = { id: "tab-2", path: "/tmp/b.pdf", label: "b.pdf" };
  const third: DocumentTab = { id: "tab-3", path: null, label: "Draft" };

  it("adds a Document Tab and makes it the Active Document Tab", () => {
    const state = addTab(emptyState(), first);
    assert.deepEqual(state.order, ["tab-1"]);
    assert.equal(state.activeId, "tab-1");
    assert.deepEqual(state.tabs["tab-1"], first);
  });

  it("dedupes existing path-backed Document Tabs without changing path-less tabs", () => {
    let state = addTab(emptyState(), first);
    state = addTab(state, third);

    assert.equal(findByPath(state, "/tmp/a.pdf"), "tab-1");
    assert.equal(findByPath(state, "/tmp/missing.pdf"), null);
    assert.equal(findByPath(state, null), null);
  });

  it("removes the Active Document Tab and selects the nearest right tab, then left", () => {
    let state = withTabs(first, second, third);

    state = activateTab(state, "tab-2");
    state = removeTab(state, "tab-2");
    assert.deepEqual(state.order, ["tab-1", "tab-3"]);
    assert.equal(state.activeId, "tab-3");

    state = removeTab(state, "tab-3");
    assert.deepEqual(state.order, ["tab-1"]);
    assert.equal(state.activeId, "tab-1");
  });

  it("wraps previous and next lookup around the ordered Document Tabs", () => {
    const state = withTabs(first, second, third);
    assert.equal(nextTabId(state, "tab-1"), "tab-2");
    assert.equal(nextTabId(state, "tab-3"), "tab-1");
    assert.equal(previousTabId(state, "tab-1"), "tab-3");
    assert.equal(previousTabId(state, "tab-2"), "tab-1");
  });

  it("moves a Document Tab by source and target index", () => {
    const state = moveTab(withTabs(first, second, third), 0, 2);
    assert.deepEqual(state.order, ["tab-2", "tab-3", "tab-1"]);
    assert.equal(state.activeId, "tab-3");
  });
});

function emptyState(): DocumentTabsState {
  return { order: [], tabs: {}, activeId: null };
}

function withTabs(...tabs: DocumentTab[]): DocumentTabsState {
  return tabs.reduce((state, tab) => addTab(state, tab), emptyState());
}
