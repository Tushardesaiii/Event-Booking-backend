// src/modules/artist/validators/recommendationValidator.ts
import { z } from 'zod';

export const RecommendationQuerySchema = z.object({
  tenantId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});
