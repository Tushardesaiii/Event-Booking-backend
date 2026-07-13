import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const notificationIdParamsSchema = z.object({
  id: uuidSchema
});

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  isRead: z.preprocess((val) => {
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return undefined;
  }, z.boolean().optional())
});

export const updateNotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  preferences: z.record(z.string(), z.any()).optional()
});

export type NotificationIdParamsInput = z.infer<typeof notificationIdParamsSchema>;
export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
