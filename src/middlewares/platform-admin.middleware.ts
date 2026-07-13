import type { MiddlewareHandler } from 'hono';

import { forbidden } from '../lib/errors.js';
import type { AppEnv } from '../types/context.js';

// Gate for platform/super-admin-only routes that operate ACROSS tenants
// (e.g. event approvals). Relies on authMiddleware having loaded the user.
export const requirePlatformAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user || !(user as { isPlatformAdmin?: boolean }).isPlatformAdmin) {
    throw forbidden('Platform admin access required');
  }
  await next();
};
