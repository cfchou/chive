import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DocumentSession } from "../../src/lib/tabs/document-session";

describe("DocumentSession", () => {
  it("carries identity, path, and label", () => {
    const session = new DocumentSession("id-1", "/docs/report.pdf", "report.pdf");
    assert.equal(session.id, "id-1");
    assert.equal(session.path, "/docs/report.pdf");
    assert.equal(session.label, "report.pdf");
  });

  it("allows a path-less session (e.g. sample or dropped bytes)", () => {
    const session = new DocumentSession("id-2", null, "Sample");
    assert.equal(session.path, null);
    assert.equal(session.label, "Sample");
  });

  it("gives each session its own annotation caches (no shared state)", () => {
    const a = new DocumentSession("a", null, "A");
    const b = new DocumentSession("b", null, "B");
    a.annotationDetailCache.set("k", "v");
    a.pendingDeletedPersistedAnnotationKeys.add("1:2R");
    a.persistedAnnotationKeyByEditorId.set("e1", "1:2R");
    a.persistedPositionByKey.set("1:2R", { top: 10, left: 20 });

    assert.equal(b.annotationDetailCache.size, 0);
    assert.equal(b.pendingDeletedPersistedAnnotationKeys.size, 0);
    assert.equal(b.persistedAnnotationKeyByEditorId.size, 0);
    assert.equal(b.persistedPositionByKey.size, 0);
    assert.equal(a.annotationDetailCache.get("k"), "v");
    assert.deepEqual(a.persistedPositionByKey.get("1:2R"), { top: 10, left: 20 });
  });

  it("starts with no live viewer refs and a zero scroll offset", () => {
    const session = new DocumentSession("id-3", null, "New");
    assert.equal(session.pdfViewer, null);
    assert.equal(session.pdfDocument, null);
    assert.equal(session.annotationEditorUIManager, null);
    assert.equal(session.containerEl, null);
    assert.equal(session.viewerEl, null);
    assert.equal(session.savedScrollTop, 0);
    assert.equal(session.snapshot, null);
  });

  it("round-trips a scalar snapshot bag", () => {
    const session = new DocumentSession("id-4", null, "Snap");
    const snap = { isDirty: true, status: "Rendered", zoomPercent: 172 };
    session.snapshot = snap;
    assert.deepEqual(session.snapshot, snap);
  });

  it("resets its live refs and caches on close()", () => {
    const session = new DocumentSession("id-5", null, "Close");
    session.savedScrollTop = 500;
    session.annotationDetailCache.set("k", "v");
    session.snapshot = { isDirty: true };
    session.close();
    assert.equal(session.pdfViewer, null);
    assert.equal(session.pdfDocument, null);
    assert.equal(session.annotationDetailCache.size, 0);
    assert.equal(session.snapshot, null);
  });
});
