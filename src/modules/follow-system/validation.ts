import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const followParamsSchema = z.object({
  id: uuidSchema
});

export const followQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export type FollowParamsInput = z.infer<typeof followParamsSchema>;
export type FollowQueryInput = z.infer<typeof followQuerySchema>;
