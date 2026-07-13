import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { notificationsController } from './controller.js';
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
  updateNotificationPreferencesSchema
} from './validation.js';

export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.use('/notifications', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
notificationsRoutes.use('/notifications/*', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
notificationsRoutes.use('/notification-preferences', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
notificationsRoutes.use('/notification-preferences/*', authMiddleware, tenantMiddleware({ routeParamNames: [] }));

notificationsRoutes.get('/notifications', validateQuery(notificationListQuerySchema), notificationsController.list);
notificationsRoutes.patch('/notifications/:id/read', validateParams(notificationIdParamsSchema), notificationsController.markRead);
notificationsRoutes.patch('/notifications/read-all', notificationsController.markAllRead);

notificationsRoutes.get('/notification-preferences', notificationsController.getPreferences);
notificationsRoutes.patch('/notification-preferences', validateBody(updateNotificationPreferencesSchema), notificationsController.updatePreferences);
