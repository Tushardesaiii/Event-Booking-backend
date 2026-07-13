import type { MiddlewareHandler } from 'hono';

import { forbidden } from '../lib/errors.js';
import { hasPermission, hasRole, type TenantPermission } from '../lib/permissions.js';
import type { TenantMemberRole } from '../types/auth.js';
import type { AppEnv } from '../types/context.js';

function requireMembership(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  const membership = c.get('tenantMembership');

  if (!membership) {
    throw forbidden('Tenant membership required');
  }

  return membership;
}

function createAuthorizationMiddleware(check: (membership: { role: TenantMemberRole }) => boolean, message: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const membership = requireMembership(c);

    if (!check(membership)) {
      throw forbidden(message);
    }

    return next();
  };
}

export function requireRole(roles: readonly TenantMemberRole[]): MiddlewareHandler<AppEnv> {
  return createAuthorizationMiddleware((membership) => hasRole(membership.role, roles), 'Insufficient tenant role');
}

export function requirePermission(permissions: readonly TenantPermission[]): MiddlewareHandler<AppEnv> {
  return createAuthorizationMiddleware((membership) => permissions.some((permission) => hasPermission(membership.role, permission)), 'Insufficient tenant permissions');
}