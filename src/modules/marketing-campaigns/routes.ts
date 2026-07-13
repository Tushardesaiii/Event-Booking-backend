import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { marketingCampaignsController } from './controller.js';
import {
  createCampaignSchema,
  updateCampaignSchema,
  scheduleCampaignSchema,
  listCampaignsQuerySchema,
  previewCampaignSchema
} from './validation.js';

export const marketingCampaignRoutes = new Hono<AppEnv>();

// All campaign operations are protected and tenant-scoped
marketingCampaignRoutes.use('*', authMiddleware);
marketingCampaignRoutes.use('*', tenantMiddleware({ required: true }));

marketingCampaignRoutes.post(
  '/',
  validateBody(createCampaignSchema),
  marketingCampaignsController.create
);

marketingCampaignRoutes.get(
  '/',
  validateQuery(listCampaignsQuerySchema),
  marketingCampaignsController.list
);

marketingCampaignRoutes.patch(
  '/:id',
  validateBody(updateCampaignSchema),
  marketingCampaignsController.update
);

marketingCampaignRoutes.post(
  '/:id/schedule',
  validateBody(scheduleCampaignSchema),
  marketingCampaignsController.schedule
);

marketingCampaignRoutes.post(
  '/:id/cancel',
  marketingCampaignsController.cancel
);

marketingCampaignRoutes.post(
  '/:id/preview',
  validateBody(previewCampaignSchema),
  marketingCampaignsController.preview
);

marketingCampaignRoutes.post(
  '/:id/send',
  marketingCampaignsController.send
);

marketingCampaignRoutes.get(
  '/:id/analytics',
  marketingCampaignsController.getAnalytics
);
