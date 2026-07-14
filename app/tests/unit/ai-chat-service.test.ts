// Unit coverage for the AI Chat Service seam (issue #24 / A2).
//
// The AI Chat Service is the UI-facing interface that resolves assistant
// replies; in M1 its only implementation is the deterministic mock. These
// tests pin the mock's determinism contract: same request → same reply,
// always — no randomness, no timers, no network. They also pin the seam's
// data ownership rule: a reply carries only content and citations; UI message
// identity (id) and authorship (role) belong to the AI Chat Session, so the
// reply must never contain them.

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { MockAiChatService } from "../../src/lib/ai-chat/chat-service";
import type { AiChatMessage } from "../../src/lib/ai-chat/types";

function userTurn(id: string, content: string): AiChatMessage {
  return { id, role: "user", content };
}

describe("MockAiChatService", () => {
  it("returns the scripted reply for a scripted prompt", async () => {
    const service = new MockAiChatService();
    const reply = await service.complete({
      messages: [userTurn("user-turn-1", "Summarize this PDF")],
    });
    // The scripted reply is a fixed known-good literal with a fixed AI Chat
    // Page Citation — regression tests (browser and native) key off it.
    assert.ok(reply.content.length > 0);
    assert.ok(reply.citations && reply.citations.length > 0);
    assert.equal(typeof reply.citations[0].page, "number");
  });

  it("returns deeply equal replies for identical requests (determinism)", async () => {
    const service = new MockAiChatService();
    const request = {
      messages: [userTurn("user-turn-1", "Summarize this PDF")],
    };
    const first = await service.complete(request);
    const second = await service.complete(request);
    assert.deepEqual(first, second);

    // A separate instance must be just as deterministic: no per-instance state
    // may leak into replies.
    const other = new MockAiChatService();
    assert.deepEqual(await other.complete(request), first);
  });

  it("answers unscripted prompts with a deterministic fallback that names the prompt", async () => {
    const service = new MockAiChatService();
    const reply = await service.complete({
      messages: [userTurn("user-turn-1", "What is on page 9?")],
    });
    assert.ok(reply.content.includes('"What is on page 9?"'));
  });

  it("folds the user-turn count into the fallback so distinct turns are distinguishable", async () => {
    const service = new MockAiChatService();
    const turnOne = await service.complete({
      messages: [userTurn("user-turn-1", "hello")],
    });
    const turnTwo = await service.complete({
      messages: [
        userTurn("user-turn-1", "hello"),
        { id: "assistant-turn-1", role: "assistant", content: turnOne.content },
        userTurn("user-turn-2", "hello"),
      ],
    });
    // Same prompt text, different turn position → different reply text, so
    // browser tests can tell follow-up turns apart.
    assert.notEqual(turnOne.content, turnTwo.content);
  });

  it("replies carry only content and citations — no UI message identity", async () => {
    const service = new MockAiChatService();
    const reply = await service.complete({
      messages: [userTurn("user-turn-1", "Summarize this PDF")],
    });
    // The AI Chat Session assigns id and role; a reply that carried them would
    // put UI-model construction back inside the provider (review amendment 1).
    assert.ok(!("id" in reply));
    assert.ok(!("role" in reply));
  });
});
