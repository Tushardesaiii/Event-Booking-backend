import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import * as service from './service.js';
import type {
  TenantSlugParams,
  TenantAnalyticsQuery,
  TopEventsQuery,
  TenantActivityQuery
} from './validation.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const tenantAnalyticsController = {
  async getDashboard(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const data = await service.getDashboardSummary(tenant.id, slug);
    return successResponse(c, data, 'Tenant dashboard summary retrieved');
  },

  async getAnalytics(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const query = c.get('validatedQuery') as TenantAnalyticsQuery;
    const data = await service.getAdvancedAnalytics(tenant.id, slug, query?.startDate, query?.endDate);
    return successResponse(c, data, 'Tenant advanced analytics retrieved');
  },

  async getTopEvents(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const query = c.get('validatedQuery') as TopEventsQuery;
    const data = await service.getTopEvents(tenant.id, slug, query);
    return successResponse(c, data, 'Tenant top events retrieved');
  },

  async getUpcomingEvents(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const data = await service.getUpcomingEvents(tenant.id, slug);
    return successResponse(c, data, 'Tenant upcoming events retrieved');
  },

  async getActivityFeed(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const query = c.get('validatedQuery') as TenantActivityQuery;
    const data = await service.getTenantActivityFeed(tenant.id, slug, query);
    return successResponse(c, data, 'Tenant activity feed retrieved');
  },

  async getHealth(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TenantSlugParams;
    const data = await service.getHealth(tenant.id, slug);
    return successResponse(c, data, 'Tenant health status retrieved');
  }
};
