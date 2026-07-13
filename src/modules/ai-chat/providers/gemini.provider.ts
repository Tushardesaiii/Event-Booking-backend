import { env } from '../../../config/env.js';
import { aiProviderError, aiProviderUnavailable, rateLimited } from '../../../lib/errors.js';
import type { AiChatProvider, AiGenerateReplyInput } from './types.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 15000;

export class GeminiChatProvider implements AiChatProvider {
  async generateReply(input: AiGenerateReplyInput): Promise<string> {
    if (!env.GEMINI_API_KEY) {
      throw aiProviderUnavailable('The AI assistant is not configured yet.');
    }

    const contents = [
      ...input.history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      { role: 'user', parts: [{ text: input.message }] }
    ];

    const url = `${GEMINI_API_BASE}/${env.GEMINI_MODEL}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Sent as a header, not a `?key=` query param — query strings are
          // routinely captured in proxy/access logs, so this keeps the key out
          // of anywhere a URL might get logged. Works for both legacy
          // "standard" keys and the newer service-account-bound "auth" keys.
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents,
          systemInstruction: { role: 'system', parts: [{ text: input.systemPrompt }] },
          generationConfig: {
            maxOutputTokens: input.maxOutputTokens,
            temperature: 0.6
          }
        }),
        signal: controller.signal
      });
    } catch {
      if (controller.signal.aborted) {
        throw aiProviderUnavailable('The AI assistant took too long to respond. Please try again.');
      }
      throw aiProviderUnavailable('Unable to reach the AI assistant right now.');
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429) {
      throw rateLimited('The AI assistant is receiving too many requests. Please try again shortly.');
    }

    if (!res.ok) {
      throw aiProviderError('The AI assistant is temporarily unavailable. Please try again.');
    }

    const json: any = await res.json().catch(() => null);

    if (json?.promptFeedback?.blockReason) {
      throw aiProviderError("I can't help with that request.");
    }

    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? '').join('') : '';

    return text;
  }
}
