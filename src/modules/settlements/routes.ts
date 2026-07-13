import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import * as svc from './service.js';

const uuid = z.string().uuid();

const listQuerySchema = z.object({
  eventId: uuid.optional(),
  status: z.enum(['pending', 'cheque-issued', 'cleared', 'on-hold']).optional()
});
const idParamsSchema = z.object({ id: uuid });
const generateSchema = z.object({ eventId: uuid });
const statusSchema = z.object({
  status: z.enum(['pending', 'cheque-issued', 'cleared', 'on-hold']),
  chequeNo: z.string().trim().max(60).optional().nullable()
});

export const settlementsRoutes = new Hono<AppEnv>();

settlementsRoutes.use('*', authMiddleware);
settlementsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

const manage = requirePermission(['event.manage']);

settlementsRoutes.get('/', validateQuery(listQuerySchema), async (c) => {
  const tenant = c.get('tenant')!;
  const query = c.get('validatedQuery') as z.infer<typeof listQuerySchema>;
  return successResponse(c, await svc.listSettlements(tenant.id, query), 'Settlements loaded');
});

settlementsRoutes.post('/generate', manage, validateBody(generateSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { eventId } = c.get('validatedBody') as z.infer<typeof generateSchema>;
  return successResponse(c, await svc.generateSettlements(tenant.id, eventId), 'Settlements generated', 201);
});

settlementsRoutes.patch('/:id/status', manage, validateParams(idParamsSchema), validateBody(statusSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  const { status, chequeNo } = c.get('validatedBody') as z.infer<typeof statusSchema>;
  return successResponse(c, await svc.updateStatus(tenant.id, id, status, chequeNo), 'Settlement updated');
});

settlementsRoutes.delete('/:id', manage, validateParams(idParamsSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await svc.deleteSettlement(tenant.id, id), 'Settlement deleted');
});
