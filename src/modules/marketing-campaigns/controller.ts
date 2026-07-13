import type { Context } from 'hono';
import { errorResponse, successResponse, paginatedResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { marketingCampaignsService } from './service.js';
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
  ScheduleCampaignInput,
  ListCampaignsQueryInput,
  PreviewCampaignInput
} from './validation.js';
import { badRequest, unauthorized } from '../../lib/errors.js';

export const marketingCampaignsController = {
  async create(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as CreateCampaignInput;
    const user = c.get('user');
    if (!user) {
      throw unauthorized('Authentication required');
    }
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const campaign = await marketingCampaignsService.createCampaign(tenant.id, user.id, input);
    return successResponse(c, campaign, 'Campaign created successfully', 201);
  },

  async update(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const input = c.get('validatedBody') as UpdateCampaignInput;
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const campaign = await marketingCampaignsService.updateCampaign(id, tenant.id, input);
    return successResponse(c, campaign, 'Campaign updated successfully');
  },

  async schedule(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const input = c.get('validatedBody') as ScheduleCampaignInput;
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const campaign = await marketingCampaignsService.scheduleCampaign(id, tenant.id, input);
    return successResponse(c, campaign, 'Campaign scheduled successfully');
  },

  async cancel(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const campaign = await marketingCampaignsService.cancelCampaign(id, tenant.id);
    return successResponse(c, campaign, 'Campaign cancelled successfully');
  },

  async preview(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const input = c.get('validatedBody') as PreviewCampaignInput;
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const rendered = await marketingCampaignsService.previewCampaign(id, tenant.id, input.email);
    return successResponse(c, rendered, 'Campaign template preview rendered');
  },

  async send(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const user = c.get('user');
    if (!user) {
      throw unauthorized('Authentication required');
    }
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const result = await marketingCampaignsService.sendCampaign(id, tenant.id, user.id);
    return successResponse(c, result, 'Campaign sent successfully');
  },

  async list(c: Context<AppEnv>) {
    const query = c.get('validatedQuery') as ListCampaignsQueryInput;
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const result = await marketingCampaignsService.listCampaigns(tenant.id, query);
    return paginatedResponse(c, result.items, result.meta, 'Campaigns retrieved');
  },

  async getAnalytics(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Campaign ID is required');
    }
    const tenant = c.get('tenant');
    if (!tenant) {
      throw badRequest('Tenant context is required');
    }

    const analytics = await marketingCampaignsService.getCampaignAnalytics(id, tenant.id);
    return successResponse(c, analytics, 'Campaign analytics retrieved');
  }
};
