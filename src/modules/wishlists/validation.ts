import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const wishlistEventParamsSchema = z.object({
  eventId: uuidSchema
});

export const wishlistListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export type WishlistEventParamsInput = z.infer<typeof wishlistEventParamsSchema>;
export type WishlistListQueryInput = z.infer<typeof wishlistListQuerySchema>;
