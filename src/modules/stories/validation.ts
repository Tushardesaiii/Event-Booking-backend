import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const storyIdParamsSchema = z.object({
  id: uuidSchema
});

export const createStorySchema = z.object({
  ownerType: z.enum(['user', 'organizer', 'event']),
  ownerId: uuidSchema,
  mediaUrl: z.string().trim().url(),
  mediaType: z.enum(['image', 'video']).optional().default('image'),
  caption: z.string().trim().max(1000).optional()
});

export const storyReplySchema = z.object({
  message: z.string().trim().min(1).max(2000)
});

export const storyReactionSchema = z.object({
  reactionType: z.string().trim().min(1).max(32)
});

export const storyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  ownerType: z.enum(['user', 'organizer', 'event']).optional(),
  ownerId: uuidSchema.optional()
});

export type StoryIdParamsInput = z.infer<typeof storyIdParamsSchema>;
export type CreateStoryInput = z.infer<typeof createStorySchema>;
export type StoryReplyInput = z.infer<typeof storyReplySchema>;
export type StoryReactionInput = z.infer<typeof storyReactionSchema>;
export type StoryListQueryInput = z.infer<typeof storyListQuerySchema>;
