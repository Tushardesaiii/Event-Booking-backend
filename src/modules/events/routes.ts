import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import {
	eventCategoriesController,
	eventsController,
	eventSeriesController,
	eventTagsController
} from './controller.js';
import { searchRateLimit } from '../../middlewares/rate-limit.middleware.js';
import {
	createEventCategorySchema,
	createEventSchema,
	createEventSeriesSchema,
	createEventTagSchema,
	eventListQuerySchema,
	eventSeriesSlugParamsSchema,
	eventSlugParamsSchema,
	listEventCategoriesQuerySchema,
	listEventSeriesQuerySchema,
	listEventTagsQuerySchema,
	updateEventSchema
} from './validation.js';

export const eventsRoutes = new Hono<AppEnv>();
export const eventCategoriesRoutes = new Hono<AppEnv>();
export const eventTagsRoutes = new Hono<AppEnv>();
export const eventSeriesRoutes = new Hono<AppEnv>();

eventsRoutes.use('*', authMiddleware);
eventsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

eventsRoutes.post('/', requirePermission(['event.manage']), validateBody(createEventSchema), eventsController.create);
eventsRoutes.get('/', searchRateLimit, validateQuery(eventListQuerySchema), eventsController.list);
eventsRoutes.get('/:slug', validateParams(eventSlugParamsSchema), eventsController.getBySlug);
eventsRoutes.patch(
	'/:slug',
	requirePermission(['event.manage']),
	validateParams(eventSlugParamsSchema),
	validateBody(updateEventSchema),
	eventsController.update
);
eventsRoutes.delete(
	'/:slug',
	requirePermission(['event.manage']),
	validateParams(eventSlugParamsSchema),
	validateBody(optimisticLockSchema),
	eventsController.delete
);

eventCategoriesRoutes.use('*', authMiddleware);
eventCategoriesRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
eventCategoriesRoutes.post(
	'/',
	requirePermission(['event.manage']),
	validateBody(createEventCategorySchema),
	eventCategoriesController.create
);
eventCategoriesRoutes.get('/', searchRateLimit, validateQuery(listEventCategoriesQuerySchema), eventCategoriesController.list);

eventTagsRoutes.use('*', authMiddleware);
eventTagsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
eventTagsRoutes.post('/', requirePermission(['event.manage']), validateBody(createEventTagSchema), eventTagsController.create);
eventTagsRoutes.get('/', searchRateLimit, validateQuery(listEventTagsQuerySchema), eventTagsController.list);

eventSeriesRoutes.use('*', authMiddleware);
eventSeriesRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
eventSeriesRoutes.post(
	'/',
	requirePermission(['event.manage']),
	validateBody(createEventSeriesSchema),
	eventSeriesController.create
);
eventSeriesRoutes.get('/', searchRateLimit, validateQuery(listEventSeriesQuerySchema), eventSeriesController.list);
eventSeriesRoutes.get('/:slug', validateParams(eventSeriesSlugParamsSchema), eventSeriesController.getBySlug);
