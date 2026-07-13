import { z } from 'zod';

export const subscribeSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  source: z.string().trim().default('web'),
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

export const unsubscribeSchema = z.object({
  email: z.string().email().trim().toLowerCase()
});

export const updateSubscriberSchema = z.object({
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

export const listSubscribersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional().nullable(),
  tenantId: z.string().uuid().optional().nullable() // For platform admins to query specific tenants
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;
export type UpdateSubscriberInput = z.infer<typeof updateSubscriberSchema>;
export type ListSubscribersQueryInput = z.infer<typeof listSubscribersQuerySchema>;
