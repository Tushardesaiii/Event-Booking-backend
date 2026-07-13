// Provider-agnostic contract for the AI assistant. Swapping models/vendors
// (Gemini → something else) means adding a new class here and pointing the
// factory in `index.ts` at it — nothing in routes/controller/service changes.

export type AiChatRole = 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiGenerateReplyInput {
  systemPrompt: string;
  history: AiChatMessage[];
  message: string;
  maxOutputTokens: number;
}

export interface AiChatProvider {
  generateReply(input: AiGenerateReplyInput): Promise<string>;
}
