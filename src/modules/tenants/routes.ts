import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import type { AppEnv } from '../../types/context.js';
import { tenantsController } from './controller.js';
import {
  createTenantMemberSchema,
  createTenantSchema,
  tenantListQuerySchema,
  tenantMemberListQuerySchema,
  tenantMemberParamsSchema,
  tenantSlugParamsSchema,
  updateTenantMemberSchema,
  updateTenantSchema,
  deleteTenantSchema
} from './schema.js';
import { adminRateLimit } from '../../middlewares/rate-limit.middleware.js';

export const tenantsRoutes = new Hono<AppEnv>();

tenantsRoutes.use('*', authMiddleware);
tenantsRoutes.use('*', adminRateLimit);

tenantsRoutes.post('/', validateBody(createTenantSchema), tenantsController.create);
tenantsRoutes.get('/', validateQuery(tenantListQuerySchema), tenantsController.list);

tenantsRoutes.get('/:slug', validateParams(tenantSlugParamsSchema), tenantMiddleware(), tenantsController.getBySlug);
tenantsRoutes.patch(
  '/:slug',
  validateParams(tenantSlugParamsSchema),
  tenantMiddleware(),
  requirePermission(['tenant.manage']),
  validateBody(updateTenantSchema),
  tenantsController.update
);
tenantsRoutes.delete(
  '/:slug',
  validateParams(tenantSlugParamsSchema),
  tenantMiddleware(),
  requirePermission(['tenant.delete']),
  validateBody(deleteTenantSchema),
  tenantsController.delete
);

tenantsRoutes.get(
  '/:slug/members',
  validateParams(tenantSlugParamsSchema),
  tenantMiddleware(),
  requirePermission(['member.manage']),
  validateQuery(tenantMemberListQuerySchema),
  tenantsController.listMembers
);
tenantsRoutes.post(
  '/:slug/members',
  validateParams(tenantSlugParamsSchema),
  tenantMiddleware(),
  requirePermission(['member.manage']),
  validateBody(createTenantMemberSchema),
  tenantsController.addMember
);
tenantsRoutes.patch(
  '/:slug/members/:memberId',
  validateParams(tenantMemberParamsSchema),
  tenantMiddleware(),
  requirePermission(['member.manage']),
  validateBody(updateTenantMemberSchema),
  tenantsController.updateMember
);
tenantsRoutes.delete(
  '/:slug/members/:memberId',
  validateParams(tenantMemberParamsSchema),
  tenantMiddleware(),
  requirePermission(['member.manage']),
  validateBody(optimisticLockSchema),
  tenantsController.removeMember
);
