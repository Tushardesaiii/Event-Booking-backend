import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { emailMarketingController } from './controller.js';
import {
  createTemplateSchema,
  updateTemplateSchema,
  subscribeSchema,
  importCsvSchema,
  createSegmentSchema,
  updateSegmentSchema,
  createCampaignSchema,
  updateCampaignSchema,
  scheduleCampaignSchema
} from './validation.js';

export const emailMarketingRoutes = new Hono<AppEnv>();

// 1. PUBLIC ENDPOINTS (No Auth, No Tenant constraint)
emailMarketingRoutes.post('/webhooks/brevo', emailMarketingController.handleWebhook);

// 2. PROTECTED ENDPOINTS (Auth & Tenant constraints)
const protectedRoutes = new Hono<AppEnv>();
protectedRoutes.use('*', authMiddleware);
protectedRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Templates CRUD
protectedRoutes.post(
  '/templates',
  requirePermission(['email.template.manage']),
  validateBody(createTemplateSchema),
  emailMarketingController.createTemplate
);
protectedRoutes.patch(
  '/templates/:id',
  requirePermission(['email.template.manage']),
  validateBody(updateTemplateSchema),
  emailMarketingController.updateTemplate
);
protectedRoutes.get(
  '/templates/:id',
  requirePermission(['email.view']),
  emailMarketingController.getTemplate
);
protectedRoutes.get(
  '/templates',
  requirePermission(['email.view']),
  emailMarketingController.listTemplates
);
protectedRoutes.delete(
  '/templates/:id',
  requirePermission(['email.template.manage']),
  emailMarketingController.deleteTemplate
);

// Subscribers CRUD & CSV Import
protectedRoutes.post(
  '/subscribers',
  requirePermission(['email.subscriber.manage']),
  validateBody(subscribeSchema),
  emailMarketingController.subscribeSubscriber
);
protectedRoutes.post(
  '/subscribers/unsubscribe/:email',
  requirePermission(['email.subscriber.manage']),
  emailMarketingController.unsubscribeSubscriber
);
protectedRoutes.get(
  '/subscribers',
  requirePermission(['email.view']),
  emailMarketingController.listSubscribers
);
protectedRoutes.post(
  '/subscribers/import',
  requirePermission(['email.subscriber.manage']),
  validateBody(importCsvSchema),
  emailMarketingController.importCsv
);

// Segments CRUD
protectedRoutes.post(
  '/segments',
  requirePermission(['email.template.manage']),
  validateBody(createSegmentSchema),
  emailMarketingController.createSegment
);
protectedRoutes.patch(
  '/segments/:id',
  requirePermission(['email.template.manage']),
  validateBody(updateSegmentSchema),
  emailMarketingController.updateSegment
);
protectedRoutes.get(
  '/segments/:id',
  requirePermission(['email.view']),
  emailMarketingController.getSegment
);
protectedRoutes.get(
  '/segments',
  requirePermission(['email.view']),
  emailMarketingController.listSegments
);
protectedRoutes.delete(
  '/segments/:id',
  requirePermission(['email.template.manage']),
  emailMarketingController.deleteSegment
);

// Campaigns CRUD & Actions
protectedRoutes.post(
  '/campaigns',
  requirePermission(['email.campaign.create']),
  validateBody(createCampaignSchema),
  emailMarketingController.createCampaign
);
protectedRoutes.patch(
  '/campaigns/:id',
  requirePermission(['email.campaign.manage']),
  validateBody(updateCampaignSchema),
  emailMarketingController.updateCampaign
);
protectedRoutes.get(
  '/campaigns/:id',
  requirePermission(['email.view']),
  emailMarketingController.getCampaign
);
protectedRoutes.get(
  '/campaigns',
  requirePermission(['email.view']),
  emailMarketingController.listCampaigns
);
protectedRoutes.delete(
  '/campaigns/:id',
  requirePermission(['email.campaign.manage']),
  emailMarketingController.deleteCampaign
);
protectedRoutes.post(
  '/campaigns/:id/duplicate',
  requirePermission(['email.campaign.create']),
  emailMarketingController.duplicateCampaign
);
protectedRoutes.post(
  '/campaigns/:id/schedule',
  requirePermission(['email.campaign.manage']),
  validateBody(scheduleCampaignSchema),
  emailMarketingController.scheduleCampaign
);
protectedRoutes.post(
  '/campaigns/:id/cancel',
  requirePermission(['email.campaign.manage']),
  emailMarketingController.cancelSchedule
);
protectedRoutes.post(
  '/campaigns/:id/send',
  requirePermission(['email.campaign.manage']),
  emailMarketingController.sendCampaignNow
);

emailMarketingRoutes.route('/', protectedRoutes);
