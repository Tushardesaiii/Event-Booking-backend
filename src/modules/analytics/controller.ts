import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import * as service from './service.js';
import type { ActivityQuery, AnalyticsQuery, EventSlugParams } from './validation.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const analyticsController = {
  async getDashboard(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const data = await service.getDashboardSummary(tenant.id, slug);
    return successResponse(c, data, 'Dashboard summary retrieved');
  },

  async getAnalytics(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const query = c.get('validatedQuery') as AnalyticsQuery;
    const data = await service.getAdvancedAnalytics(tenant.id, slug, query?.startDate, query?.endDate);
    return successResponse(c, data, 'Analytics data retrieved');
  },

  async getLiveStatus(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const data = await service.getLiveStatus(tenant.id, slug);
    return successResponse(c, data, 'Live status retrieved');
  },

  async getInventorySummary(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const data = await service.getInventorySummary(tenant.id, slug);
    return successResponse(c, data, 'Inventory summary retrieved');
  },

  async getAttendeeSummary(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const data = await service.getAttendeeSummary(tenant.id, slug);
    return successResponse(c, data, 'Attendee summary retrieved');
  },

  async getCheckinSummary(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const data = await service.getCheckinSummary(tenant.id, slug);
    return successResponse(c, data, 'Check-in summary retrieved');
  },

  async getActivityFeed(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as EventSlugParams;
    const query = c.get('validatedQuery') as ActivityQuery;
    const data = await service.getEventActivityFeed(
      tenant.id,
      slug,
      query?.limit ?? 50,
      query?.cursor,
      query?.type
    );
    return successResponse(c, data, 'Activity feed retrieved');
  }
};
