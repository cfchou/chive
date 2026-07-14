// AI Chat Service — the UI-facing seam between the AI Chat Sidebar's state
// (AI Chat Session, see chat-session.ts) and whatever produces assistant
// replies. In M1 the only implementation is the deterministic mock below; a
// real provider replaces it later WITHOUT touching the AI Chat Sidebar
// components, because those components never import a service implementation —
// the shell owns the wiring. That seam *location* is the stable guarantee.
//
// A2-ONLY SHAPE: `complete()` is one atomic completion per request. A3
// (issue #25: streaming, errors, cancellation) is expected to reshape this
// operation; do not treat the signature as stable.
//
// Data-ownership rule (review amendment, 2026-07-14): a reply carries only
// content and citations. UI message identity (id) and authorship (role) belong
// to the AI Chat Session — a provider must never construct Chive's UI model.

import type { AiChatCitation, AiChatMessage } from "./types";

/** What a provider answers with. Deliberately NOT an AiChatMessage. */
export type AiChatReply = {
  content: string;
  citations?: readonly AiChatCitation[];
};

export type AiChatRequest = {
  /**
   * Independent array snapshot of the conversation, oldest first, ending with
   * the just-submitted user turn. Never an alias of a session's live array.
   * Element objects are shared by reference — safe because AI Chat Messages
   * are append-only value objects, never mutated after creation.
   */
  messages: readonly AiChatMessage[];
};

export interface AiChatService {
  /** Resolve exactly one assistant reply for the conversation so far. */
  complete(request: AiChatRequest): Promise<AiChatReply>;
}

// Scripted replies, keyed by the exact text of the final user turn. Fixed
// known-good literals: browser and native regression tests key off these
// strings, so change them only together with that coverage. The page numbers
// are arbitrary but stable — they cite the bundled sample PDF.
const scriptedReplies: ReadonlyMap<string, AiChatReply> = new Map<string, AiChatReply>([
  [
    "Summarize this PDF",
    {
      content:
        "Mock summary: the document introduces its subject, develops one main argument, and closes with supporting evidence.",
      citations: [{ id: "mock-summary-page-1", page: 1 }],
    },
  ],
  [
    "Explain the current page",
    {
      content: "Mock explanation: the current page elaborates the main argument with a worked example.",
      citations: [{ id: "mock-explain-page-2", page: 2 }],
    },
  ],
]);

/**
 * Deterministic mock AI Chat Service: no network, no randomness, no timers,
 * no wall-clock reads. Same request → same reply, always — including across
 * instances (the class holds no mutable state at all).
 */
export class MockAiChatService implements AiChatService {
  complete(request: AiChatRequest): Promise<AiChatReply> {
    const lastMessage = request.messages[request.messages.length - 1];
    const prompt = lastMessage?.content ?? "";
    const scripted = scriptedReplies.get(prompt);
    if (scripted) return Promise.resolve(scripted);
    // Fallback for unscripted prompts. Folding in the user-turn count keeps
    // distinct turns distinguishable in assertions even when the prompt text
    // repeats (e.g. two tabs both sending "hello").
    const userTurnCount = request.messages.filter((message) => message.role === "user").length;
    return Promise.resolve({
      content: `Mock reply #${userTurnCount}: you asked "${prompt}"`,
    });
  }
}

/**
 * Shared instance for the shell. A singleton is safe precisely because the
 * mock is stateless; a real provider with per-conversation state would be
 * constructed per use instead.
 */
export const mockAiChatService = new MockAiChatService();
