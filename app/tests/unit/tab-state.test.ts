import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  activeIdAfterClose,
  findTabIdByPath,
  moveTab,
  nextTabId,
  previousTabId,
} from "../../src/lib/tabs/tab-state";

describe("findTabIdByPath (dedupe)", () => {
  const tabs = [
    { id: "a", path: "/x/one.pdf" },
    { id: "b", path: null },
    { id: "c", path: "/x/two.pdf" },
  ];
  it("finds an open tab by its absolute path", () => {
    assert.equal(findTabIdByPath(tabs, "/x/two.pdf"), "c");
  });
  it("returns null when the path is not open", () => {
    assert.equal(findTabIdByPath(tabs, "/x/three.pdf"), null);
  });
  it("never matches a path-less tab", () => {
    assert.equal(findTabIdByPath(tabs, ""), null);
    // a query for a real path must not collapse onto the path-less tab
    assert.equal(findTabIdByPath([{ id: "b", path: null }], "/x/one.pdf"), null);
  });
});

describe("nextTabId / previousTabId (wrap-around)", () => {
  const order = ["a", "b", "c"];
  it("advances and wraps forward", () => {
    assert.equal(nextTabId(order, "a"), "b");
    assert.equal(nextTabId(order, "c"), "a");
  });
  it("advances and wraps backward", () => {
    assert.equal(previousTabId(order, "b"), "a");
    assert.equal(previousTabId(order, "a"), "c");
  });
  it("handles empty / unknown / single", () => {
    assert.equal(nextTabId([], null), null);
    assert.equal(nextTabId(order, null), "a");
    assert.equal(previousTabId(order, null), "c");
    assert.equal(nextTabId(["only"], "only"), "only");
  });
});

describe("activeIdAfterClose", () => {
  const order = ["a", "b", "c", "d"];
  it("keeps the active tab when a different tab closes", () => {
    assert.equal(activeIdAfterClose(order, "b", "a"), "a");
  });
  it("selects the nearest right neighbor when the active tab closes", () => {
    assert.equal(activeIdAfterClose(order, "b", "b"), "c");
  });
  it("falls back to the left neighbor when closing the last tab", () => {
    assert.equal(activeIdAfterClose(order, "d", "d"), "c");
  });
  it("returns null when the only tab closes", () => {
    assert.equal(activeIdAfterClose(["a"], "a", "a"), null);
  });
});

describe("moveTab (reorder)", () => {
  it("moves a tab forward", () => {
    assert.deepEqual(moveTab(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  });
  it("moves a tab backward", () => {
    assert.deepEqual(moveTab(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  });
  it("is a no-op for equal indices", () => {
    assert.deepEqual(moveTab(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  });
  it("clamps out-of-range indices instead of dropping tabs", () => {
    assert.deepEqual(moveTab(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
    assert.deepEqual(moveTab(["a", "b", "c"], -3, 1), ["b", "a", "c"]);
  });
});
