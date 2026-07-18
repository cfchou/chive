// AI Chat Service — the UI-facing seam between the AI Chat Sidebar's state
// (AI Chat Session, see chat-session.ts) and whatever produces assistant
// replies. In M1 the only implementation is the deterministic mock below; a
// real provider replaces it later WITHOUT touching the AI Chat Sidebar
// components, because those components never import a service implementation —
// the shell owns the wiring. That seam *location* is the stable guarantee.
//
// A3 SHAPE (issue #25): a reply is STREAMED. generate() calls onChunk with
// text fragments in order, then settles with the whole reply; it rejects with
// the abort signal's reason when cancelled, or with an ordinary Error when a
// scripted prompt is meant to fail. This replaces A2's one-shot complete().
//
// Determinism rule: the *content* of a reply — its chunk sequence and its
// source references — is a pure function of the request, identical across instances.
// Only *timing* varies, and only through the injected `delay`, so tests can
// swap in a hand-pumped fake and never touch a real clock. The default delay
// is a plain, abortable setTimeout.
//
// Data-ownership rule (unchanged from A2): a reply carries only content and
// source references. UI message identity (id) and authorship (role) belong to the AI
// Chat Session — a provider must never construct Chive's UI model.

import type { AiChatMessage, AiChatSourceRef } from "./types";
import { formatOmittedPageRange, type AiChatRequestContext } from "./pdf-context";

/** What a provider answers with. Deliberately NOT an AiChatMessage. */
export type AiChatReply = {
  content: string;
  sourceRefs?: readonly AiChatSourceRef[];
};

export type AiChatRequest = {
  /**
   * Independent array snapshot of the conversation, oldest first, ending with
   * the just-submitted user turn. Never an alias of a session's live array.
   * Element objects are shared by reference — safe because AI Chat Messages
   * are append-only value objects, never mutated after creation.
   */
  messages: readonly AiChatMessage[];
  /** Frozen PDF data prepared for this request, when a document is available. */
  context?: AiChatRequestContext;
};

/** Called once per streamed fragment, in order, before generate() settles. */
export type AiChatChunkSink = (text: string) => void;

export interface AiChatService {
  /**
   * Stream one assistant reply for the conversation so far. Calls `onChunk`
   * zero or more times with content fragments (in order), then resolves with
   * the full reply. Rejects with `signal.reason` if aborted, or with an Error
   * if the (scripted) reply is meant to fail. After it settles, `onChunk` is
   * never called again.
   */
  generate(request: AiChatRequest, onChunk: AiChatChunkSink, signal: AbortSignal): Promise<AiChatReply>;
}

// How long to wait before the first fragment, and between later fragments.
// Small enough to feel instant in the app, exported so tests can reason about
// them instead of hard-coding magic numbers.
export const FIRST_CHUNK_DELAY_MS = 400;
export const CHUNK_GAP_DELAY_MS = 40;
// The "Respond slowly" script never reaches its first chunk inside a test:
// its long first delay is the stable place to observe the generating state and
// to Stop before any content arrives.
export const SLOW_FIRST_CHUNK_DELAY_MS = 10_000;
// The "Pause after the first chunk" script emits one chunk fast, then waits
// this long before each remaining chunk — a deterministic window in which a
// test can Stop after partial content, type a follow-up, or scroll.
export const PAUSE_CHUNK_GAP_DELAY_MS = 3_000;

// How much WORD TEXT a fragment may hold, in characters.
//
// Read that literally, because a fragment can be slightly longer than this.
// Fragments must re-join to exactly the original text, and words are never
// split, so a fragment that continues a sentence has to carry the single space
// that separates it from the previous fragment — and that space is not part of
// the budget. A 24-character word therefore yields a 25-character fragment.
// (Charging the space to the budget would honour a hard cap, but only by
// shrinking every fragment to make room for a separator most of them then
// don't need.) A word longer than the budget is its own fragment and simply
// overshoots: splitting it is not an option.
//
// None of this is load-bearing — it is streaming granularity, a cosmetic
// choice. The contract that matters is `chunks.join("") === content`.
const MAX_CHUNK_CHARS = 24;

/**
 * Split reply text into streamed fragments. Pure: same input → same output.
 * Fragments re-join (with `chunks.join("")`) to exactly the input, so the
 * running text a user sees while streaming always equals the final content.
 * Words are kept whole. See MAX_CHUNK_CHARS for what the budget does and does
 * not cover.
 */
export function chunkReply(content: string, maxChunkChars: number = MAX_CHUNK_CHARS): string[] {
  if (content === "") return [];
  // Split on single spaces but keep them: every word after the first carries a
  // leading space, so concatenating the fragments restores the original text.
  const words = content.split(" ");
  const chunks: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const piece = index === 0 ? words[index] : ` ${words[index]}`;
    if (current === "") {
      current = piece;
    } else if (current.length + piece.length <= maxChunkChars) {
      current += piece;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

// One scripted behaviour: the reply content plus its timing, or a failure.
type ScriptedBehavior = {
  content: string;
  sourceRefs?: readonly AiChatSourceRef[];
  firstDelayMs: number;
  gapDelayMs: number;
  /** When true, reject after the first delay instead of streaming. */
  fails?: boolean;
};

// Scripted replies, keyed by the exact text of the final user turn. Fixed
// known-good literals: browser and native regression tests key off these
// strings, so change them only together with that coverage. The page numbers
// are arbitrary but stable — they cite the bundled sample PDF.
const scriptedReplies: ReadonlyMap<string, ScriptedBehavior> = new Map<string, ScriptedBehavior>([
  [
    "Summarize this PDF",
    {
      content:
        "Mock summary: the document introduces its subject, develops one main argument, and closes with supporting evidence.",
      firstDelayMs: FIRST_CHUNK_DELAY_MS,
      gapDelayMs: CHUNK_GAP_DELAY_MS,
    },
  ],
  [
    "Explain the current page",
    {
      content: "Mock explanation: the current page elaborates the main argument with a worked example.",
      firstDelayMs: FIRST_CHUNK_DELAY_MS,
      gapDelayMs: CHUNK_GAP_DELAY_MS,
    },
  ],
  [
    // Always fails, on every attempt — the mock holds no attempt state, so a
    // retry deterministically fails again (which is exactly what the retry
    // coverage asserts).
    "Fail to respond",
    {
      content: "",
      firstDelayMs: FIRST_CHUNK_DELAY_MS,
      gapDelayMs: CHUNK_GAP_DELAY_MS,
      fails: true,
    },
  ],
  [
    // First chunk only after a very long delay — in practice a test Stops it
    // while it is still waiting, so it never actually streams.
    "Respond slowly",
    {
      content: "Mock slow reply: this text only begins after a long pause.",
      firstDelayMs: SLOW_FIRST_CHUNK_DELAY_MS,
      gapDelayMs: CHUNK_GAP_DELAY_MS,
    },
  ],
  [
    // One quick chunk, then long pauses — long enough content for several
    // chunks so a test can act during a pause.
    "Pause after the first chunk",
    {
      content:
        "Mock paused reply: the first fragment arrives quickly, then the remaining fragments trickle in one at a time.",
      firstDelayMs: FIRST_CHUNK_DELAY_MS,
      gapDelayMs: PAUSE_CHUNK_GAP_DELAY_MS,
    },
  ],
]);

// The default delay: a setTimeout that also settles early (as a rejection) if
// the caller aborts while it is waiting.
function timerDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Product-facing failure text for a scripted failure. The Error message stays
// generic on purpose: the AI Chat Session turns rejections into its own
// user-facing string, so this is only ever seen in test assertions.
const FAILURE_MESSAGE = "The mock service could not generate a reply.";

type MockAiChatServiceOptions = {
  /** Override the wait between fragments. Defaults to an abortable setTimeout. */
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/**
 * Deterministic mock AI Chat Service. Reply content is a pure function of the
 * request — no network, no randomness. Only timing comes from the outside, via
 * the injected `delay`; with the default delay it uses real (abortable)
 * timers. The class holds no mutable state, so one shared instance is safe.
 */
export class MockAiChatService implements AiChatService {
  private readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(options: MockAiChatServiceOptions = {}) {
    this.delay = options.delay ?? timerDelay;
  }

  async generate(request: AiChatRequest, onChunk: AiChatChunkSink, signal: AbortSignal): Promise<AiChatReply> {
    const behavior = this.resolveBehavior(request);

    // Wait before anything appears. If the caller aborts during this wait, the
    // delay rejects and generation ends before a single fragment is emitted.
    await this.delay(behavior.firstDelayMs, signal);
    // A cancelled generation reports the cancellation, not a scripted failure.
    if (signal.aborted) throw signal.reason;

    if (behavior.fails) throw new Error(FAILURE_MESSAGE);

    const chunks = chunkReply(behavior.content);
    for (let index = 0; index < chunks.length; index += 1) {
      // Every fragment after the first waits its turn. Because a delay always
      // precedes it, an abort between fragments rejects here — no fragment is
      // emitted after cancellation.
      if (index > 0) await this.delay(behavior.gapDelayMs, signal);
      // Re-check before handing over a fragment. The delay above normally
      // rejects on abort, but an injected delay is not obliged to honour the
      // signal, and the caller may have aborted from inside the previous
      // onChunk. Either way, a cancelled generation must not keep emitting.
      if (signal.aborted) throw signal.reason;
      onChunk(chunks[index]);
    }

    // The caller may have aborted from inside the final onChunk, in which case
    // there is no next loop turn to notice it — resolving here would report
    // success for a generation that was cancelled.
    if (signal.aborted) throw signal.reason;

    // Hand out copies, never the scripted objects themselves. The scripted map
    // is module-level: if a consumer mutated a citation it received, it would
    // silently rewrite the script for every future reply, in every instance —
    // destroying the determinism this whole mock exists to provide.
    return behavior.sourceRefs
      ? { content: behavior.content, sourceRefs: behavior.sourceRefs.map((sourceRef) => ({ ...sourceRef })) }
      : { content: behavior.content };
  }

  private resolveBehavior(request: AiChatRequest): ScriptedBehavior {
    const lastMessage = request.messages[request.messages.length - 1];
    const prompt = lastMessage?.content ?? "";
    if (prompt === "Summarize this PDF") {
      const scripted = scriptedReplies.get(prompt)!;
      const firstSource = request.context?.sources[0];
      return firstSource ? { ...scripted, sourceRefs: [{ id: firstSource.id }] } : scripted;
    }
    if (prompt === "Explain the current page") {
      const scripted = scriptedReplies.get(prompt)!;
      const source = request.context?.sources.find(
        (candidate) => candidate.page === request.context?.currentPage,
      );
      return source ? { ...scripted, sourceRefs: [{ id: source.id }] } : scripted;
    }
    if (prompt === "Explain the selection") {
      const selection = request.context?.selection;
      return {
        content: selection
          ? `Mock selection reply: the selection on page ${selection.page} is noted.`
          : "Mock selection reply: no selection context.",
        sourceRefs: selection ? [{ id: selection.id }] : undefined,
        firstDelayMs: FIRST_CHUNK_DELAY_MS,
        gapDelayMs: CHUNK_GAP_DELAY_MS,
      };
    }
    if (prompt === "Describe the context") {
      const context = request.context;
      const included = context?.sources.filter((source) => "text" in source).map((source) => source.page) ?? [];
      const unavailable =
        context?.sources.filter((source) => "unavailableReason" in source).map((source) => source.page) ?? [];
      const omitted = context?.omissions.omittedPageRanges.map(formatOmittedPageRange) ?? [];
      return {
        content: `Mock context report: pages=${context?.pageCount ?? 0} included=${included.join(",") || "none"} unavailable=${unavailable.join(",") || "none"} omitted=${omitted.join(",") || "none"} selection=${context?.selection?.page ?? "none"} current=${context?.currentPage ?? "none"}`,
        firstDelayMs: FIRST_CHUNK_DELAY_MS,
        gapDelayMs: CHUNK_GAP_DELAY_MS,
      };
    }
    if (prompt === "Cite a missing page") {
      return {
        content: "Mock missing citation reply.",
        sourceRefs: [{ id: "page-9999" }],
        firstDelayMs: FIRST_CHUNK_DELAY_MS,
        gapDelayMs: CHUNK_GAP_DELAY_MS,
      };
    }
    const scripted = scriptedReplies.get(prompt);
    if (scripted) return scripted;
    // Fallback for unscripted prompts. Folding in the user-turn count keeps
    // distinct turns distinguishable in assertions even when the prompt text
    // repeats (e.g. two tabs both sending "hello").
    const userTurnCount = request.messages.filter((message) => message.role === "user").length;
    return {
      content: `Mock reply #${userTurnCount}: you asked "${prompt}"`,
      firstDelayMs: FIRST_CHUNK_DELAY_MS,
      gapDelayMs: CHUNK_GAP_DELAY_MS,
    };
  }
}

/**
 * Shared instance for the shell. A singleton is safe precisely because the
 * mock is stateless; a real provider with per-conversation state would be
 * constructed per use instead.
 */
export const mockAiChatService = new MockAiChatService();
