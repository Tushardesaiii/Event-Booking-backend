import type { AiChatProvider } from './types.js';
import { GeminiChatProvider } from './gemini.provider.js';

// Single swap point for the active AI vendor. Today it's always Gemini; a
// future model/vendor change is a one-line edit here.
let provider: AiChatProvider | null = null;

export function getAiProvider(): AiChatProvider {
  if (!provider) {
    provider = new GeminiChatProvider();
  }
  return provider;
}

export type { AiChatProvider, AiChatMessage, AiChatRole, AiGenerateReplyInput } from './types.js';
