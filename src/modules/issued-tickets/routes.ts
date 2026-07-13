import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import { issuedTicketsController } from './controller.js';
import {
  checkInIssuedTicketSchema,
  issuedTicketListQuerySchema,
  issuedTicketNumberParamsSchema,
  issuedTicketValidateSchema,
  updateIssuedTicketSchema
} from './validation.js';

export const issuedTicketsRoutes = new Hono<AppEnv>();

issuedTicketsRoutes.use('*', authMiddleware);
issuedTicketsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

issuedTicketsRoutes.get('/', requirePermission(['ticket.read']), validateQuery(issuedTicketListQuerySchema), issuedTicketsController.list);
issuedTicketsRoutes.get('/:ticketNumber', validateParams(issuedTicketNumberParamsSchema), issuedTicketsController.getByTicketNumber);
issuedTicketsRoutes.patch(
  '/:ticketNumber',
  requirePermission(['ticket.transfer', 'ticket.cancel', 'ticket.invalidate']),
  validateParams(issuedTicketNumberParamsSchema),
  validateBody(updateIssuedTicketSchema),
  issuedTicketsController.update
);
issuedTicketsRoutes.delete(
  '/:ticketNumber',
  requirePermission(['ticket.invalidate']),
  validateParams(issuedTicketNumberParamsSchema),
  validateBody(optimisticLockSchema),
  issuedTicketsController.delete
);
issuedTicketsRoutes.post('/validate', requirePermission(['ticket.read', 'ticket.checkin']), validateBody(issuedTicketValidateSchema), issuedTicketsController.validate);
issuedTicketsRoutes.post(
  '/:ticketNumber/check-in',
  requirePermission(['ticket.checkin']),
  validateParams(issuedTicketNumberParamsSchema),
  validateBody(checkInIssuedTicketSchema),
  issuedTicketsController.checkIn
);
