import type { Context } from 'hono';

import { forbidden, badRequest, unauthorized } from './errors.js';
import type { PublicAuthUser } from '../types/auth.js';

/**
 * Resolve the tenant id from request context, throwing a 403 when the tenant
 * middleware has not populated it. Guarantees a non-null `string` for callers
 * that are always mounted behind the tenant guard.
 */
export function requireTenantId(c: Context): string {
  const id = c.get('tenant')?.id;
  if (!id) {
    throw forbidden('Tenant context is required');
  }
  return id;
}

/**
 * Resolve the authenticated user, throwing a 401 when absent.
 */
export function requireUser(c: Context): PublicAuthUser {
  const user = c.get('user');
  if (!user) {
    throw unauthorized('Authentication required');
  }
  return user;
}

/**
 * Resolve a required route parameter, throwing a 400 when it is missing.
 */
export function requireParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw badRequest(`Missing required parameter: ${name}`);
  }
  return value;
}
