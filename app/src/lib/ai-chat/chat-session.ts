// AI Chat Session — the per-Document-Session conversation state (see
// CONTEXT.md): messages, the unsent AI Chat Composer draft, and the chat
// panel's scroll position. One Document Session owns exactly one of these
// (document-session.ts) and disposes it when the Document Tab closes.
//
// This is a plain class with no Svelte runes, for the same reasons as
// DocumentSession: inactive Document Tabs are not rendered, so the session
// needs no reactivity of its own (the shell mirrors the *active* session's
// values into its own `$state`), and staying rune-free keeps it unit-testable
// under Vitest.
//
// Ownership rules (PR #27 rev 3 — structural, not incidental):
//   - send() appends the user turn and the assistant reply to THIS session,
//     never to whichever Document Tab is visible when the reply resolves.
//     That is what makes "two Document Tabs never share chat messages" and
//     "follow-up turns remain in the active document's single session" hold
//     even for a reply that lands after a tab switch.
//   - Acceptance is synchronously observable: send() returns the completion
//     promise when accepted, null when not (disposed, or a send is already
//     pending). Callers must not treat an ignored send as accepted — the
//     shell clears the composer draft only on acceptance.
//   - Messages are append-only value objects: never mutated after creation.
//     This invariant is what makes the shallow request snapshot safe (the
//     service shares message references but can never observe a change).

import type { AiChatMessage } from "./types";
import type { AiChatRequest, AiChatService } from "./chat-service";

export class AiChatSession {
  /** Conversation so far, oldest first. Append-only; replaced only by dispose(). */
  messages: AiChatMessage[] = [];
  /**
   * Chat panel scroll offset. Captured by the shell on Document Tab
   * deactivate (and before cross-side dock moves, which recreate the panel
   * DOM); restored on activate.
   */
  savedScrollTop = 0;
  /** Unsent AI Chat Composer draft — per-document, like the messages. */
  draft = "";

  /** Set once by dispose(); a disposed session ignores everything after. */
  private disposed = false;
  /** True while one send() awaits its reply; guards overlapping sends (A2 rule — A3 replaces this with real generating state). */
  private pendingSend = false;
  /** Turn counter for deterministic, session-owned message ids. */
  private turnCount = 0;

  /**
   * Submit one user turn and eventually append the assistant reply.
   *
   * Returns the completion promise when the send is accepted; returns null —
   * appending nothing and calling nothing — when the session is disposed or a
   * send is already pending. The user turn is appended synchronously so the
   * composer's message is visible before the reply arrives.
   */
  send(service: AiChatService, text: string): Promise<void> | null {
    if (this.disposed || this.pendingSend) return null;
    this.pendingSend = true;
    this.turnCount += 1;
    this.messages.push({
      // Ids come from the session's own turn counter: deterministic (same
      // history → same ids) and unique within the session, which is all
      // Svelte's keyed {#each} needs.
      id: `user-turn-${this.turnCount}`,
      role: "user",
      content: text,
    });
    // Independent array snapshot: a fresh array, never the live one, so the
    // service can never observe turns appended after this call. The message
    // objects themselves are shared — safe per the append-only invariant.
    return this.completeSend(service, { messages: [...this.messages] }, this.turnCount);
  }

  private async completeSend(
    service: AiChatService,
    request: AiChatRequest,
    turn: number,
  ): Promise<void> {
    try {
      const reply = await service.complete(request);
      // The owning Document Tab may have closed during the await; a disposed
      // session discards the late reply instead of repopulating itself.
      if (this.disposed) return;
      this.messages.push({
        id: `assistant-turn-${turn}`,
        role: "assistant",
        content: reply.content,
        // Copy the (possibly frozen/readonly) provider array into the UI
        // model's own mutable array type.
        citations: reply.citations ? [...reply.citations] : undefined,
      });
    } finally {
      // Reset even on rejection so a failing service cannot wedge the session
      // (A2 has no error UI — A3 owns error states — but the model must not
      // corrupt itself in the meantime).
      this.pendingSend = false;
    }
  }

  /** Drop all conversation state when the owning Document Session closes. */
  dispose(): void {
    this.disposed = true;
    this.messages = [];
    this.draft = "";
    this.savedScrollTop = 0;
  }
}
