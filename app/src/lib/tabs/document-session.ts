// A Document Session is the per-tab runtime unit for one open PDF (see
// CONTEXT.md). It owns that tab's live pdf.js instances, its viewer DOM refs,
// its annotation caches, and — while the tab is inactive — a snapshot of the
// scalar/derived UI state that the shell mirrors into its reactive `$state`
// when the tab is active.
//
// This is a plain class (no Svelte runes): inactive tabs are not rendered, so
// the session needs no reactivity of its own. The active tab's live values are
// held in the shell component's `$state`; on switch the shell captures those
// into the outgoing session's `snapshot` and restores them from the incoming
// session. Keeping it rune-free also keeps it unit-testable under Vitest.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { AnnotationEditorUIManager } from "../pdf/pdfjs-quirks";
import { AiChatSession } from "../ai-chat/chat-session";
import type { PdfPageSource } from "../ai-chat/pdf-context";

/**
 * Opaque bag of the shell's scalar/derived per-document `$state` (outline,
 * bookmark, annotation entries, dirty flag, tool, zoom, …). Produced and
 * consumed only by the shell's capture/restore, so it is intentionally untyped
 * here — the shell owns the field list and its types.
 */
export type DocumentSnapshot = Record<string, unknown>;

export class DocumentSession {
  readonly id: string;
  /** Absolute file path, or null for a path-less tab (sample, dropped bytes). */
  path: string | null;
  /** Display label for the tab (PDF basename, or a synthetic name). */
  label: string;

  // Live pdf.js instances — populated while this session's document is loaded,
  // kept alive (not destroyed) while the tab is merely inactive so its editor
  // undo/redo history survives tab switches.
  pdfViewer: PDFViewer | null = null;
  pdfLinkService: PDFLinkService | null = null;
  pdfDocument: PDFDocumentProxy | null = null;
  annotationEditorUIManager: AnnotationEditorUIManager | null = null;
  eventBus: EventBus | null = null;

  // Per-tab viewer DOM. Bound from the shell's `{#each}` over sessions.
  containerEl: HTMLDivElement | null = null;
  viewerEl: HTMLDivElement | null = null;
  /** Scroll offset captured on deactivate; restored on activate. */
  savedScrollTop = 0;

  // Per-tab annotation caches (see +page.svelte for their roles). Each session
  // owns its own so two open documents never share annotation bookkeeping.
  readonly annotationDetailCache = new Map<string, string>();
  readonly pendingDeletedPersistedAnnotationKeys = new Set<string>();
  readonly persistedAnnotationKeyByEditorId = new Map<string, string>();
  readonly persistedPositionByKey = new Map<string, { top: number; left: number }>();
  /** Extracted page text is immutable until this Document Session closes. */
  readonly pdfContextPageCache = new Map<number, PdfPageSource>();

  /** Scalar/derived UI state, held only while this tab is inactive. */
  snapshot: DocumentSnapshot | null = null;

  /**
   * The one AI Chat Session backing this Document Tab's conversation (issue
   * #24: one document → one session → multiple turns). Owned here — not by
   * the shell — so that a reply resolving after a tab switch still lands in
   * the right conversation, and so close() below disposes chat state together
   * with the rest of the session.
   */
  readonly aiChatSession = new AiChatSession();

  constructor(id: string, path: string | null, label: string) {
    this.id = id;
    this.path = path;
    this.label = label;
  }

  /** Tear down live refs and per-tab bookkeeping when the tab closes. */
  close(): void {
    this.pdfViewer = null;
    this.pdfLinkService = null;
    this.pdfDocument = null;
    this.annotationEditorUIManager = null;
    this.eventBus = null;
    this.containerEl = null;
    this.viewerEl = null;
    this.savedScrollTop = 0;
    this.annotationDetailCache.clear();
    this.pendingDeletedPersistedAnnotationKeys.clear();
    this.persistedAnnotationKeyByEditorId.clear();
    this.persistedPositionByKey.clear();
    this.pdfContextPageCache.clear();
    this.snapshot = null;
    // Dispose the AI Chat Session with its Document Session: drops the
    // conversation and makes the session discard any reply still in flight.
    this.aiChatSession.dispose();
  }
}
