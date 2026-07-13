import { z } from 'zod';

const aiChatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2000)
});

export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(2000, 'Message is too long'),
  // Capped generously here; the service further trims to AI_CHAT_HISTORY_LIMIT
  // before it ever reaches the model.
  history: z.array(aiChatHistoryMessageSchema).max(40).optional().default([])
});
