import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { groupBookingsController } from './controller.js';
import {
  createGroupBookingSchema,
  groupBookingListQuerySchema,
  groupBookingIdParamsSchema,
  inviteMemberSchema,
  updateShareSchema,
  recordContributionSchema,
  groupBookingCancelSchema,
  groupBookingActivityQuerySchema,
  groupBookingAssignAttendeesSchema
} from './validation.js';
import { bookingRateLimit } from '../../middlewares/rate-limit.middleware.js';

export const groupBookingsRoutes = new Hono<AppEnv>();

groupBookingsRoutes.use('*', authMiddleware);
groupBookingsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

groupBookingsRoutes.post('/', bookingRateLimit, validateBody(createGroupBookingSchema), groupBookingsController.create);
groupBookingsRoutes.get('/', validateQuery(groupBookingListQuerySchema), groupBookingsController.list);
groupBookingsRoutes.get('/:id', validateParams(groupBookingIdParamsSchema), groupBookingsController.get);

groupBookingsRoutes.post(
  '/:id/invite',
  validateParams(groupBookingIdParamsSchema),
  validateBody(inviteMemberSchema),
  groupBookingsController.invite
);

groupBookingsRoutes.post(
  '/:id/accept',
  validateParams(groupBookingIdParamsSchema),
  groupBookingsController.acceptInvite
);

groupBookingsRoutes.post(
  '/:id/decline',
  validateParams(groupBookingIdParamsSchema),
  groupBookingsController.declineInvite
);

groupBookingsRoutes.delete(
  '/:id/members',
  validateParams(groupBookingIdParamsSchema),
  groupBookingsController.removeMember
);

groupBookingsRoutes.patch(
  '/:id/share',
  validateParams(groupBookingIdParamsSchema),
  validateBody(updateShareSchema),
  groupBookingsController.updateShare
);

groupBookingsRoutes.post(
  '/:id/contribute',
  validateParams(groupBookingIdParamsSchema),
  validateBody(recordContributionSchema),
  groupBookingsController.contribute
);

groupBookingsRoutes.post(
  '/:id/cancel',
  validateParams(groupBookingIdParamsSchema),
  validateBody(groupBookingCancelSchema),
  groupBookingsController.cancel
);

groupBookingsRoutes.get(
  '/:id/activity',
  validateParams(groupBookingIdParamsSchema),
  validateQuery(groupBookingActivityQuerySchema),
  groupBookingsController.getActivity
);

groupBookingsRoutes.post(
  '/:id/assign-attendees',
  validateParams(groupBookingIdParamsSchema),
  validateBody(groupBookingAssignAttendeesSchema),
  groupBookingsController.assignAttendees
);
