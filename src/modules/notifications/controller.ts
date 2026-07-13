import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  getInAppNotifications,
  getPreferences,
  markAllAsRead,
  markAsRead,
  updatePreferences
} from './service.js';
import type {
  NotificationIdParams,
  NotificationListQuery,
  UpdateNotificationPreferencesDTO
} from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const user = c.get('user');

  if (!tenant || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, user };
}

export const notificationsController = {
  async list(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const query = c.get('validatedQuery') as NotificationListQuery;
    const result = await getInAppNotifications(tenant.id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Notifications retrieved');
  },

  async markRead(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as NotificationIdParams;
    const notification = await markAsRead(tenant.id, user.id, id);

    return successResponse(c, notification, 'Notification marked as read');
  },

  async markAllRead(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const result = await markAllAsRead(tenant.id, user.id);

    return successResponse(c, result, 'All notifications marked as read');
  },

  async getPreferences(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const preferences = await getPreferences(tenant.id, user.id);

    return successResponse(c, preferences, 'Notification preferences retrieved');
  },

  async updatePreferences(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as UpdateNotificationPreferencesDTO;
    const preferences = await updatePreferences(tenant.id, user.id, input);

    return successResponse(c, preferences, 'Notification preferences updated');
  }
};
