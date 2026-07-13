import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });

export const publicEventListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  featured: booleanish,
  upcoming: booleanish,
  sortBy: z.enum(['relevance', 'date', 'price-low', 'price-high', 'match-score']).optional(),
  userId: z.string().trim().uuid().optional(),
});

export const publicEventParamsSchema = z.object({
  idOrSlug: z.string().trim().min(1).max(200),
});

export const publicOrganizerParamsSchema = z.object({
  idOrSlug: z.string().trim().min(1).max(200),
});

export const publicTrendingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
});

export type PublicEventListQuery = z.infer<typeof publicEventListQuerySchema>;
export type PublicEventParams = z.infer<typeof publicEventParamsSchema>;
export type PublicOrganizerParams = z.infer<typeof publicOrganizerParamsSchema>;
export type PublicTrendingQuery = z.infer<typeof publicTrendingQuerySchema>;
