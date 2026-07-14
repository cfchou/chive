// Static AI Chat fixtures — A1's representative states, kept ONLY as the
// test-only "backstage door" behind the `?aiChatFixture=` URL param. Real
// (session-driven) mode never renders these. A2's deterministic mock cannot
// produce the generating/error states (A3 scope), so the existing browser
// coverage for those looks keeps using this door until A3 makes them real and
// removes this module (tracked on issue #25).
//
// Mode discrimination is by URL-param PRESENCE and lives in the shell —
// which is why selectAiChatFixture takes a plain string: by the time it is
// called, the caller has already decided this is fixture mode.

import type { AiChatFixture, AiChatState } from "./types";

const completedMessages: AiChatFixture["messages"] = [
  {
    id: "user-main-argument",
    role: "user",
    content: "What is the main argument?",
  },
  {
    id: "assistant-main-argument",
    role: "assistant",
    content:
      "The document argues that durable systems come from clear boundaries, explicit tradeoffs, and feedback from real use.",
    citations: [{ id: "main-argument-page-3", page: 3 }],
  },
];

export const aiChatFixtures: Record<AiChatState, AiChatFixture> = {
  empty: {
    state: "empty",
    messages: [],
    contexts: [],
  },
  generating: {
    state: "generating",
    messages: [
      { id: "user-summary", role: "user", content: "Summarize this PDF" },
      { id: "assistant-summary", role: "assistant", content: "Reading the document…" },
    ],
    contexts: [{ id: "current-page", label: "Current page" }],
  },
  completed: {
    state: "completed",
    messages: completedMessages,
    contexts: [{ id: "current-page", label: "Current page" }],
  },
  error: {
    state: "error",
    messages: [{ id: "user-explain", role: "user", content: "Explain the current page" }],
    contexts: [{ id: "current-page", label: "Current page" }],
    errorMessage: "The example response could not be generated.",
  },
};

/** Present-but-unknown (or empty) param values fall back to `completed`, so
 * historical test URLs keep their meaning. */
export function selectAiChatFixture(name: string): AiChatFixture {
  return name === "empty" || name === "generating" || name === "error"
    ? aiChatFixtures[name]
    : aiChatFixtures.completed;
}
