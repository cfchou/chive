// Unit coverage for the AI Chat Session model (issue #25 / A3).
//
// A3 turns the session into a small generation state machine on top of A2's
// ownership rules. These tests pin, at the model seam:
//   - the A2 contract still holds: the user turn appears synchronously, the
//     reply lands in THIS session even if it arrives after a tab switch,
//     disposed sessions discard late work, and the request is an independent
//     snapshot;
//   - the A3 machine: idle → generating → (idle | error), streamed text
//     accumulates in inFlightContent, the assistant turn is committed once on
//     completion, Stop preserves partial content, errors are state (not
//     thrown), retry re-runs the last turn, and onChange fires on every
//     observable change.
//
// Two fake services drive this. `instant()` is the real mock with its waits
// removed, for tests that just need a finished reply fast. `StreamingFake`
// hands the test manual control — emit a chunk, finish, or fail on demand, and
// observe the abort signal — so the interesting mid-stream moments (stop,
// dispose, late reply) are reachable without real timers.

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { AiChatSession } from "../../src/lib/ai-chat/chat-session";
import { MockAiChatService } from "../../src/lib/ai-chat/chat-service";
import type { AiChatChunkSink, AiChatReply, AiChatRequest, AiChatService } from "../../src/lib/ai-chat/chat-service";
import { buildContextSnapshot, type AiChatRequestContext } from "../../src/lib/ai-chat/pdf-context";

/** The real mock with its delays collapsed to nothing — a fast finished reply. */
function instant(): MockAiChatService {
  return new MockAiChatService({ delay: () => Promise.resolve() });
}

function sampleContext(): AiChatRequestContext {
  return {
    normalizationVersion: 1,
    documentLabel: "sample.pdf",
    pageCount: 1,
    sources: [{ id: "page-1", page: 1, text: "sample" }],
    selection: null,
    currentPage: 1,
    omissions: { omittedPageRanges: [], partialSources: [], selectionTruncated: null },
  };
}

/** A generation the test steps by hand: emit chunks, then finish or fail. */
class StreamingFake implements AiChatService {
  readonly requests: AiChatRequest[] = [];
  readonly signals: AbortSignal[] = [];
  private sink: AiChatChunkSink | null = null;
  private settle: { resolve: (reply: AiChatReply) => void; reject: (reason: unknown) => void } | null = null;

  generate(request: AiChatRequest, onChunk: AiChatChunkSink, signal: AbortSignal): Promise<AiChatReply> {
    this.requests.push(request);
    this.signals.push(signal);
    this.sink = onChunk;
    return new Promise<AiChatReply>((resolve, reject) => {
      this.settle = { resolve, reject };
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }

  emit(text: string): void {
    this.sink?.(text);
  }

  /**
   * Flush one last chunk synchronously while the caller is aborting us — the
   * worst-case shape a real provider can have, since abort listeners run
   * synchronously inside abort(). A stopped session must not accept it.
   */
  emitOnAbort(text: string): void {
    this.signals[this.signals.length - 1]?.addEventListener("abort", () => this.sink?.(text), { once: true });
  }

  finish(reply: AiChatReply): void {
    this.settle?.resolve(reply);
  }

  fail(message: string): void {
    this.settle?.reject(new Error(message));
  }
}

describe("AiChatSession — A2 ownership contract (still holds under streaming)", () => {
  it("send() shows the user turn synchronously, then commits the assistant reply", async () => {
    const session = new AiChatSession();
    const completion = session.send(instant(), "Summarize this PDF");
    assert.notEqual(completion, null);

    // The user's message is visible before any reply arrives.
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].role, "user");
    assert.equal(session.messages[0].content, "Summarize this PDF");
    assert.equal(session.status, "generating");

    await completion;
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].role, "assistant");
    assert.ok(session.messages[1].content.length > 0);
    assert.equal(session.status, "idle");
    assert.equal(session.inFlightContent, "");
  });

  it("assigns deterministic, session-owned ids and roles across turns", async () => {
    const a = new AiChatSession();
    const b = new AiChatSession();
    await a.send(instant(), "first");
    await a.send(instant(), "second");
    await b.send(instant(), "first");

    assert.deepEqual(
      a.messages.map((message) => message.id),
      [b.messages[0].id, b.messages[1].id, a.messages[2].id, a.messages[3].id],
    );
    assert.equal(new Set(a.messages.map((message) => message.id)).size, a.messages.length);
  });

  it("two sessions share no state", async () => {
    const a = new AiChatSession();
    const b = new AiChatSession();
    await a.send(instant(), "only in a");
    a.draft = "draft a";
    a.savedScrollTop = 120;

    assert.equal(b.messages.length, 0);
    assert.equal(b.draft, "");
    assert.equal(b.savedScrollTop, 0);
    assert.equal(a.messages.length, 2);
  });

  it("a late reply lands in the originating session, not elsewhere", async () => {
    const fake = new StreamingFake();
    const origin = new AiChatSession();
    const other = new AiChatSession();

    const completion = origin.send(fake, "slow question");
    assert.notEqual(completion, null);

    // Meanwhile the user "switches tabs" and converses elsewhere.
    await other.send(instant(), "fast question");

    fake.emit("late answer");
    fake.finish({ content: "late answer" });
    await completion;

    assert.equal(origin.messages.length, 2);
    assert.equal(origin.messages[1].content, "late answer");
    assert.equal(other.messages.length, 2);
    assert.notEqual(other.messages[1].content, "late answer");
  });

  it("dispose() before completion discards the late reply", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "doomed question");
    assert.notEqual(completion, null);

    session.dispose();
    fake.finish({ content: "too late" });
    await completion;

    assert.equal(session.messages.length, 0);
  });

  it("send() after dispose() returns null and appends nothing", () => {
    const session = new AiChatSession();
    session.dispose();
    assert.equal(session.send(instant(), "hello?"), null);
    assert.equal(session.messages.length, 0);
  });

  it("hands the service an independent array snapshot", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "snapshot me");

    const seen = fake.requests[0].messages;
    assert.equal(seen.length, 1);

    fake.finish({ content: "reply" });
    await completion;

    assert.equal(session.messages.length, 2);
    assert.equal(seen.length, 1);
  });

  it("dispose() clears messages, draft, scroll, and generation state", async () => {
    const session = new AiChatSession();
    await session.send(instant(), "hello");
    session.draft = "unsent";
    session.savedScrollTop = 300;

    session.dispose();
    assert.equal(session.messages.length, 0);
    assert.equal(session.draft, "");
    assert.equal(session.savedScrollTop, 0);
    assert.equal(session.status, "idle");
    assert.equal(session.inFlightContent, "");
  });
});

describe("AiChatSession — A3 generation state machine", () => {
  it("accepts synchronously, then waits for the Context Snapshot before calling the service", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    let finishContext!: (context: AiChatRequestContext) => void;
    const contextFactory = () =>
      new Promise<AiChatRequestContext>((resolve) => {
        finishContext = resolve;
      });

    const completion = session.send(fake, "with context", contextFactory);
    assert.notEqual(completion, null);
    assert.equal(session.messages[0].content, "with context");
    assert.equal(session.status, "generating");
    assert.equal(fake.requests.length, 0);

    const context = sampleContext();
    finishContext(context);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0].context, context);

    fake.finish({ content: "done" });
    await completion;
  });

  it("shows a context-specific error and Retry runs the same factory again", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    let attempts = 0;
    const contextFactory = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("extract failed");
      return sampleContext();
    };

    await session.send(fake, "retry context", contextFactory);
    assert.equal(session.status, "error");
    assert.equal(session.errorMessage, "The document context could not be prepared.");
    assert.equal(fake.requests.length, 0);

    const retry = session.retry(fake);
    assert.notEqual(retry, null);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(attempts, 2);
    assert.equal(fake.requests.length, 1);
    fake.finish({ content: "recovered" });
    await retry;
    assert.equal(session.status, "idle");
  });

  it("drops every provider source ref when no Context Snapshot was supplied", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "no context");
    fake.finish({ content: "done", sourceRefs: [{ id: "page-1" }] });
    await completion;

    assert.equal(session.messages[1].citations, undefined);
  });

  it("clears dismissed context chips on an accepted send and on dispose", async () => {
    const session = new AiChatSession();
    session.dismissedContextIds = ["current-page", "selected-text"];
    await session.send(instant(), "accepted");
    assert.deepEqual(session.dismissedContextIds, []);

    session.dismissedContextIds = ["current-page"];
    session.dispose();
    assert.deepEqual(session.dismissedContextIds, []);
  });

  it("Stop during a stalled page read leaves no late cache or session write", async () => {
    let finishRead!: (items: Array<{ str: string; hasEOL: boolean }>) => void;
    const stalledRead = new Promise<Array<{ str: string; hasEOL: boolean }>>((resolve) => {
      finishRead = resolve;
    });
    const cache = new Map();
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "stop extraction", (signal) =>
      buildContextSnapshot({
        reader: { pageCount: 1, readPage: () => stalledRead },
        cache,
        documentLabel: "stalled.pdf",
        currentPage: 1,
        selection: null,
        signal,
      }),
    );

    session.stop();
    finishRead([{ str: "too late", hasEOL: false }]);
    await completion;

    assert.equal(fake.requests.length, 0);
    assert.equal(cache.size, 0);
    assert.equal(session.status, "idle");
    assert.deepEqual(session.messages.map((message) => message.role), ["user"]);
  });

  it("resolves unique valid source refs through the Context Snapshot and drops the rest", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const context: AiChatRequestContext = {
      ...sampleContext(),
      pageCount: 200,
      selection: { id: "selection-page-200", page: 200, text: "far away" },
    };
    const completion = session.send(fake, "stream me", async () => context);
    await Promise.resolve();
    await Promise.resolve();

    fake.emit("Hello");
    assert.equal(session.status, "generating");
    assert.equal(session.inFlightContent, "Hello");
    // Still no committed assistant turn — only the user turn.
    assert.equal(session.messages.length, 1);

    fake.emit(", world");
    assert.equal(session.inFlightContent, "Hello, world");

    fake.finish({
      content: "Hello, world",
      sourceRefs: [
        { id: "page-1" },
        { id: "page-9999" },
        { id: "page-1" },
        { id: "selection-page-200" },
      ],
    });
    await completion;

    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].content, "Hello, world");
    assert.deepEqual(session.messages[1].citations, [
      { id: "page-1", page: 1 },
      { id: "selection-page-200", page: 200 },
    ]);
    assert.equal(session.status, "idle");
    assert.equal(session.inFlightContent, "");
  });

  it("keeps a committed citation safe from the provider that supplied it", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    // A provider that hands over source refs it still holds on to.
    const providerOwned = [{ id: "page-4" }];
    const context: AiChatRequestContext = {
      ...sampleContext(),
      pageCount: 4,
      sources: [{ id: "page-4", page: 4, text: "four" }],
    };
    const completion = session.send(fake, "cite something", async () => context);
    await Promise.resolve();
    await Promise.resolve();
    fake.finish({ content: "done", sourceRefs: providerOwned });
    await completion;

    // ...and later scribbles on them.
    providerOwned[0].id = "page-999";

    // A committed message is an append-only value object; nothing outside the
    // session may reach in and change one after the fact.
    assert.deepEqual(session.messages[1].citations, [{ id: "page-4", page: 4 }]);
  });

  it("fires onChange for the user turn, each chunk, and completion", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    let changes = 0;
    session.onChange = () => {
      changes += 1;
    };

    const completion = session.send(fake, "count me");
    const afterSend = changes;
    assert.ok(afterSend >= 1); // user turn + generating became observable

    fake.emit("a");
    assert.equal(changes, afterSend + 1);
    fake.emit("b");
    assert.equal(changes, afterSend + 2);

    fake.finish({ content: "ab" });
    await completion;
    assert.equal(changes, afterSend + 3);
  });

  it("stop() after a chunk commits the partial content with no citation, then goes idle", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "Pause after the first chunk");

    fake.emit("Partial so far");
    session.stop();

    assert.equal(session.status, "idle");
    assert.equal(session.inFlightContent, "");
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].role, "assistant");
    assert.equal(session.messages[1].content, "Partial so far");
    assert.equal(session.messages[1].citations, undefined);

    // The underlying generation was actually cancelled.
    assert.equal(fake.signals[0].aborted, true);
    await completion;
  });

  it("stop() before any chunk commits nothing and goes idle", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "Respond slowly");

    session.stop();
    assert.equal(session.status, "idle");
    assert.equal(session.messages.length, 1); // only the user turn
    await completion;
  });

  it("stop() when idle is a no-op", () => {
    const session = new AiChatSession();
    session.stop();
    assert.equal(session.status, "idle");
    assert.equal(session.messages.length, 0);
  });

  it("discards late chunks from a stopped generation, and accepts a fresh send", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const first = session.send(fake, "Pause after the first chunk");
    fake.emit("kept");
    session.stop();
    // A stray chunk from the cancelled generation must be ignored.
    fake.emit("should be dropped");
    assert.equal(session.messages[1].content, "kept");
    assert.equal(session.inFlightContent, "");
    await first;

    // A brand-new send works right after the stop.
    const second = session.send(instant(), "again");
    assert.notEqual(second, null);
    await second;
    assert.equal(session.messages.at(-1)?.role, "assistant");
  });

  it("ignores a chunk a service flushes synchronously while being stopped", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "Pause after the first chunk");
    fake.emit("kept");
    // The service will try to squeeze one more chunk out during abort().
    fake.emitOnAbort(" sneaked in");

    // Watch every state the session announces. The committed text alone cannot
    // tell us whether the late chunk was rejected (stop() snapshots the kept
    // text before aborting, so it reads "kept" either way) — but an accepted
    // chunk would still announce itself on the way past.
    const announced: string[] = [];
    session.onChange = () => announced.push(session.inFlightContent);

    session.stop();

    assert.ok(
      !announced.some((text) => text.includes("sneaked")),
      `a stopped generation announced a late chunk: ${JSON.stringify(announced)}`,
    );
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].content, "kept");
    assert.equal(session.inFlightContent, "");
    assert.equal(session.status, "idle");
    await completion;
    assert.equal(session.messages[1].content, "kept");
  });

  it("a failed generation becomes error state with nothing committed", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "Fail to respond");

    fake.fail("scripted failure");
    await completion;

    assert.equal(session.status, "error");
    assert.ok(session.errorMessage && session.errorMessage.length > 0);
    assert.equal(session.messages.length, 1); // user turn only; no assistant turn
    assert.equal(session.inFlightContent, "");
  });

  it("retry() re-runs the last turn without adding a user turn", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const first = session.send(fake, "Fail to respond");
    fake.fail("first failure");
    await first;
    assert.equal(session.status, "error");

    const retried = session.retry(fake);
    assert.notEqual(retried, null);
    assert.equal(session.status, "generating");
    assert.equal(session.errorMessage, null);
    // No new user turn; the request still ends with the original user turn.
    assert.equal(session.messages.length, 1);
    assert.equal(fake.requests.length, 2);
    assert.equal(fake.requests[1].messages.at(-1)?.content, "Fail to respond");

    fake.emit("recovered");
    fake.finish({ content: "recovered" });
    await retried;
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].id, session.messages[0].id.replace("user", "assistant"));
  });

  it("retry() when not in error returns null and does nothing", () => {
    const session = new AiChatSession();
    assert.equal(session.retry(instant()), null);
    assert.equal(session.messages.length, 0);
  });

  it("send() from the error state clears the error and starts a new turn", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const first = session.send(fake, "Fail to respond");
    fake.fail("boom");
    await first;
    assert.equal(session.status, "error");

    const next = session.send(instant(), "a different question");
    assert.notEqual(next, null);
    assert.equal(session.errorMessage, null);
    await next;
    // Two user turns now (the failed one and the new one), plus one reply.
    assert.equal(session.messages.filter((message) => message.role === "user").length, 2);
    assert.equal(session.status, "idle");
  });

  it("a second send() while generating returns null; the first still completes", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const first = session.send(fake, "first");
    assert.notEqual(first, null);

    assert.equal(session.send(fake, "second"), null);
    assert.equal(session.messages.length, 1);
    assert.equal(fake.requests.length, 1);

    fake.finish({ content: "answer to first" });
    await first;
    assert.equal(session.messages.length, 2);
    assert.equal(session.status, "idle");
  });

  it("dispose() mid-generation aborts the underlying work", async () => {
    const fake = new StreamingFake();
    const session = new AiChatSession();
    const completion = session.send(fake, "in flight");
    fake.emit("partial");

    session.dispose();
    assert.equal(fake.signals[0].aborted, true);
    // Late completion is ignored — the session stays cleared.
    fake.finish({ content: "ignored" });
    await completion;
    assert.equal(session.messages.length, 0);
    assert.equal(session.status, "idle");
  });
});
