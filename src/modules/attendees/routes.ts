import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import { attendeesController } from './controller.js';
import { attendeeIdParamsSchema, attendeeListQuerySchema, attendeeRevertCheckInSchema, attendeeCheckInSchema, createAttendeeSchema, updateAttendeeSchema } from './validation.js';

export const attendeesRoutes = new Hono<AppEnv>();

attendeesRoutes.use('*', authMiddleware);
attendeesRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

attendeesRoutes.post('/', requirePermission(['attendee.manage']), validateBody(createAttendeeSchema), attendeesController.create);
attendeesRoutes.get('/', validateQuery(attendeeListQuerySchema), attendeesController.list);
attendeesRoutes.get('/:id', validateParams(attendeeIdParamsSchema), attendeesController.getById);
attendeesRoutes.patch(
  '/:id',
  requirePermission(['attendee.manage']),
  validateParams(attendeeIdParamsSchema),
  validateBody(updateAttendeeSchema),
  attendeesController.update
);
attendeesRoutes.delete(
  '/:id',
  requirePermission(['attendee.manage']),
  validateParams(attendeeIdParamsSchema),
  validateBody(optimisticLockSchema),
  attendeesController.delete
);
attendeesRoutes.patch(
  '/:id/check-in',
  requirePermission(['attendee.manage', 'ticket.checkin']),
  validateParams(attendeeIdParamsSchema),
  validateBody(attendeeCheckInSchema),
  attendeesController.checkIn
);
attendeesRoutes.patch(
  '/:id/revert-check-in',
  requirePermission(['attendee.manage', 'ticket.checkin']),
  validateParams(attendeeIdParamsSchema),
  validateBody(attendeeRevertCheckInSchema),
  attendeesController.revertCheckIn
);