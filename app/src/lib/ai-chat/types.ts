export type AiChatState = "empty" | "generating" | "completed" | "error";

export type AiChatCitation = {
  id: string;
  page: number;
};

/** A provider points at snapshot data by id; the session owns page lookup. */
export type AiChatSourceRef = {
  id: string;
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
