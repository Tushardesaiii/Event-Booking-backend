// src/modules/artist/validators/followValidator.ts
import { z } from 'zod';

export const FollowRequestSchema = z.object({
  tenantId: z.string().uuid(),
  artistSlug: z.string().min(1).max(255)
});
