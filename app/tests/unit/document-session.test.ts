import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DocumentSession } from "../../src/lib/tabs/document-session";
import { MockAiChatService } from "../../src/lib/ai-chat/chat-service";

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

  it("owns and clears its extracted PDF page cache", () => {
    const a = new DocumentSession("a", null, "A");
    const b = new DocumentSession("b", null, "B");
    a.pdfContextPageCache.set(1, { id: "page-1", page: 1, text: "cached" });

    assert.equal(b.pdfContextPageCache.size, 0);
    a.close();
    assert.equal(a.pdfContextPageCache.size, 0);
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

  it("owns one AI Chat Session per Document Session (no shared chat state)", () => {
    const a = new DocumentSession("a", null, "A");
    const b = new DocumentSession("b", null, "B");
    a.aiChatSession.draft = "typed in a";
    a.aiChatSession.messages.push({ id: "user-turn-1", role: "user", content: "hello" });

    assert.equal(b.aiChatSession.messages.length, 0);
    assert.equal(b.aiChatSession.draft, "");
    assert.equal(a.aiChatSession.messages.length, 1);
  });

  it("disposes its AI Chat Session on close()", () => {
    const session = new DocumentSession("id-6", null, "Chat");
    session.aiChatSession.messages.push({ id: "user-turn-1", role: "user", content: "hello" });
    session.aiChatSession.draft = "unsent";
    session.aiChatSession.savedScrollTop = 250;

    session.close();
    // Disposed with its Document Session (issue #24 acceptance criterion) —
    // and a disposed session ignores later sends, so a reply resolving after
    // this close can never repopulate it.
    assert.equal(session.aiChatSession.messages.length, 0);
    assert.equal(session.aiChatSession.draft, "");
    assert.equal(session.aiChatSession.savedScrollTop, 0);
    assert.equal(session.aiChatSession.send(new MockAiChatService(), "late"), null);
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
