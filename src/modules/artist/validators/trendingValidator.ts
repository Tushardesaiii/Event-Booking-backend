// src/modules/artist/validators/trendingValidator.ts
import { z } from 'zod';

export const TrendingQuerySchema = z.object({
  tenantId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});
