import type { Context } from 'hono';
import { forbidden, badRequest } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { verifyBrevoWebhookSignature } from '../../lib/email/brevo.js';
import * as service from './service.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const emailMarketingController = {
  // ==========================================
  // TEMPLATES
  // ==========================================
  async createTemplate(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const input = c.get('validatedBody') as { name: string; subject: string; htmlContent: string; textContent?: string };
    const template = await service.createTemplate(tenant.id, input);
    return successResponse(c, template, 'Template created', 201);
  },

  async updateTemplate(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const input = c.get('validatedBody') as Partial<{ name: string; subject: string; htmlContent: string; textContent: string | null; isActive: boolean }>;
    const template = await service.updateTemplate(tenant.id, id, input);
    return successResponse(c, template, 'Template updated');
  },

  async getTemplate(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const template = await service.getTemplate(tenant.id, id);
    return successResponse(c, template, 'Template retrieved');
  },

  async listTemplates(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const templates = await service.getTemplates(tenant.id);
    return successResponse(c, templates, 'Templates retrieved');
  },

  async deleteTemplate(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const template = await service.deleteTemplate(tenant.id, id);
    return successResponse(c, template, 'Template deleted');
  },

  // ==========================================
  // SUBSCRIBERS
  // ==========================================
  async subscribeSubscriber(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const input = c.get('validatedBody') as { email: string; firstName?: string; lastName?: string; status?: 'subscribed' | 'unsubscribed' | 'suppressed' | 'bounced'; source?: string; userId?: string };
    const subscriber = await service.subscribeUser(tenant.id, input);
    return successResponse(c, subscriber, 'Subscribed successfully', 201);
  },

  async unsubscribeSubscriber(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { email } = c.req.param();
    const result = await service.unsubscribeUser(tenant.id, email);
    return successResponse(c, result, 'Unsubscribed successfully');
  },

  async listSubscribers(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const subscribers = await service.getSubscribers(tenant.id);
    return successResponse(c, subscribers, 'Subscribers retrieved');
  },

  async importCsv(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { subscribers } = c.get('validatedBody') as { subscribers: { email: string; firstName?: string | null; lastName?: string | null }[] };
    const result = await service.importSubscribersFromCsv(tenant.id, subscribers);
    return successResponse(c, result, `Successfully imported ${result.length} subscribers`);
  },

  // ==========================================
  // SEGMENTS
  // ==========================================
  async createSegment(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const input = c.get('validatedBody') as { name: string; description?: string; filters: any };
    const segment = await service.createSegment(tenant.id, input);
    return successResponse(c, segment, 'Segment created', 201);
  },

  async updateSegment(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const input = c.get('validatedBody') as Partial<{ name: string; description: string | null; filtersJson: any }>;
    const segment = await service.updateSegment(tenant.id, id, input);
    return successResponse(c, segment, 'Segment updated');
  },

  async getSegment(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const segment = await service.getSegment(tenant.id, id);
    return successResponse(c, segment, 'Segment retrieved');
  },

  async listSegments(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const segments = await service.getSegments(tenant.id);
    return successResponse(c, segments, 'Segments retrieved');
  },

  async deleteSegment(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const segment = await service.deleteSegment(tenant.id, id);
    return successResponse(c, segment, 'Segment deleted');
  },

  // ==========================================
  // CAMPAIGNS
  // ==========================================
  async createCampaign(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as { name: string; subject: string; templateId?: string | null; segmentId?: string | null; audienceFiltersJson?: any };
    const campaign = await service.createCampaign(tenant.id, user.id, input);
    return successResponse(c, campaign, 'Campaign created', 201);
  },

  async updateCampaign(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const input = c.get('validatedBody') as Partial<{ name: string; subject: string; templateId: string | null; segmentId: string | null; audienceFiltersJson: any }>;
    const campaign = await service.updateCampaign(tenant.id, id, input);
    return successResponse(c, campaign, 'Campaign updated');
  },

  async getCampaign(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const campaign = await service.getCampaign(tenant.id, id);
    return successResponse(c, campaign, 'Campaign retrieved');
  },

  async listCampaigns(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const campaigns = await service.getCampaigns(tenant.id);
    return successResponse(c, campaigns, 'Campaigns retrieved');
  },

  async deleteCampaign(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.req.param();
    const campaign = await service.deleteCampaign(tenant.id, id);
    return successResponse(c, campaign, 'Campaign deleted');
  },

  async duplicateCampaign(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.req.param();
    const duplicated = await service.duplicateCampaign(tenant.id, id, user.id);
    return successResponse(c, duplicated, 'Campaign duplicated', 201);
  },

  async scheduleCampaign(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.req.param();
    const { scheduledAt } = c.get('validatedBody') as { scheduledAt: string };
    const campaign = await service.scheduleCampaign(tenant.id, id, new Date(scheduledAt), user.id);
    return successResponse(c, campaign, 'Campaign scheduled');
  },

  async cancelSchedule(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.req.param();
    const campaign = await service.cancelCampaignSchedule(tenant.id, id, user.id);
    return successResponse(c, campaign, 'Campaign schedule cancelled');
  },

  async sendCampaignNow(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.req.param();
    const result = await service.executeCampaign(tenant.id, id, user.id);
    return successResponse(c, result, `Campaign sent immediately to ${result.recipientsEnqueued} recipients`);
  },

  // ==========================================
  // WEBHOOKS
  // ==========================================
  async handleWebhook(c: Context<AppEnv>) {
    const signatureHeader = c.req.header('x-sib-signature') || c.req.header('x-brevo-signature') || null;
    const rawBody = await c.req.text();

    const isValid = verifyBrevoWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      throw forbidden('Invalid webhook signature');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      throw badRequest('Invalid JSON body');
    }

    const result = await service.processBrevoWebhook(payload);
    return successResponse(c, result, 'Webhook processed successfully');
  }
};
