import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { mediaController } from './controller.js';
import {
  createMediaLinkRequestSchema,
  removeMediaLinkRequestSchema,
  entityParamsSchema,
  mediaIdParamsSchema
} from './validation.js';
import { uploadRateLimit } from '../../middlewares/rate-limit.middleware.js';

export const mediaRoutes = new Hono<AppEnv>();

// All media endpoints require authentication and tenant context
mediaRoutes.use('*', authMiddleware);
mediaRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Analytics dashboards
mediaRoutes.get('/analytics', requirePermission(['tenant.manage']), mediaController.getAnalytics);
mediaRoutes.get('/analytics/advanced', requirePermission(['tenant.manage']), mediaController.getAdvancedAnalytics);

// Quotas Management
mediaRoutes.get('/quota', mediaController.getQuota);
mediaRoutes.post('/quota', requirePermission(['tenant.manage']), mediaController.updateQuota);

// Moderation API
mediaRoutes.post('/moderation', requirePermission(['tenant.manage']), mediaController.moderateAsset);

// Media Asset upload workflow
mediaRoutes.post('/upload-direct', uploadRateLimit, mediaController.uploadDirect);
mediaRoutes.post('/upload-url', uploadRateLimit, mediaController.getSignedUploadUrl);
mediaRoutes.post('/complete', uploadRateLimit, mediaController.completeUpload);

// Dynamic Entity Linking endpoints
mediaRoutes.post('/link', validateBody(createMediaLinkRequestSchema), mediaController.linkMediaAsset);
mediaRoutes.delete('/link', validateBody(removeMediaLinkRequestSchema), mediaController.unlinkMediaAsset);

// Asset retrieval & deletion (wildcards placed last to prevent capture conflicts)
mediaRoutes.get('/:id', validateParams(mediaIdParamsSchema), mediaController.getMediaAsset);
mediaRoutes.delete('/:id', validateParams(mediaIdParamsSchema), mediaController.deleteMediaAsset);

// Dynamic Entity queries
mediaRoutes.get('/entity/:type/:id', validateParams(entityParamsSchema), mediaController.getEntityMedia);
mediaRoutes.get('/gallery/:type/:id', validateParams(entityParamsSchema), mediaController.getEntityGallery);
