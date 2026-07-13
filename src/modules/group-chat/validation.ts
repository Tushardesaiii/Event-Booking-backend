import { z } from 'zod';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

export const chatRoomIdParamsSchema = z.object({
  id: uuidSchema
});

export const chatMessageIdParamsSchema = z.object({
  id: uuidSchema
});

export const createChatRoomSchema = z.object({
  groupPlanId: uuidSchema,
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(5000).optional()
});

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  replyToMessageId: uuidSchema.optional(),
  attachments: z.array(
    z.object({
      fileUrl: z.string().trim().url(),
      fileType: z.string().trim().max(50).optional(),
      fileName: z.string().trim().max(255).optional(),
      fileSize: z.coerce.number().int().positive().optional()
    })
  ).optional()
});

export const editMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000)
});

export const reactMessageSchema = z.object({
  reaction: z.string().trim().min(1).max(32)
});

export const messageListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export type ChatRoomIdParamsInput = z.infer<typeof chatRoomIdParamsSchema>;
export type ChatMessageIdParamsInput = z.infer<typeof chatMessageIdParamsSchema>;
export type CreateChatRoomInput = z.infer<typeof createChatRoomSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type ReactMessageInput = z.infer<typeof reactMessageSchema>;
export type MessageListQueryInput = z.infer<typeof messageListQuerySchema>;
