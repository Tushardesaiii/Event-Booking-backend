import { z } from 'zod';

export const tenantSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(160)
});

export const tenantAnalyticsQuerySchema = z.object({
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

export const topEventsQuerySchema = z.object({
  sortBy: z.enum(['ticketsSold', 'revenue', 'attendees', 'checkIns']).default('ticketsSold'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().positive().max(100).default(10)
});

export const tenantActivityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50).optional(),
  cursor: z.string().datetime({ offset: true }).optional(),
  type: z.string().trim().optional(),
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

export type TenantSlugParams = z.infer<typeof tenantSlugParamsSchema>;
export type TenantAnalyticsQuery = z.infer<typeof tenantAnalyticsQuerySchema>;
export type TopEventsQuery = z.infer<typeof topEventsQuerySchema>;
export type TenantActivityQuery = z.infer<typeof tenantActivityQuerySchema>;
