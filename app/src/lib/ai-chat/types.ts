export type AiChatState = "empty" | "generating" | "completed" | "error";

export type AiChatCitation = {
  id: string;
  page: number;
};

export type AiChatContext = {
  id: string;
  label: string;
};

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AiChatCitation[];
};
