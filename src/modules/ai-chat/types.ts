export type AiChatRole = 'user' | 'assistant';

export interface AiChatHistoryMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatRequestInput {
  message: string;
  history: AiChatHistoryMessage[];
}

export interface AiChatReply {
  reply: string;
  createdAt: string;
}
