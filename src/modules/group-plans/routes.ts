import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { groupPlansController } from './controller.js';
import {
  createGroupPlanSchema,
  updateGroupPlanSchema,
  groupPlanListQuerySchema,
  groupPlanIdParamsSchema,
  groupPlanInviteParamsSchema,
  inviteMemberSchema
} from './validation.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

export const groupPlansRoutes = new Hono<AppEnv>();

groupPlansRoutes.use('*', authMiddleware);
groupPlansRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

groupPlansRoutes.post('/', validateBody(createGroupPlanSchema), groupPlansController.create);
groupPlansRoutes.get('/', validateQuery(groupPlanListQuerySchema), groupPlansController.list);

groupPlansRoutes.get('/:id', validateParams(groupPlanIdParamsSchema), groupPlansController.get);
groupPlansRoutes.patch(
  '/:id',
  validateParams(groupPlanIdParamsSchema),
  validateBody(updateGroupPlanSchema),
  groupPlansController.update
);
groupPlansRoutes.delete(
  '/:id',
  validateParams(groupPlanIdParamsSchema),
  validateBody(optimisticLockSchema),
  groupPlansController.delete
);

groupPlansRoutes.post(
  '/:id/invite',
  validateParams(groupPlanIdParamsSchema),
  validateBody(inviteMemberSchema),
  groupPlansController.invite
);

groupPlansRoutes.post(
  '/invites/:inviteId/accept',
  validateParams(groupPlanInviteParamsSchema),
  groupPlansController.acceptInvite
);

groupPlansRoutes.post(
  '/invites/:inviteId/reject',
  validateParams(groupPlanInviteParamsSchema),
  groupPlansController.rejectInvite
);

groupPlansRoutes.post(
  '/:id/leave',
  validateParams(groupPlanIdParamsSchema),
  groupPlansController.leave
);

groupPlansRoutes.get(
  '/:id/members',
  validateParams(groupPlanIdParamsSchema),
  groupPlansController.getMembers
);

groupPlansRoutes.delete(
  '/:id/members',
  validateParams(groupPlanIdParamsSchema),
  groupPlansController.removeMember
);

groupPlansRoutes.post(
  '/:id/transfer-ownership',
  validateParams(groupPlanIdParamsSchema),
  groupPlansController.transferOwnership
);

groupPlansRoutes.get(
  '/:id/activity',
  validateParams(groupPlanIdParamsSchema),
  groupPlansController.getActivity
);
