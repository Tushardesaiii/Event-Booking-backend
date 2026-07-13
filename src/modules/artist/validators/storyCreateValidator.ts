// src/modules/artist/validators/storyCreateValidator.ts
import { z } from 'zod';

export const StoryCreateSchema = z.object({
  tenantId: z.string().uuid(),
  artistSlug: z.string().min(1).max(255),
  mediaUrl: z.string().url(),
  caption: z.string().max(500).optional(),
  type: z.enum(['image', 'video']),
  // expiresAt is calculated (now + 24h) so not required from client
});
