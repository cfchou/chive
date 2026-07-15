// Unit coverage for the AI Chat Service seam (issue #25 / A3).
//
// A3 reshapes the service from A2's one-shot complete() into a streaming
// generate(request, onChunk, signal): the reply arrives as a run of text
// chunks and settles with the full reply, or rejects when cancelled or when
// the scripted prompt is meant to fail. These tests pin two things:
//
//   - Determinism of CONTENT. Same request always yields the same chunk
//     sequence and the same final reply, across instances. Only *timing* is
//     allowed to vary, and even that goes through an injected delay so tests
//     never touch a real clock (the mock's default delay is a real setTimeout,
//     replaced here by a hand-pumped fake).
//   - The data-ownership rule carried over from A2: a reply carries only
//     content and citations, never UI message id or role.
//
// The fake delay below is the whole trick for testing time without waiting:
// every delay the service asks for is parked in a queue, and the test releases
// them one at a time with resolveNext(), stepping the stream forward chunk by
// chunk.

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  MockAiChatService,
  chunkReply,
  FIRST_CHUNK_DELAY_MS,
  CHUNK_GAP_DELAY_MS,
} from "../../src/lib/ai-chat/chat-service";
import type { AiChatMessage } from "../../src/lib/ai-chat/types";

function userTurn(id: string, content: string): AiChatMessage {
  return { id, role: "user", content };
}

// A stand-in for the service's real setTimeout-based delay. Each delay the
// service awaits is held open until the test explicitly releases the oldest
// one, so the test drives the stream at its own pace and never sleeps. It also
// honours the abort signal, so cancellation mid-delay behaves like production.
class ManualDelays {
  private queue: Array<{ resolve: () => void; detach: () => void }> = [];

  readonly delay = (_ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const entry = {
        resolve: () => {
          detach();
          resolve();
        },
        detach: () => {
          signal.removeEventListener("abort", onAbort);
          this.queue = this.queue.filter((candidate) => candidate !== entry);
        },
      };
      function onAbort() {
        entry.detach();
        reject(signal.reason);
      }
      function detach() {
        entry.detach();
      }
      signal.addEventListener("abort", onAbort);
      this.queue.push(entry);
    });

  get pending(): number {
    return this.queue.length;
  }

  // Release the oldest waiting delay, then hand the event loop one turn so the
  // service resumes and either emits its next chunk or parks its next delay.
  async releaseNext(): Promise<void> {
    const entry = this.queue[0];
    if (!entry) throw new Error("No pending delay to release");
    entry.resolve();
    await Promise.resolve();
  }
}

// Collects the streamed chunks and settles when generate() finishes, so a test
// can await the whole run after pumping every delay.
function runGenerate(service: MockAiChatService, messages: AiChatMessage[]) {
  const controller = new AbortController();
  const chunks: string[] = [];
  const settled = service.generate(
    { messages },
    (text) => chunks.push(text),
    controller.signal,
  );
  return { controller, chunks, settled };
}

describe("chunkReply", () => {
  it("splits content into whole-word chunks that re-join to the original", () => {
    const content = "the document develops one main argument to a close";
    const chunks = chunkReply(content);
    assert.equal(chunks.join(""), content);
    for (const chunk of chunks) {
      // The budget covers the WORDS in a fragment; a fragment that continues a
      // sentence also carries the space separating it from the previous one,
      // which is not part of the budget. Strip exactly that one space — do not
      // trim() — because trimming would also hide a fragment that genuinely
      // overshot its budget.
      const words = chunk.startsWith(" ") ? chunk.slice(1) : chunk;
      assert.ok(
        words.length <= 24 || !words.includes(" "),
        `fragment is over budget: ${JSON.stringify(chunk)}`,
      );
    }
  });

  it("keeps a budget-length word whole, so its fragment runs one over", () => {
    const word = "123456789012345678901234"; // exactly the 24-char budget
    const chunks = chunkReply(`x ${word}`);
    // Pinned deliberately: the word cannot be split and its separator has to
    // live somewhere, so this fragment is 25 characters. Documented in
    // MAX_CHUNK_CHARS; asserted here so nobody "fixes" it by accident.
    assert.deepEqual(chunks, ["x", ` ${word}`]);
    assert.equal(chunks[1].length, 25);
    assert.equal(chunks.join(""), `x ${word}`);
  });

  it("gives an over-long word its own chunk", () => {
    const long = "supercalifragilisticexpialidocious"; // 34 chars, over the 24 budget
    const chunks = chunkReply(`start ${long} end`);
    assert.equal(chunks.join(""), `start ${long} end`);
    assert.ok(chunks.some((chunk) => chunk.includes(long)));
  });

  it("is a pure function — same content, same chunks", () => {
    const content = "same input yields the same chunk boundaries every time";
    assert.deepEqual(chunkReply(content), chunkReply(content));
  });

  it("returns no chunks for empty content", () => {
    assert.deepEqual(chunkReply(""), []);
  });
});

describe("MockAiChatService.generate", () => {
  let delays: ManualDelays;
  let service: MockAiChatService;

  beforeEach(() => {
    delays = new ManualDelays();
    service = new MockAiChatService({ delay: delays.delay });
  });

  afterEach(() => {
    // Nothing to clean up: the fake delay holds no real timers.
  });

  it("waits for the first delay, then streams every chunk, then resolves with the full reply", async () => {
    const { chunks, settled } = runGenerate(service, [userTurn("user-turn-1", "Summarize this PDF")]);

    // Nothing is emitted before the first delay is released.
    await Promise.resolve();
    assert.equal(chunks.length, 0);
    assert.equal(delays.pending, 1);

    // Release the first delay: the first chunk appears and the next gap parks.
    await delays.releaseNext();
    assert.equal(chunks.length, 1);

    // Drain the rest of the stream.
    while (delays.pending > 0) {
      await delays.releaseNext();
    }
    const reply = await settled;

    // Chunks reconstruct exactly the reply content.
    assert.equal(chunks.join(""), reply.content);
    assert.ok(reply.content.length > 0);
    assert.ok(reply.citations && reply.citations.length > 0);
    assert.equal(reply.citations[0].page, 1);
  });

  it("streams identical chunk sequences and replies for identical requests, across instances", async () => {
    const request = [userTurn("user-turn-1", "Summarize this PDF")];

    const first = runGenerate(service, request);
    while (delays.pending > 0) await delays.releaseNext();
    const firstReply = await first.settled;

    // A fresh instance with a fresh fake clock must produce the same stream.
    const otherDelays = new ManualDelays();
    const otherService = new MockAiChatService({ delay: otherDelays.delay });
    const other = runGenerate(otherService, request);
    while (otherDelays.pending > 0) await otherDelays.releaseNext();
    const otherReply = await other.settled;

    assert.deepEqual(first.chunks, other.chunks);
    assert.deepEqual(firstReply, otherReply);
  });

  it("answers unscripted prompts with a deterministic fallback that names the prompt", async () => {
    const { chunks, settled } = runGenerate(service, [userTurn("user-turn-1", "What is on page 9?")]);
    while (delays.pending > 0) await delays.releaseNext();
    const reply = await settled;
    assert.equal(chunks.join(""), reply.content);
    assert.ok(reply.content.includes('"What is on page 9?"'));
  });

  it("folds the user-turn count into the fallback so distinct turns are distinguishable", async () => {
    const one = runGenerate(service, [userTurn("user-turn-1", "hello")]);
    while (delays.pending > 0) await delays.releaseNext();
    const replyOne = await one.settled;

    const two = runGenerate(service, [
      userTurn("user-turn-1", "hello"),
      { id: "assistant-turn-1", role: "assistant", content: replyOne.content },
      userTurn("user-turn-2", "hello"),
    ]);
    while (delays.pending > 0) await delays.releaseNext();
    const replyTwo = await two.settled;

    assert.notEqual(replyOne.content, replyTwo.content);
  });

  it("survives a caller mutating a citation it was handed", async () => {
    const request = [userTurn("user-turn-1", "Summarize this PDF")];

    const first = runGenerate(service, request);
    while (delays.pending > 0) await delays.releaseNext();
    const firstReply = await first.settled;
    assert.equal(firstReply.citations?.[0].page, 1);

    // A careless consumer scribbles on the citation it received. The scripted
    // replies live in a module-level map, so handing out the real objects would
    // let this rewrite the script for every later reply — in every instance,
    // for the rest of the process. Determinism is the entire point of the mock.
    firstReply.citations![0].page = 999;

    const second = runGenerate(service, request);
    while (delays.pending > 0) await delays.releaseNext();
    assert.equal((await second.settled).citations?.[0].page, 1);

    const otherDelays = new ManualDelays();
    const otherService = new MockAiChatService({ delay: otherDelays.delay });
    const other = runGenerate(otherService, request);
    while (otherDelays.pending > 0) await otherDelays.releaseNext();
    assert.equal((await other.settled).citations?.[0].page, 1);
  });

  it("reports cancellation when the caller aborts from inside the FINAL fragment", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    // Aborting on the last fragment is the case with no safety net: every
    // earlier fragment is followed by a delay that would notice the abort and
    // reject, but after the last one the loop simply ends — so without an
    // explicit check the run would report success for a cancelled generation.
    // "evidence." is the known-good tail of the scripted summary.
    const settled = service.generate(
      { messages: [userTurn("user-turn-1", "Summarize this PDF")] },
      (text) => {
        chunks.push(text);
        if (text.includes("evidence.")) controller.abort();
      },
      controller.signal,
    );

    while (delays.pending > 0) await delays.releaseNext();

    await assert.rejects(settled, (error: Error) => error.name === "AbortError");
    // Everything up to and including the final fragment was delivered; the
    // cancellation only changes how the run *settles*.
    assert.ok(chunks.join("").endsWith("evidence."));
  });

  it("replies carry only content and citations — no UI message identity", async () => {
    const { settled } = runGenerate(service, [userTurn("user-turn-1", "Summarize this PDF")]);
    while (delays.pending > 0) await delays.releaseNext();
    const reply = await settled;
    assert.ok(!("id" in reply));
    assert.ok(!("role" in reply));
  });

  it("rejects with the abort reason when cancelled during the first delay, emitting nothing", async () => {
    const { controller, chunks, settled } = runGenerate(service, [userTurn("user-turn-1", "Summarize this PDF")]);
    await Promise.resolve();
    assert.equal(delays.pending, 1);

    controller.abort();
    await assert.rejects(settled, (error: Error) => error.name === "AbortError");
    assert.equal(chunks.length, 0);
  });

  it("stops emitting once aborted between chunks", async () => {
    const { controller, chunks, settled } = runGenerate(service, [userTurn("user-turn-1", "Summarize this PDF")]);
    await delays.releaseNext(); // first chunk out
    assert.equal(chunks.length, 1);

    controller.abort(); // aborts while the next gap delay is parked
    await assert.rejects(settled, (error: Error) => error.name === "AbortError");
    const countAtAbort = chunks.length;
    // No further chunks after rejection.
    await Promise.resolve();
    assert.equal(chunks.length, countAtAbort);
  });

  it("fails the scripted failure prompt after one delay, with zero chunks", async () => {
    const { chunks, settled } = runGenerate(service, [userTurn("user-turn-1", "Fail to respond")]);
    await Promise.resolve();
    assert.equal(delays.pending, 1);

    await delays.releaseNext();
    await assert.rejects(settled, (error: Error) => error.name !== "AbortError" && /generat/i.test(error.message));
    assert.equal(chunks.length, 0);
  });

  it("holds the slow prompt's first chunk until its long delay is released", async () => {
    const { chunks } = runGenerate(service, [userTurn("user-turn-1", "Respond slowly")]);
    await Promise.resolve();
    // One delay parked, nothing streamed — the generating state can sit here.
    assert.equal(delays.pending, 1);
    assert.equal(chunks.length, 0);
  });

  it("emits exactly one chunk for the pause prompt before its long inter-chunk pause", async () => {
    const { chunks } = runGenerate(service, [userTurn("user-turn-1", "Pause after the first chunk")]);
    await delays.releaseNext(); // first delay → first chunk
    assert.equal(chunks.length, 1);
    // The next chunk is parked behind the long pause; nothing more streams yet.
    await Promise.resolve();
    assert.equal(chunks.length, 1);
    assert.equal(delays.pending, 1);
  });

  it("uses the documented default delays for scripted replies", () => {
    // Guards the exported constants tests and the shell rely on.
    assert.equal(FIRST_CHUNK_DELAY_MS, 400);
    assert.equal(CHUNK_GAP_DELAY_MS, 40);
  });
});
