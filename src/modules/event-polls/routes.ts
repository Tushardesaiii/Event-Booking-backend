import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { eventPollsController } from './controller.js';
import {
  createPollSchema,
  updatePollSchema,
  votePollSchema,
  pollIdParamsSchema
} from './validation.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

export const eventPollsRoutes = new Hono<AppEnv>();

eventPollsRoutes.use('*', authMiddleware);
eventPollsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

eventPollsRoutes.post('/', validateBody(createPollSchema), eventPollsController.create);
eventPollsRoutes.get('/:id', validateParams(pollIdParamsSchema), eventPollsController.get);
eventPollsRoutes.patch(
  '/:id',
  validateParams(pollIdParamsSchema),
  validateBody(updatePollSchema),
  eventPollsController.update
);
eventPollsRoutes.delete(
  '/:id',
  validateParams(pollIdParamsSchema),
  validateBody(optimisticLockSchema),
  eventPollsController.delete
);
eventPollsRoutes.post(
  '/:id/vote',
  validateParams(pollIdParamsSchema),
  validateBody(votePollSchema),
  eventPollsController.vote
);
