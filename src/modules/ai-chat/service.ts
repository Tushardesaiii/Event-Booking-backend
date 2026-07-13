import { env } from '../../config/env.js';
import { aiProviderError } from '../../lib/errors.js';
import { getAiProvider } from './providers/index.js';
import { buildSystemPrompt } from './prompt.js';
import type { AiChatHistoryMessage, AiChatReply } from './types.js';

export async function generateChatReply(input: {
  message: string;
  history: AiChatHistoryMessage[];
  userName?: string | null;
}): Promise<AiChatReply> {
  // Only the most recent turns are sent to the model — keeps token usage (and
  // cost/latency) bounded regardless of how long the on-screen conversation is.
  const trimmedHistory = input.history.slice(-env.AI_CHAT_HISTORY_LIMIT);
  const provider = getAiProvider();

  const rawReply = await provider.generateReply({
    systemPrompt: buildSystemPrompt({ userName: input.userName ?? null }),
    history: trimmedHistory,
    message: input.message,
    maxOutputTokens: env.AI_CHAT_MAX_OUTPUT_TOKENS
  });

  const reply = rawReply?.trim();

  if (!reply) {
    throw aiProviderError('The assistant did not return a response. Please try again.');
  }

  return { reply, createdAt: new Date().toISOString() };
}
