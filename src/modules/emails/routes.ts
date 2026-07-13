import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { emailsController } from './controller.js';

export const emailRoutes = new Hono<AppEnv>();

// --- 1. PUBLIC WEBHOOKS & ONE-CLICK UNSUBSCRIBE ---
emailRoutes.post('/webhooks/brevo', (c) => emailsController.handleWebhook(c));
emailRoutes.get('/unsubscribe', (c) => emailsController.unsubscribeOneClick(c));

// --- 2. MIXED AUTHENTICATION (PUBLIC WITH TOKEN OR PROTECTED WITH AUTH) ---
emailRoutes.get(
  '/preferences',
  async (c, next) => {
    const token = c.req.query('token');
    if (token) {
      // Bypass authentication if valid unsubscribe token is provided
      return emailsController.getPreferences(c);
    }
    await next();
  },
  authMiddleware,
  tenantMiddleware({ routeParamNames: [] }),
  async (c) => emailsController.getPreferences(c)
);

emailRoutes.patch(
  '/preferences',
  async (c, next) => {
    const token = c.req.query('token');
    if (token) {
      // Bypass authentication if valid unsubscribe token is provided
      return emailsController.updatePreferences(c);
    }
    await next();
  },
  authMiddleware,
  tenantMiddleware({ routeParamNames: [] }),
  async (c) => emailsController.updatePreferences(c)
);

// --- 3. PROTECTED ORGANIZER CAMPAIGN ENDPOINTS ---
const campaignRoutes = new Hono<AppEnv>();
campaignRoutes.use('*', authMiddleware);
campaignRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Campaigns CRUD
campaignRoutes.post(
  '/campaigns',
  requirePermission(['email.campaign.create']),
  (c) => emailsController.createCampaign(c)
);
campaignRoutes.get(
  '/campaigns',
  requirePermission(['email.view']),
  (c) => emailsController.listCampaigns(c)
);
campaignRoutes.get(
  '/campaigns/:id',
  requirePermission(['email.view']),
  (c) => emailsController.getCampaign(c)
);
campaignRoutes.patch(
  '/campaigns/:id',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.updateCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/duplicate',
  requirePermission(['email.campaign.create']),
  (c) => emailsController.duplicateCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/schedule',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.scheduleCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/pause',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.pauseCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/cancel',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.cancelCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/archive',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.archiveCampaign(c)
);
campaignRoutes.post(
  '/campaigns/:id/send',
  requirePermission(['email.campaign.manage']),
  (c) => emailsController.executeCampaignNow(c)
);

// Campaign Analytics
campaignRoutes.get(
  '/campaigns/:id/analytics',
  requirePermission(['email.view']),
  (c) => emailsController.getCampaignAnalytics(c)
);
campaignRoutes.get(
  '/campaigns/:id/deliveries',
  requirePermission(['email.view']),
  (c) => emailsController.getCampaignDeliveries(c)
);
campaignRoutes.get(
  '/campaigns/:id/events',
  requirePermission(['email.view']),
  (c) => emailsController.getCampaignEvents(c)
);

emailRoutes.route('/', campaignRoutes);
