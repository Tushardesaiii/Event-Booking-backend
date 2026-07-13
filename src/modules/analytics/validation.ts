import { z } from 'zod';

export const eventSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(160)
});

export const analyticsQuerySchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional()
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
    }
    return true;
  },
  {
    message: 'endDate must be greater than or equal to startDate',
    path: ['endDate']
  }
);

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50).optional(),
  cursor: z.string().datetime({ offset: true }).optional(),
  type: z.string().trim().optional()
});

export type EventSlugParams = z.infer<typeof eventSlugParamsSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
