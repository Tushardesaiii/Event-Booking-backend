import type { Context } from 'hono';

import { unauthorized } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import type {
  CreateTenantInput,
  CreateTenantMemberInput,
  TenantListQueryInput,
  TenantMemberListQueryInput,
  UpdateTenantInput,
  UpdateTenantMemberInput,
  DeleteTenantInput
} from './schema.js';
import {
  addMember as addTenantMember,
  changeMemberRole,
  createTenant,
  deleteTenant,
  getTenant,
  listMembers as listTenantMembers,
  listTenants,
  removeMember as removeTenantMember,
  updateTenant
} from './service.js';

type TenantContext = Context<AppEnv>;

function getValidatedBody<T>(c: TenantContext) {
  return c.get('validatedBody') as T;
}

function getValidatedQuery<T>(c: TenantContext) {
  return c.get('validatedQuery') as T;
}

function getValidatedParams<T>(c: TenantContext) {
  return c.get('validatedParams') as T;
}

export const tenantsController = {
  async create(c: TenantContext) {
    const user = c.get('user');

    if (!user) {
      throw unauthorized('Authentication required');
    }

    const body = getValidatedBody<CreateTenantInput>(c);
    const tenant = await createTenant(user, body);
    return successResponse(c, tenant, 'Tenant created', 201);
  },

  async list(c: TenantContext) {
    const user = c.get('user');

    if (!user) {
      throw unauthorized('Authentication required');
    }

    const query = getValidatedQuery<TenantListQueryInput>(c);
    const { items, meta } = await listTenants(user, query);
    return paginatedResponse(c, items, meta, 'Tenants loaded');
  },

  async getBySlug(c: TenantContext) {
    const user = c.get('user');

    if (!user) {
      throw unauthorized('Authentication required');
    }

    // If tenant middleware ran, prefer the tenant already attached to context
    const ctxTenant = c.get('tenant');
    const ctxMembership = c.get('tenantMembership');

    if (ctxTenant && ctxMembership) {
      return successResponse(c, { tenant: ctxTenant, membership: ctxMembership }, 'Tenant loaded');
    }

    // Fallback: validate params and perform lookup with service (handles missing membership)
    const params = getValidatedParams<{ slug: string }>(c);

    try {
      const data = await getTenant(user, params.slug);
      return successResponse(c, data, 'Tenant loaded');
    } catch (err) {
      // Log structured info for debugging and rethrow to be handled by error middleware
      // Import logger locally to avoid circular deps in larger apps
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { logger } = await import('../../lib/logger.js');
        logger.error('getBySlug error', { slug: params.slug, userId: user.id, error: (err instanceof Error) ? err.message : String(err) });
      } catch {}

      throw err;
    }
  },

  async update(c: TenantContext) {
    const tenant = c.get('tenant');
    const membership = c.get('tenantMembership');

    if (!tenant || !membership) {
      throw unauthorized('Tenant context required');
    }

    const body = getValidatedBody<UpdateTenantInput>(c);
    const updatedTenant = await updateTenant(tenant.id, membership, body);
    return successResponse(c, updatedTenant, 'Tenant updated');
  },

  async delete(c: TenantContext) {
    const tenant = c.get('tenant');
    const membership = c.get('tenantMembership');

    if (!tenant || !membership) {
      throw unauthorized('Tenant context required');
    }

    const body = getValidatedBody<DeleteTenantInput>(c);
    const deletedTenant = await deleteTenant(tenant.id, membership, body.lastKnownUpdatedAt, body.confirmDelete);
    return successResponse(c, deletedTenant, 'Tenant archived');
  },

  async listMembers(c: TenantContext) {
    const tenant = c.get('tenant');

    if (!tenant) {
      throw unauthorized('Tenant context required');
    }

    const query = getValidatedQuery<TenantMemberListQueryInput>(c);
    const { items, meta } = await listTenantMembers(tenant.id, query);
    return paginatedResponse(c, items, meta, 'Tenant members loaded');
  },

  async addMember(c: TenantContext) {
    const tenant = c.get('tenant');
    const membership = c.get('tenantMembership');

    if (!tenant || !membership) {
      throw unauthorized('Tenant context required');
    }

    const body = getValidatedBody<CreateTenantMemberInput>(c);
    const member = await addTenantMember(tenant.id, membership, body);
    return successResponse(c, member, 'Tenant member added', 201);
  },

  async updateMember(c: TenantContext) {
    const tenant = c.get('tenant');
    const membership = c.get('tenantMembership');

    if (!tenant || !membership) {
      throw unauthorized('Tenant context required');
    }

    const params = getValidatedParams<{ slug: string; memberId: string }>(c);
    const body = getValidatedBody<UpdateTenantMemberInput>(c);
    const member = await changeMemberRole(tenant.id, params.memberId, membership, body);
    return successResponse(c, member, 'Tenant member updated');
  },

  async removeMember(c: TenantContext) {
    const tenant = c.get('tenant');
    const membership = c.get('tenantMembership');

    if (!tenant || !membership) {
      throw unauthorized('Tenant context required');
    }

    const params = getValidatedParams<{ slug: string; memberId: string }>(c);
    const body = getValidatedBody<{ lastKnownUpdatedAt: string }>(c);
    const member = await removeTenantMember(tenant.id, params.memberId, membership, body.lastKnownUpdatedAt);
    return successResponse(c, member, 'Tenant member removed');
  }
};
