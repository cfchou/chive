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

export function selectAiChatFixture(name: string | null | undefined): AiChatFixture {
  return name === "empty" || name === "generating" || name === "error"
    ? aiChatFixtures[name]
    : aiChatFixtures.completed;
}
