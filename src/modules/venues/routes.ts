import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { venuesController } from './controller.js';
import { createVenueSchema, updateVenueSchema, venueListQuerySchema, venueSlugParamsSchema } from './validation.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

export const venuesRoutes = new Hono<AppEnv>();

venuesRoutes.use('*', authMiddleware);
venuesRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

venuesRoutes.post('/', requirePermission(['venue.manage']), validateBody(createVenueSchema), venuesController.create);
venuesRoutes.get('/', validateQuery(venueListQuerySchema), venuesController.list);
venuesRoutes.get('/:slug', validateParams(venueSlugParamsSchema), venuesController.getBySlug);
venuesRoutes.patch(
	'/:slug',
	requirePermission(['venue.manage']),
	validateParams(venueSlugParamsSchema),
	validateBody(updateVenueSchema),
	venuesController.update
);
venuesRoutes.delete(
	'/:slug',
	requirePermission(['venue.manage']),
	validateParams(venueSlugParamsSchema),
	validateBody(optimisticLockSchema),
	venuesController.delete
);
