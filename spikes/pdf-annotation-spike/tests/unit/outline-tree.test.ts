import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countOutlineEntries,
  countUnavailableOutlineEntries,
  flattenOutlineEntries,
  isOutlineEntryNavigable,
  outlineDestinationStatus,
  outlinePathToEntry,
  updateOutlineEntryColor,
  visibleActiveOutlineEntryId,
  type OutlineEntry,
} from "../../src/lib/pdf/outline-tree";

function entry(id: string, items: OutlineEntry[] = [], overrides: Partial<OutlineEntry> = {}): OutlineEntry {
  return {
    id,
    title: id,
    dest: [id],
    url: null,
    pageNumber: 1,
    targetY: null,
    pageHeight: null,
    color: null,
    colorDirty: false,
    destinationStatus: null,
    items,
    ...overrides,
  };
}

const tree = [entry("a", [entry("a1"), entry("a2", [entry("a2x")])]), entry("b")];

describe("outline tree operations", () => {
  it("counts entries recursively", () => {
    assert.equal(countOutlineEntries(tree), 5);
    assert.equal(countOutlineEntries([]), 0);
  });

  it("counts unavailable entries at any depth", () => {
    const withBroken = [entry("a", [entry("a1", [], { dest: null })]), entry("b", [], { pageNumber: null })];
    assert.equal(countUnavailableOutlineEntries(withBroken), 2);
    assert.equal(countUnavailableOutlineEntries(tree), 0);
  });

  it("treats url-only and dest+page entries as navigable", () => {
    assert.equal(isOutlineEntryNavigable(entry("u", [], { dest: null, url: "https://x" })), true);
    assert.equal(isOutlineEntryNavigable(entry("d")), true);
    assert.equal(isOutlineEntryNavigable(entry("n", [], { dest: null })), false);
    assert.equal(isOutlineEntryNavigable(entry("p", [], { pageNumber: null })), false);
  });

  it("describes destination availability", () => {
    assert.equal(outlineDestinationStatus(null, "https://x", null), "External link");
    assert.equal(outlineDestinationStatus(null, null, null), "No destination");
    assert.equal(outlineDestinationStatus(["d"], null, null), "Destination unavailable");
    assert.equal(outlineDestinationStatus(["d"], null, 3), null);
  });

  it("flattens depth-first preserving document order", () => {
    assert.deepEqual(
      flattenOutlineEntries(tree).map((item) => item.id),
      ["a", "a1", "a2", "a2x", "b"],
    );
  });

  it("finds the root-to-entry path", () => {
    assert.deepEqual(
      outlinePathToEntry(tree, "a2x").map((item) => item.id),
      ["a", "a2", "a2x"],
    );
    assert.deepEqual(outlinePathToEntry(tree, "missing"), []);
  });

  it("maps the active entry to its nearest collapsed ancestor", () => {
    const collapsed = (id: string) => id === "a";
    assert.equal(visibleActiveOutlineEntryId(tree, "a2x", collapsed), "a");
    assert.equal(visibleActiveOutlineEntryId(tree, "a2x", () => false), "a2x");
    assert.equal(visibleActiveOutlineEntryId(tree, null, collapsed), null);
    assert.equal(visibleActiveOutlineEntryId(tree, "missing", collapsed), null);
  });

  it("recolors one entry immutably and marks it dirty", () => {
    const updated = updateOutlineEntryColor(tree, "a2", "#a855f7");
    const recolored = outlinePathToEntry(updated, "a2").at(-1);
    assert.equal(recolored?.color, "#a855f7");
    assert.equal(recolored?.colorDirty, true);
    assert.equal(outlinePathToEntry(tree, "a2").at(-1)?.color, null);
    assert.equal(outlinePathToEntry(updated, "a2x").at(-1)?.colorDirty, false);
  });
});
