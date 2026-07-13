import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import { bookingOrdersController } from './controller.js';
import {
  assignBookingOrderAttendeesSchema,
  bookingOrderAttendeesQuerySchema,
  bookingOrderListQuerySchema,
  bookingOrderNumberParamsSchema,
  createBookingOrderSchema,
  updateBookingOrderSchema
} from './validation.js';
import { validateUpdateBookingBody } from './middleware.js';
import { bookingRateLimit } from '../../middlewares/rate-limit.middleware.js';

export const bookingOrdersRoutes = new Hono<AppEnv>();

bookingOrdersRoutes.use('*', authMiddleware);
bookingOrdersRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

bookingOrdersRoutes.post('/', bookingRateLimit, validateBody(createBookingOrderSchema), bookingOrdersController.create);
bookingOrdersRoutes.get('/', requirePermission(['booking.read']), validateQuery(bookingOrderListQuerySchema), bookingOrdersController.list);
bookingOrdersRoutes.get('/:orderNumber', validateParams(bookingOrderNumberParamsSchema), bookingOrdersController.getByOrderNumber);
bookingOrdersRoutes.patch(
  '/:orderNumber',
  validateParams(bookingOrderNumberParamsSchema),
  validateUpdateBookingBody(),
  bookingOrdersController.update
);
bookingOrdersRoutes.delete(
  '/:orderNumber',
  validateParams(bookingOrderNumberParamsSchema),
  validateBody(optimisticLockSchema),
  bookingOrdersController.delete
);
bookingOrdersRoutes.get('/:orderNumber/items', validateParams(bookingOrderNumberParamsSchema), bookingOrdersController.listItems);
bookingOrdersRoutes.get(
  '/:orderNumber/attendees',
  validateParams(bookingOrderNumberParamsSchema),
  validateQuery(bookingOrderAttendeesQuerySchema),
  bookingOrdersController.listAttendees
);
bookingOrdersRoutes.post(
  '/:orderNumber/assign-attendees',
  validateParams(bookingOrderNumberParamsSchema),
  validateBody(assignBookingOrderAttendeesSchema),
  bookingOrdersController.assignAttendees
);