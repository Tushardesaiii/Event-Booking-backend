import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { marketingSubscriberController } from './controller.js';
import {
  subscribeSchema,
  unsubscribeSchema,
  updateSubscriberSchema,
  listSubscribersQuerySchema
} from './validation.js';

export const marketingRoutes = new Hono<AppEnv>();

// Public subscriber operations
marketingRoutes.post(
  '/subscribers',
  tenantMiddleware({ required: false }),
  validateBody(subscribeSchema),
  marketingSubscriberController.subscribe
);

marketingRoutes.post(
  '/unsubscribe',
  tenantMiddleware({ required: false }),
  validateBody(unsubscribeSchema),
  marketingSubscriberController.unsubscribe
);

// Protected subscriber operations
marketingRoutes.get(
  '/subscribers',
  authMiddleware,
  tenantMiddleware({ required: false }),
  validateQuery(listSubscribersQuerySchema),
  marketingSubscriberController.list
);

marketingRoutes.patch(
  '/subscribers/:id',
  authMiddleware,
  tenantMiddleware({ required: false }),
  validateBody(updateSubscriberSchema),
  marketingSubscriberController.update
);

marketingRoutes.delete(
  '/subscribers/:id',
  authMiddleware,
  tenantMiddleware({ required: false }),
  marketingSubscriberController.delete
);
