import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boundsOverlapRatio,
  boundsOverlapSignificantly,
  groupAnnotationEntriesByPage,
  numbersFromNumericRecord,
  rectCenterDistance,
  type AnnotationEntry,
} from "../../src/lib/pdf/annotation-sidebar";
import { sortBookmarkEntries, type BookmarkEntry } from "../../src/lib/pdf/bookmarks";
import { explicitDestinationRef, pdfRefString } from "../../src/lib/pdf/outline-tree";
import {
  annotationCountLabel,
  bookmarkCountLabel,
  firstWords,
  formatError,
  itemCountLabel,
} from "../../src/lib/format";

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

function annotationEntry(page: number, id: string): AnnotationEntry {
  return {
    id,
    sourceId: id,
    source: "pdf",
    page,
    kind: "highlight",
    label: "Highlight",
    detail: id,
    color: null,
    bounds: null,
    targetIndex: 0,
    sortTop: 0,
    sortLeft: 0,
  };
}

function bookmark(id: string, pageNumber: number, targetY: number): BookmarkEntry {
  return {
    id,
    title: id,
    pageNumber,
    pageRef: "1 0 R",
    pageHeight: 792,
    targetY,
    destinationY: targetY,
    color: null,
  };
}

describe("misc pure utilities", () => {
  it("computes overlap ratio against the smaller rect", () => {
    assert.equal(boundsOverlapRatio(rect(0, 0, 10, 10), rect(0, 0, 5, 5)), 1);
    assert.equal(boundsOverlapRatio(rect(0, 0, 10, 10), rect(5, 5, 15, 15)), 0.25);
    assert.equal(boundsOverlapRatio(rect(0, 0, 10, 10), rect(20, 20, 30, 30)), 0);
    assert.equal(boundsOverlapRatio(rect(0, 0, 0, 0), rect(0, 0, 10, 10)), 0);
  });

  it("keeps the significant-overlap threshold at ratio > 0.55", () => {
    assert.equal(boundsOverlapSignificantly(rect(0, 0, 10, 10), rect(0, 0, 10, 5.6)), true);
    assert.equal(boundsOverlapSignificantly(rect(0, 0, 10, 10), rect(5, 0, 15, 10)), false);
  });

  it("measures center-to-center distance", () => {
    assert.equal(rectCenterDistance(rect(0, 0, 2, 2), rect(3, 4, 5, 6)), 5);
    assert.equal(rectCenterDistance(rect(0, 0, 2, 2), rect(0, 0, 2, 2)), 0);
  });

  it("reads numeric records in index order and passes arrays through", () => {
    assert.deepEqual(numbersFromNumericRecord({ 1: 20, 0: 10, 2: 30 }), [10, 20, 30]);
    assert.deepEqual(numbersFromNumericRecord({ 0: 1, x: 2, 1: Number.NaN }), [1]);
    assert.deepEqual(numbersFromNumericRecord([4, 5]), [4, 5]);
    assert.deepEqual(numbersFromNumericRecord(null), []);
  });

  it("groups consecutive annotation entries by page", () => {
    const groups = groupAnnotationEntriesByPage([
      annotationEntry(1, "a"),
      annotationEntry(1, "b"),
      annotationEntry(2, "c"),
    ]);
    assert.deepEqual(
      groups.map((group) => ({ page: group.page, ids: group.entries.map((entry) => entry.id) })),
      [
        { page: 1, ids: ["a", "b"] },
        { page: 2, ids: ["c"] },
      ],
    );
  });

  it("sorts bookmarks by page, then top-of-page first, then id", () => {
    const sorted = sortBookmarkEntries([
      bookmark("b", 2, 100),
      bookmark("a", 1, 100),
      bookmark("c", 1, 700),
      bookmark("d", 1, 100),
    ]);
    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ["c", "a", "d", "b"],
    );
  });

  it("formats PDF object references and explicit destination refs", () => {
    assert.equal(pdfRefString({ num: 6, gen: 0 }), "6 0 R");
    assert.equal(pdfRefString({ num: 6 }), "6 0 R");
    assert.equal(pdfRefString({ gen: 0 }), null);
    assert.equal(pdfRefString(null), null);
    assert.deepEqual(explicitDestinationRef([{ num: 6 }, "XYZ"]), { num: 6 });
    assert.equal(explicitDestinationRef("named"), null);
  });

  it("takes the first words and strips trailing punctuation", () => {
    assert.equal(firstWords("  One   two three, four five  ", 4), "One two three, four");
    assert.equal(firstWords("Alpha beta.", 4), "Alpha beta");
    assert.equal(firstWords("   ", 4), "");
  });

  it("formats errors and pluralizes count labels", () => {
    assert.equal(formatError(new Error("boom")), "boom");
    assert.equal(formatError("plain"), "plain");
    assert.equal(itemCountLabel(1), "1 item");
    assert.equal(itemCountLabel(2), "2 items");
    assert.equal(bookmarkCountLabel(0), "0 bookmarks");
    assert.equal(annotationCountLabel(1), "1 annotation");
  });
});
