import type { Context } from 'hono';
import { campaignService } from './campaign.service.js';
import { preferencesService } from './preferences.service.js';
import { emailsService } from './service.js';
import { emailsAnalytics } from './analytics.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { verifyBrevoWebhookSignature } from '../../lib/email/brevo.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../db/client.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';
import { eq } from 'drizzle-orm';
import { requireTenantId, requireUser, requireParam } from '../../lib/http-context.js';

export class EmailsController {
  // --- CAMPAIGNS ---

  async createCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const user = requireUser(c);
    const body = await c.req.json();
    const campaign = await campaignService.createCampaign(tenantId, user.id, body);
    return successResponse(c, campaign, 'Campaign created successfully', 201);
  }

  async getCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const campaign = await campaignService.getCampaign(tenantId, id);
    return successResponse(c, campaign);
  }

  async updateCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const body = await c.req.json();
    const updated = await campaignService.updateCampaign(tenantId, id, body);
    return successResponse(c, updated, 'Campaign updated successfully');
  }

  async listCampaigns(c: Context) {
    const tenantId = requireTenantId(c);
    const campaigns = await campaignService.listCampaigns(tenantId);
    return successResponse(c, campaigns);
  }

  async duplicateCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const user = requireUser(c);
    const duplicated = await campaignService.duplicateCampaign(tenantId, id, user.id);
    return successResponse(c, duplicated, 'Campaign duplicated successfully', 201);
  }

  async scheduleCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const user = requireUser(c);
    const { scheduledAt } = await c.req.json();
    if (!scheduledAt) {
      return errorResponse(c, { message: 'scheduledAt is required', code: 'BAD_REQUEST', status: 400 });
    }
    const scheduled = await campaignService.scheduleCampaign(tenantId, id, scheduledAt, user.id);
    return successResponse(c, scheduled, 'Campaign scheduled successfully');
  }

  async pauseCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const paused = await campaignService.pauseCampaign(tenantId, id);
    return successResponse(c, paused, 'Campaign paused successfully');
  }

  async cancelCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const cancelled = await campaignService.cancelCampaign(tenantId, id);
    return successResponse(c, cancelled, 'Campaign cancelled successfully');
  }

  async archiveCampaign(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const archived = await campaignService.archiveCampaign(tenantId, id);
    return successResponse(c, archived, 'Campaign archived successfully');
  }

  async executeCampaignNow(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const user = requireUser(c);
    const result = await campaignService.executeCampaignImmediate(tenantId, id, user.id);
    return successResponse(c, result, 'Campaign execution triggered successfully');
  }

  // --- ANALYTICS ---

  async getCampaignAnalytics(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const analytics = await emailsAnalytics.getCampaignAnalytics(tenantId, id);
    return successResponse(c, analytics);
  }

  async getCampaignDeliveries(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const deliveries = await emailsAnalytics.getCampaignDeliveries(tenantId, id);
    return successResponse(c, deliveries);
  }

  async getCampaignEvents(c: Context) {
    const tenantId = requireTenantId(c);
    const id = requireParam(c, 'id');
    const events = await emailsAnalytics.getCampaignEvents(tenantId, id);
    return successResponse(c, events);
  }

  // --- PREFERENCES & UNSUBSCRIBE ---

  async getPreferences(c: Context) {
    try {
      const token = c.req.query('token');
      const user = c.get('user');
      const tenantId = c.get('tenant')?.id ?? null;

      console.log('[DEBUG getPreferences input]', { token, userId: user?.id, userEmail: user?.email, tenantId });

      if (token) {
        const prefs = await preferencesService.getPreferencesByToken(token);
        return successResponse(c, prefs);
      }

      if (!user) {
        return errorResponse(c, { message: 'Unauthorized: Authentication or unsubscribe token required', code: 'UNAUTHORIZED', status: 401 });
      }

      let userEmail: string | null | undefined = user.email;
      if (!userEmail && user.id) {
        const accounts = await db
          .select({ email: authAccounts.email })
          .from(authAccounts)
          .where(eq(authAccounts.userId, user.id));
        userEmail = accounts.find(a => a.email)?.email;
      }

      console.log('[DEBUG getPreferences userEmail resolved]', { userEmail });

      if (!userEmail) {
        return errorResponse(c, { message: 'User email not found', code: 'BAD_REQUEST', status: 400 });
      }

      if (!tenantId) {
        return errorResponse(c, { message: 'Tenant context is required', code: 'FORBIDDEN', status: 403 });
      }

      const prefs = await preferencesService.getPreferences(tenantId, userEmail, user.id);
      return successResponse(c, prefs);
    } catch (err: any) {
      console.error('[DEBUG getPreferences ERROR]', err);
      console.error('[DEBUG getPreferences ERROR stack]', err?.stack);
      throw err;
    }
  }

  async updatePreferences(c: Context) {
    const token = c.req.query('token');
    const user = c.get('user');
    const body = await c.req.json();
    const tenantId = c.get('tenant')?.id ?? null;

    if (token) {
      const prefs = await preferencesService.getPreferencesByToken(token);
      const updated = await preferencesService.updatePreferences(prefs.tenantId, prefs.email, body);
      return successResponse(c, updated, 'Preferences updated successfully');
    }

    if (!user) {
      return errorResponse(c, { message: 'Unauthorized', code: 'UNAUTHORIZED', status: 401 });
    }

    let userEmail: string | null | undefined = user.email;
    if (!userEmail && user.id) {
      const accounts = await db
        .select({ email: authAccounts.email })
        .from(authAccounts)
        .where(eq(authAccounts.userId, user.id));
      userEmail = accounts.find(a => a.email)?.email;
    }

    if (!userEmail) {
      return errorResponse(c, { message: 'User email not found', code: 'BAD_REQUEST', status: 400 });
    }

    if (!tenantId) {
      return errorResponse(c, { message: 'Tenant context is required', code: 'FORBIDDEN', status: 403 });
    }

    const updated = await preferencesService.updatePreferences(tenantId, userEmail, body);
    return successResponse(c, updated, 'Preferences updated successfully');
  }

  async unsubscribeOneClick(c: Context) {
    const token = c.req.query('token') || c.req.param('token');
    if (!token) {
      return errorResponse(c, { message: 'Token is required', code: 'BAD_REQUEST', status: 400 });
    }

    const result = await preferencesService.unsubscribeOneClick(token);
    return successResponse(c, result, 'Unsubscribed successfully');
  }

  // --- WEBHOOKS ---

  async handleWebhook(c: Context) {
    const signature = c.req.header('x-sib-signature') || c.req.header('x-brevo-signature') || '';
    const rawBody = await c.req.text();

    // Verify webhook signature (with development bypass if not in production and header is missing)
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction || signature) {
      const isValid = verifyBrevoWebhookSignature(rawBody, signature);
      if (!isValid) {
        logger.warn('[EmailsController] Brevo webhook signature mismatch');
        return errorResponse(c, { message: 'Invalid signature', code: 'UNAUTHORIZED', status: 401 });
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return errorResponse(c, { message: 'Invalid JSON body', code: 'BAD_REQUEST', status: 400 });
    }

    await emailsService.processWebhook(payload);
    return successResponse(c, { received: true });
  }
}

export const emailsController = new EmailsController();
