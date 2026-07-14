// Unit coverage for the AI Chat Session model (issue #24 / A2).
//
// The AI Chat Session owns one document's conversation state. These tests pin
// its lifecycle contract (PR #27 rev 3):
//   - send() appends the user turn and the assistant reply to THIS session,
//     never to whichever tab happens to be visible when the reply resolves;
//   - acceptance is synchronously observable: send() returns the completion
//     promise when accepted, null when not (disposed, or a send is pending);
//   - disposed sessions discard late replies;
//   - the request handed to the service is an independent array snapshot.
//
// The deferred fake service below makes the asynchronous invariants testable:
// it hands out replies only when the test explicitly resolves them, so the
// test can interleave dispose()/send() calls inside the pending window —
// something the immediate mock service can never exercise.

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { AiChatSession } from "../../src/lib/ai-chat/chat-session";
import { MockAiChatService } from "../../src/lib/ai-chat/chat-service";
import type { AiChatReply, AiChatRequest, AiChatService } from "../../src/lib/ai-chat/chat-service";

/** Fake service whose replies resolve only when the test says so. */
class DeferredAiChatService implements AiChatService {
  readonly requests: AiChatRequest[] = [];
  private readonly resolvers: Array<(reply: AiChatReply) => void> = [];

  complete(request: AiChatRequest): Promise<AiChatReply> {
    this.requests.push(request);
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /** Resolve the oldest outstanding request with the given reply text. */
  resolveNext(content: string): void {
    const resolve = this.resolvers.shift();
    if (!resolve) throw new Error("No pending AI Chat request to resolve");
    resolve({ content });
  }
}

describe("AiChatSession", () => {
  it("send() appends the user turn, then the assistant reply, in order", async () => {
    const session = new AiChatSession();
    const completion = session.send(new MockAiChatService(), "Summarize this PDF");
    assert.notEqual(completion, null);

    // The user turn is visible synchronously — the composer's message must
    // appear before any reply arrives.
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].role, "user");
    assert.equal(session.messages[0].content, "Summarize this PDF");

    await completion;
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].role, "assistant");
    assert.ok(session.messages[1].content.length > 0);
  });

  it("assigns deterministic, session-owned ids and roles across turns", async () => {
    const a = new AiChatSession();
    const b = new AiChatSession();
    const service = new MockAiChatService();
    await a.send(service, "first");
    await a.send(service, "second");
    await b.send(service, "first");

    // Ids come from the session's own turn counter, so two sessions with the
    // same history produce the same ids — deterministic, not globally unique.
    assert.deepEqual(
      a.messages.map((message) => message.id),
      [b.messages[0].id, b.messages[1].id, a.messages[2].id, a.messages[3].id],
    );
    // Within one session every id is distinct (they key Svelte's {#each}).
    assert.equal(new Set(a.messages.map((message) => message.id)).size, a.messages.length);
  });

  it("two sessions share no state", async () => {
    const a = new AiChatSession();
    const b = new AiChatSession();
    await a.send(new MockAiChatService(), "only in a");
    a.draft = "draft a";
    a.savedScrollTop = 120;

    assert.equal(b.messages.length, 0);
    assert.equal(b.draft, "");
    assert.equal(b.savedScrollTop, 0);
    assert.equal(a.messages.length, 2);
  });

  it("a late reply lands in the originating session, not elsewhere", async () => {
    const deferred = new DeferredAiChatService();
    const origin = new AiChatSession();
    const other = new AiChatSession();

    const completion = origin.send(deferred, "slow question");
    assert.notEqual(completion, null);

    // Meanwhile the user "switches tabs" and converses elsewhere — activity is
    // a shell concept; the model must be safe regardless of it.
    await other.send(new MockAiChatService(), "fast question");

    deferred.resolveNext("late answer");
    await completion;

    assert.equal(origin.messages.length, 2);
    assert.equal(origin.messages[1].content, "late answer");
    // The other session saw exactly its own two turns and nothing more.
    assert.equal(other.messages.length, 2);
    assert.notEqual(other.messages[1].content, "late answer");
  });

  it("dispose() before resolution discards the late reply", async () => {
    const deferred = new DeferredAiChatService();
    const session = new AiChatSession();
    const completion = session.send(deferred, "doomed question");
    assert.notEqual(completion, null);

    session.dispose();
    deferred.resolveNext("too late");
    await completion;

    // The Document Tab is closed; nothing may repopulate the session.
    assert.equal(session.messages.length, 0);
  });

  it("send() after dispose() returns null and appends nothing", () => {
    const session = new AiChatSession();
    session.dispose();
    assert.equal(session.send(new MockAiChatService(), "hello?"), null);
    assert.equal(session.messages.length, 0);
  });

  it("a second send() while one is pending returns null; the first completes normally", async () => {
    const deferred = new DeferredAiChatService();
    const session = new AiChatSession();
    const first = session.send(deferred, "first");
    assert.notEqual(first, null);

    // The ignored send must change nothing: no user turn, no extra request.
    assert.equal(session.send(deferred, "second"), null);
    assert.equal(session.messages.length, 1);
    assert.equal(deferred.requests.length, 1);

    deferred.resolveNext("answer to first");
    await first;
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].content, "answer to first");

    // Once the pending send completed, the session accepts sends again.
    const next = session.send(deferred, "third");
    assert.notEqual(next, null);
    deferred.resolveNext("answer to third");
    await next;
    assert.equal(session.messages.length, 4);
  });

  it("hands the service an independent array snapshot", async () => {
    const deferred = new DeferredAiChatService();
    const session = new AiChatSession();
    const completion = session.send(deferred, "snapshot me");

    const seen = deferred.requests[0].messages;
    assert.equal(seen.length, 1);

    deferred.resolveNext("reply");
    await completion;

    // The session has grown since the request was built; the snapshot the
    // service received must not have.
    assert.equal(session.messages.length, 2);
    assert.equal(seen.length, 1);
  });

  it("dispose() clears messages, draft, and scroll", async () => {
    const session = new AiChatSession();
    await session.send(new MockAiChatService(), "hello");
    session.draft = "unsent";
    session.savedScrollTop = 300;

    session.dispose();
    assert.equal(session.messages.length, 0);
    assert.equal(session.draft, "");
    assert.equal(session.savedScrollTop, 0);
  });
});
