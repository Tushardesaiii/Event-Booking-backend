import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { organizersController } from './controller.js';
import {
  createOrganizerSchema,
  updateOrganizerSchema,
  organizerListQuerySchema,
  organizerSlugParamsSchema,
  createOrganizerReviewSchema,
  updateOrganizerReviewSchema,
  organizerVerificationRequestSchema,
  organizerVerificationDecisionSchema,
  organizerSafetyProfileSchema
} from './validation.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

export const organizersRoutes = new Hono<AppEnv>();

organizersRoutes.use('*', authMiddleware);
organizersRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Discovery endpoints (registered before slug params)
organizersRoutes.get('/trending', organizersController.getTrending);
organizersRoutes.get('/popular', organizersController.getPopular);
organizersRoutes.get('/recommended', organizersController.getRecommended);
organizersRoutes.get('/search', organizersController.search);

// Base routing
organizersRoutes.post('/', requirePermission(['tenant.manage']), validateBody(createOrganizerSchema), organizersController.create);
organizersRoutes.get('/', validateQuery(organizerListQuerySchema), organizersController.list);

// ID-based review modifications
organizersRoutes.patch('/reviews/:id', validateBody(updateOrganizerReviewSchema), organizersController.updateReview);
organizersRoutes.delete('/reviews/:id', organizersController.deleteReview);

// Slug-based routing
organizersRoutes.get('/:slug', validateParams(organizerSlugParamsSchema), organizersController.getBySlug);
organizersRoutes.patch(
  '/:slug',
  requirePermission(['tenant.manage']),
  validateParams(organizerSlugParamsSchema),
  validateBody(updateOrganizerSchema),
  organizersController.update
);
organizersRoutes.delete(
  '/:slug',
  requirePermission(['tenant.manage']),
  validateParams(organizerSlugParamsSchema),
  validateBody(optimisticLockSchema),
  organizersController.delete
);

organizersRoutes.get('/:slug/events', validateParams(organizerSlugParamsSchema), organizersController.getEvents);
organizersRoutes.get('/:slug/reviews', validateParams(organizerSlugParamsSchema), organizersController.getReviews);
organizersRoutes.post('/:slug/reviews', validateParams(organizerSlugParamsSchema), validateBody(createOrganizerReviewSchema), organizersController.createReview);
organizersRoutes.get('/:slug/analytics', validateParams(organizerSlugParamsSchema), organizersController.getAnalytics);

// Follow/unfollow/followers/following
organizersRoutes.post('/:slug/follow', validateParams(organizerSlugParamsSchema), organizersController.follow);
organizersRoutes.delete('/:slug/follow', validateParams(organizerSlugParamsSchema), organizersController.unfollow);
organizersRoutes.get('/:slug/followers', validateParams(organizerSlugParamsSchema), organizersController.getFollowers);
organizersRoutes.get('/:slug/following', validateParams(organizerSlugParamsSchema), organizersController.getFollowing);

// Likes
organizersRoutes.post('/:slug/like', validateParams(organizerSlugParamsSchema), organizersController.like);
organizersRoutes.delete('/:slug/like', validateParams(organizerSlugParamsSchema), organizersController.unlike);
organizersRoutes.get('/:slug/likes', validateParams(organizerSlugParamsSchema), organizersController.getLikes);

// Verification trust requests & review
organizersRoutes.post(
  '/:slug/verification-request',
  validateParams(organizerSlugParamsSchema),
  validateBody(organizerVerificationRequestSchema),
  organizersController.requestVerification
);
organizersRoutes.patch(
  '/:slug/verification',
  requirePermission(['tenant.manage']),
  validateParams(organizerSlugParamsSchema),
  validateBody(organizerVerificationDecisionSchema),
  organizersController.submitVerificationDecision
);

// Safety profile
organizersRoutes.get('/:slug/safety', validateParams(organizerSlugParamsSchema), organizersController.getSafety);
organizersRoutes.post(
  '/:slug/safety',
  requirePermission(['tenant.manage']),
  validateParams(organizerSlugParamsSchema),
  validateBody(organizerSafetyProfileSchema),
  organizersController.upsertSafety
);

// Dashboard and activities
organizersRoutes.get('/:slug/dashboard', validateParams(organizerSlugParamsSchema), organizersController.getDashboard);
organizersRoutes.get('/:slug/activity', validateParams(organizerSlugParamsSchema), organizersController.getActivity);
