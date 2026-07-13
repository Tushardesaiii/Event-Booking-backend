import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import { ticketsController } from './controller.js';
import { createTicketTypeSchema, ticketTypeListQuerySchema, ticketTypeSlugParamsSchema, updateTicketTypeSchema } from './validation.js';

export const ticketsRoutes = new Hono<AppEnv>();

ticketsRoutes.use('*', authMiddleware);
ticketsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

ticketsRoutes.post('/', requirePermission(['ticket.manage']), validateBody(createTicketTypeSchema), ticketsController.create);
ticketsRoutes.get('/', validateQuery(ticketTypeListQuerySchema), ticketsController.list);
ticketsRoutes.get('/:slug', validateParams(ticketTypeSlugParamsSchema), ticketsController.getBySlug);
ticketsRoutes.patch(
  '/:slug',
  requirePermission(['ticket.manage']),
  validateParams(ticketTypeSlugParamsSchema),
  validateBody(updateTicketTypeSchema),
  ticketsController.update
);
ticketsRoutes.delete(
  '/:slug',
  requirePermission(['ticket.manage']),
  validateParams(ticketTypeSlugParamsSchema),
  validateBody(optimisticLockSchema),
  ticketsController.delete
);
