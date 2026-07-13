import type { MiddlewareHandler } from 'hono';
import { and, eq, or } from 'drizzle-orm';

import { db } from '../db/client.js';
import { tenants } from '../db/schema/tenants.js';
import { tenantMembers } from '../db/schema/tenant-members.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import type { AppEnv } from '../types/context.js';

function resolveTenantIdentifier(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  routeParamNames: string[]
) {
  for (const paramName of routeParamNames) {
    const value = c.req.param(paramName);
    if (value) {
      return value;
    }
  }

  return (
    c.req.header('x-tenant-slug') ||
    c.req.header('x-tenant-id') ||
    new URL(c.req.url).searchParams.get('tenantId') ||
    new URL(c.req.url).searchParams.get('tenantSlug')
  );
}

export function tenantMiddleware(options: { required?: boolean; routeParamNames?: string[] } = {}): MiddlewareHandler<AppEnv> {
  const required = options.required ?? true;
  const routeParamNames = options.routeParamNames ?? ['slug', 'tenantSlug', 'tenantId'];

  return async (c, next) => {
    const tenantIdentifier = resolveTenantIdentifier(c, routeParamNames);
    const user = c.get('user');

    if (!tenantIdentifier) {
      if (!required) {
        c.set('tenant', null);
        c.set('tenantMembership', null);
        return next();
      }

      throw unauthorized('Tenant context is required');
    }

    if (!user && required) {
      throw unauthorized('Authentication required');
    }

    // Log incoming tenant resolution for debugging
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { logger } = await import('../lib/logger.js');
      logger.info('resolving tenant', { identifier: tenantIdentifier, userId: user?.id });
    } catch {}

    let tenant = null;
    try {
      // Decide whether identifier looks like a UUID; only compare id when it does.
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const isUuid = typeof tenantIdentifier === 'string' && uuidRegex.test(tenantIdentifier);

      if (isUuid) {
        const rows = await db
          .select()
          .from(tenants)
          .where(or(eq(tenants.id, tenantIdentifier), eq(tenants.slug, tenantIdentifier)))
          .limit(1);

        tenant = rows[0] ?? null;
      } else {
        const rows = await db
          .select()
          .from(tenants)
          .where(eq(tenants.slug, String(tenantIdentifier).trim()))
          .limit(1);

        tenant = rows[0] ?? null;
      }
    } catch (err) {
      // Log and surface as not found to avoid leaking internal DB errors
      throw notFound('Tenant not found');
    }

    // Treat missing, inactive or archived tenants as not found
    if (!tenant || !tenant.isActive || (tenant.deletedAt !== null && tenant.deletedAt !== undefined)) {
      throw notFound('Tenant not found');
    }

    c.set('tenant', tenant);

    if (!user) {
      c.set('tenantMembership', null);
      return next();
    }

    let membership = null;
    try {
      const rows = await db
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, user.id)))
        .limit(1);

      membership = rows[0] ?? null;
    } catch (err) {
      if (required) {
        throw forbidden('You do not have access to this tenant');
      }
    }

    if (!membership && required) {
      throw forbidden('You do not have access to this tenant');
    }

    c.set('tenantMembership', membership);
    await next();
  };
}
