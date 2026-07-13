import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { analyticsController } from './controller.js';
import { activityQuerySchema, analyticsQuerySchema, eventSlugParamsSchema } from './validation.js';

export const analyticsRoutes = new Hono<AppEnv>();

analyticsRoutes.use('*', authMiddleware);
analyticsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
analyticsRoutes.use('*', requireRole(['staff']));

analyticsRoutes.get(
  '/:slug/dashboard',
  validateParams(eventSlugParamsSchema),
  analyticsController.getDashboard
);

analyticsRoutes.get(
  '/:slug/analytics',
  validateParams(eventSlugParamsSchema),
  validateQuery(analyticsQuerySchema),
  analyticsController.getAnalytics
);

analyticsRoutes.get(
  '/:slug/live-status',
  validateParams(eventSlugParamsSchema),
  analyticsController.getLiveStatus
);

analyticsRoutes.get(
  '/:slug/inventory-summary',
  validateParams(eventSlugParamsSchema),
  analyticsController.getInventorySummary
);

analyticsRoutes.get(
  '/:slug/attendee-summary',
  validateParams(eventSlugParamsSchema),
  analyticsController.getAttendeeSummary
);

analyticsRoutes.get(
  '/:slug/checkin-summary',
  validateParams(eventSlugParamsSchema),
  analyticsController.getCheckinSummary
);

analyticsRoutes.get(
  '/:slug/activity',
  validateParams(eventSlugParamsSchema),
  validateQuery(activityQuerySchema),
  analyticsController.getActivityFeed
);
