import { z } from 'zod';

export const StoryViewSchema = z.object({
  tenantId: z.string().uuid(),
  storyId: z.string().uuid(),
  viewerUserId: z.string().uuid()
});

export const StoryReactionSchema = z.object({
  tenantId: z.string().uuid(),
  storyId: z.string().uuid(),
  userId: z.string().uuid(),
  reactionType: z.string().min(1).max(50)
});
