// src/modules/artist/validators/alertValidator.ts
import { z } from 'zod';

export const AlertCreateSchema = z.object({
  tenantId: z.string().uuid(),
  artistSlug: z.string().min(1).max(255),
  radiusKm: z.coerce.number().int().positive().optional().default(50),
  enabled: z.coerce.boolean().optional().default(true)
});
