// AI Chat Session — the per-Document-Session conversation state (see
// CONTEXT.md): the committed messages, the in-flight (still streaming) reply,
// the generation status, the unsent AI Chat Composer draft, and the chat
// panel's scroll position. One Document Session owns exactly one of these
// (document-session.ts) and disposes it when the Document Tab closes.
//
// This is a plain class with no Svelte runes, for the same reasons as
// DocumentSession: inactive Document Tabs are not rendered, so the session
// needs no reactivity of its own (the shell mirrors the *active* session's
// values into its own `$state`), and staying rune-free keeps it unit-testable
// under Vitest. Because it is not reactive, the session tells the shell when
// something changed by calling `onChange` (set by the shell).
//
// Ownership rules (carried from A2, PR #27 rev 3 — structural, not incidental):
//   - a generation appends its turns to THIS session, never to whichever
//     Document Tab is visible when a chunk or the reply arrives. That is what
//     makes "two Document Tabs never share chat messages" hold even for a
//     reply that lands after a tab switch.
//   - Acceptance is synchronously observable: send() returns the completion
//     promise when accepted, null when not (disposed, or a send is already in
//     flight). The shell clears the composer draft only on acceptance.
//   - Committed messages are append-only value objects: never mutated after
//     creation. This is what makes the shallow request snapshot safe (the
//     service shares message references but can never observe a change). The
//     streaming reply lives in `inFlightContent`, OUTSIDE `messages`, until it
//     is committed as one finished assistant turn — so the invariant holds
//     even while text is arriving.
//
// The generation state machine (A3, issue #25):
//
//     idle ──send()──▶ generating ──complete──▶ idle
//                          │  ├─stop()──▶ idle (partial content kept)
//                          │  └─fail────▶ error ──retry()/send()──▶ generating
//
// At most one generation runs at a time, tracked by an AbortController. Stop
// and dispose abort it; any chunk or settlement from a superseded generation
// (its controller is no longer the current one) is ignored.

import type { AiChatCitation, AiChatMessage, AiChatSourceRef } from "./types";
import type { AiChatRequest, AiChatService } from "./chat-service";
import type { AiChatRequestContext } from "./pdf-context";

export type AiChatStatus = "idle" | "generating" | "error";

// Shown to the user when a generation fails. Deliberately generic: the
// service's own Error text is a test/implementation detail, not product copy.
const GENERATION_ERROR_MESSAGE = "The response could not be generated.";
const CONTEXT_ERROR_MESSAGE = "The document context could not be prepared.";
type ContextFactory = (signal: AbortSignal) => Promise<AiChatRequestContext>;

export class AiChatSession {
  /** Finished turns, oldest first. Append-only; replaced only by dispose(). */
  messages: AiChatMessage[] = [];
  /** Where the generation lifecycle currently is. */
  status: AiChatStatus = "idle";
  /** User-facing failure text while `status === "error"`, else null. */
  errorMessage: string | null = null;
  /** The reply text streamed so far, shown as a live bubble while generating. */
  inFlightContent = "";
  /**
   * Chat panel scroll offset. Captured by the shell on Document Tab
   * deactivate (and before cross-side dock moves, which recreate the panel
   * DOM); restored on activate.
   */
  savedScrollTop = 0;
  /** Unsent AI Chat Composer draft — per-document, like the messages. */
  draft = "";
  /** Context chips removed from this document's composer. */
  dismissedContextIds: string[] = [];
  /**
   * Called by the session after every observable change (a chunk, a state
   * transition, a committed turn). The shell sets this to re-mirror the active
   * session; an inactive session's callback simply declines to re-mirror.
   */
  onChange: (() => void) | null = null;

  /** Set once by dispose(); a disposed session ignores everything after. */
  private disposed = false;
  /** Turn counter for deterministic, session-owned message ids. */
  private turnCount = 0;
  /** The turn number the active generation will commit its assistant reply as. */
  private activeTurn = 0;
  /**
   * The active generation's controller, or null when idle/error. Doubles as
   * the "which generation is current" token: a chunk or settlement whose
   * controller is not this one belongs to a superseded generation and is
   * dropped. Aborting it cancels the underlying service work.
   */
  private controller: AbortController | null = null;
  /** Reused by Retry after a failed provider call or context extraction. */
  private pendingContextFactory: ContextFactory | null = null;
  /** Source ids that may become live AI Chat Page Citations for this run. */
  private snapshotPages: Map<string, number> | null = null;

  /**
   * Submit one user turn and start generating a reply.
   *
   * Returns the completion promise when accepted; returns null — appending
   * nothing, starting nothing — when the session is disposed or a generation
   * is already running. Sending from the error state is allowed and clears the
   * error. The user turn is appended synchronously so the composer's message
   * is visible before the reply begins.
   *
   * The returned promise never rejects: a failure becomes `status: "error"`,
   * not a thrown error, because the caller (the shell) reacts to state, not to
   * exceptions.
   */
  send(service: AiChatService, text: string, contextFactory?: ContextFactory): Promise<void> | null {
    if (this.disposed || this.status === "generating") return null;
    this.pendingContextFactory = contextFactory ?? null;
    this.dismissedContextIds = [];
    this.errorMessage = null;
    this.turnCount += 1;
    this.messages.push({
      // Ids come from the session's own turn counter: deterministic (same
      // history → same ids) and unique within the session, which is all
      // Svelte's keyed {#each} needs.
      id: `user-turn-${this.turnCount}`,
      role: "user",
      content: text,
    });
    return this.startGeneration(service, this.turnCount);
  }

  /**
   * Re-run the last (failed) turn. Only meaningful in the error state; returns
   * null otherwise. No new user turn is added — the conversation already ends
   * with the user turn that failed — so at most one assistant turn is ever
   * committed per user turn.
   */
  retry(service: AiChatService): Promise<void> | null {
    if (this.disposed || this.status !== "error") return null;
    this.errorMessage = null;
    return this.startGeneration(service, this.turnCount);
  }

  /**
   * Cancel the active generation. Keeps whatever text has streamed so far as a
   * finished assistant turn (with no citations — those belong to a natural
   * completion only) and returns to idle. A no-op unless generating. This is
   * synchronous on purpose: the moment it returns the session is idle, so an
   * immediately following send() is accepted.
   */
  stop(): void {
    if (this.status !== "generating") return;
    const partial = this.inFlightContent;
    const turn = this.activeTurn;
    // Supersede the running generation BEFORE aborting, not after. Abort
    // listeners run synchronously, so a service that flushes one last chunk on
    // abort would otherwise still look current and have that chunk accepted.
    // Dropping the controller first makes those callbacks fail their guard.
    const controller = this.controller;
    this.controller = null;
    controller?.abort();
    this.pendingContextFactory = null;
    this.snapshotPages = null;
    this.inFlightContent = "";
    this.status = "idle";
    if (partial.length > 0) this.commitAssistant(turn, partial);
    this.notify();
  }

  /** Drop all conversation state when the owning Document Session closes. */
  dispose(): void {
    this.disposed = true;
    // Cancel any active generation so its service work stops and its late
    // callbacks are ignored.
    this.controller?.abort();
    this.controller = null;
    this.messages = [];
    this.draft = "";
    this.dismissedContextIds = [];
    this.savedScrollTop = 0;
    this.inFlightContent = "";
    this.status = "idle";
    this.errorMessage = null;
    this.pendingContextFactory = null;
    this.snapshotPages = null;
    this.onChange = null;
  }

  private startGeneration(service: AiChatService, turn: number): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.activeTurn = turn;
    this.status = "generating";
    this.inFlightContent = "";
    this.snapshotPages = null;
    // The user turn (or the cleared error) plus the generating state are now
    // observable; let the shell mirror them before the first chunk arrives.
    this.notify();
    // Independent array snapshot: a fresh array, never the live one, so the
    // service can never observe turns appended after this call. The message
    // objects themselves are shared — safe per the append-only invariant.
    const request: AiChatRequest = { messages: [...this.messages] };
    return this.runGeneration(service, request, turn, controller);
  }

  private async runGeneration(
    service: AiChatService,
    request: AiChatRequest,
    turn: number,
    controller: AbortController,
  ): Promise<void> {
    let preparingContext = false;
    try {
      if (this.pendingContextFactory) {
        preparingContext = true;
        request.context = await this.pendingContextFactory(controller.signal);
        preparingContext = false;
        if (this.controller !== controller || this.disposed) return;
        this.snapshotPages = new Map(request.context.sources.map((source) => [source.id, source.page]));
        if (request.context.selection) {
          this.snapshotPages.set(request.context.selection.id, request.context.selection.page);
        }
      }
      const reply = await service.generate(
        request,
        (text) => {
          // Ignore chunks from a superseded (stopped/re-sent) or disposed
          // generation — only the current controller's stream may write.
          if (this.controller !== controller || this.disposed) return;
          this.inFlightContent += text;
          this.notify();
        },
        controller.signal,
      );
      // The generation may have been superseded or the tab closed while the
      // final reply was in flight; if so, discard it.
      if (this.controller !== controller || this.disposed) return;
      this.commitAssistant(turn, reply.content, this.resolveCitations(reply.sourceRefs));
      this.inFlightContent = "";
      this.status = "idle";
      this.controller = null;
      this.pendingContextFactory = null;
      this.snapshotPages = null;
      this.notify();
    } catch (error) {
      // A superseded/disposed generation owns none of the state anymore
      // (stop() and dispose() already handled it), so drop the rejection.
      if (this.controller !== controller || this.disposed) return;
      // A genuine failure (not an abort, which only stop()/dispose() trigger,
      // and both null the controller so they are caught above) → error state.
      this.inFlightContent = "";
      this.status = "error";
      this.errorMessage = preparingContext ? CONTEXT_ERROR_MESSAGE : GENERATION_ERROR_MESSAGE;
      this.controller = null;
      this.snapshotPages = null;
      this.notify();
    }
  }

  private commitAssistant(turn: number, content: string, citations?: readonly AiChatCitation[]): void {
    this.messages.push({
      id: `assistant-turn-${turn}`,
      role: "assistant",
      content,
      // Copy the citation OBJECTS, not just the array. A committed message is
      // an append-only value object — that promise is what makes handing the
      // service a shallow request snapshot safe. Keeping a provider's own
      // objects would put that promise in the provider's hands: anything it
      // did to them afterwards would reach inside a message we already
      // committed. The session cannot vet arbitrary providers, so it copies.
      citations: citations?.map((citation) => ({ ...citation })),
    });
  }

  private resolveCitations(sourceRefs?: readonly AiChatSourceRef[]): AiChatCitation[] | undefined {
    if (!sourceRefs?.length || !this.snapshotPages) return undefined;
    const seen = new Set<string>();
    const citations: AiChatCitation[] = [];
    for (const sourceRef of sourceRefs) {
      if (seen.has(sourceRef.id)) continue;
      seen.add(sourceRef.id);
      const page = this.snapshotPages.get(sourceRef.id);
      if (page === undefined) {
        console.debug(`Dropped AI Chat source ref that is not in the Context Snapshot: ${sourceRef.id}`);
        continue;
      }
      citations.push({ id: sourceRef.id, page });
    }
    return citations.length ? citations : undefined;
  }

  private notify(): void {
    if (this.disposed) return;
    this.onChange?.();
  }
}
