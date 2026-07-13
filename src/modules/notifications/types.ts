import type { InferSelectModel } from 'drizzle-orm';
import type { notifications, notificationPreferences } from './schema.js';
import type {
  NotificationIdParamsInput,
  NotificationListQueryInput,
  UpdateNotificationPreferencesInput
} from './validation.js';

export type InAppNotificationRecord = InferSelectModel<typeof notifications>;
export type NotificationPreferenceRecord = InferSelectModel<typeof notificationPreferences>;

export type NotificationIdParams = NotificationIdParamsInput;
export type NotificationListQuery = NotificationListQueryInput;
export type UpdateNotificationPreferencesDTO = UpdateNotificationPreferencesInput;

export interface CreateInAppNotificationDTO {
  tenantId: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, any>;
}
