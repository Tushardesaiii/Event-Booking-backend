// src/modules/artist/validators/discoveryValidator.ts
import { z } from 'zod';

export const ArtistDiscoveryQuerySchema = z.object({
  tenantId: z.string().uuid(),
  search: z.string().max(255).optional(),
  city: z.string().max(255).optional(),
  genre: z.string().max(100).optional(),
  verified: z.coerce.boolean().optional(),
  featured: z.coerce.boolean().optional(),
  trending: z.coerce.boolean().optional(),
  popular: z.coerce.boolean().optional(),
  new: z.coerce.boolean().optional(),
  sortBy: z.enum([
    'createdAt',
    'followersCount',
    'trendingScore',
    'popularity'
  ]).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});
