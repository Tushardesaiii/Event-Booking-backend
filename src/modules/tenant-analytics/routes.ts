import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { tenantAnalyticsController } from './controller.js';
import { adminRateLimit } from '../../middlewares/rate-limit.middleware.js';
import {
  tenantSlugParamsSchema,
  tenantAnalyticsQuerySchema,
  topEventsQuerySchema,
  tenantActivityQuerySchema
} from './validation.js';

export const tenantAnalyticsRoutes = new Hono<AppEnv>();

tenantAnalyticsRoutes.use('/:slug/*', authMiddleware);
tenantAnalyticsRoutes.use('/:slug/*', adminRateLimit);
tenantAnalyticsRoutes.use('/:slug/*', tenantMiddleware({ routeParamNames: ['slug'] }));
tenantAnalyticsRoutes.use('/:slug/*', requireRole(['staff']));

tenantAnalyticsRoutes.get(
  '/:slug/dashboard',
  validateParams(tenantSlugParamsSchema),
  tenantAnalyticsController.getDashboard
);

tenantAnalyticsRoutes.get(
  '/:slug/analytics',
  validateParams(tenantSlugParamsSchema),
  validateQuery(tenantAnalyticsQuerySchema),
  tenantAnalyticsController.getAnalytics
);

tenantAnalyticsRoutes.get(
  '/:slug/top-events',
  validateParams(tenantSlugParamsSchema),
  validateQuery(topEventsQuerySchema),
  tenantAnalyticsController.getTopEvents
);

tenantAnalyticsRoutes.get(
  '/:slug/upcoming-events',
  validateParams(tenantSlugParamsSchema),
  tenantAnalyticsController.getUpcomingEvents
);

tenantAnalyticsRoutes.get(
  '/:slug/activity',
  validateParams(tenantSlugParamsSchema),
  validateQuery(tenantActivityQuerySchema),
  tenantAnalyticsController.getActivityFeed
);

tenantAnalyticsRoutes.get(
  '/:slug/health',
  validateParams(tenantSlugParamsSchema),
  tenantAnalyticsController.getHealth
);
