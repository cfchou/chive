import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pdfAnnotationElementId,
  persistedAnnotationKey,
  persistedAnnotationKeyParts,
  sourceIdFromPdfAnnotationElementId,
} from "../../src/lib/pdf/annotation-keys";

describe("persisted annotation key codecs", () => {
  it("round-trips a page/source pair through the persisted key", () => {
    const key = persistedAnnotationKey(3, "12R");
    assert.equal(key, "3:12R");
    assert.deepEqual(persistedAnnotationKeyParts(key), { pageNumber: 3, sourceId: "12R" });
  });

  it("keeps colons inside the source id intact", () => {
    const parts = persistedAnnotationKeyParts(persistedAnnotationKey(7, "a:b:c"));
    assert.deepEqual(parts, { pageNumber: 7, sourceId: "a:b:c" });
  });

  it("rejects malformed persisted keys", () => {
    assert.equal(persistedAnnotationKeyParts("no-separator"), null);
    assert.equal(persistedAnnotationKeyParts("0:src"), null);
    assert.equal(persistedAnnotationKeyParts("2.5:src"), null);
    assert.equal(persistedAnnotationKeyParts("3:"), null);
    assert.equal(persistedAnnotationKeyParts(undefined as unknown as string), null);
  });

  it("round-trips source ids through the pdf.js element id prefix", () => {
    const elementId = pdfAnnotationElementId("12R");
    assert.equal(elementId, "pdfjs_internal_id_12R");
    assert.equal(pdfAnnotationElementId(elementId), elementId);
    assert.equal(sourceIdFromPdfAnnotationElementId(elementId), "12R");
    assert.equal(sourceIdFromPdfAnnotationElementId("plain"), "plain");
    assert.equal(sourceIdFromPdfAnnotationElementId(""), null);
  });
});
