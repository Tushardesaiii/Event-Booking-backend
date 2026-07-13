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
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional()
});
const idParamsSchema = z.object({ id: uuid });

const createZoneSchema = z.object({
  eventId: uuid,
  name: z.string().trim().min(1).max(160),
  gate: z.string().trim().max(80).optional().nullable(),
  total: z.coerce.number().int().min(0).max(1_000_000).default(0),
  used: z.coerce.number().int().min(0).max(1_000_000).optional()
});
const updateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    gate: z.string().trim().max(80).nullable(),
    total: z.coerce.number().int().min(0).max(1_000_000),
    used: z.coerce.number().int().min(0).max(1_000_000)
  })
  .partial();

const createRequestSchema = z.object({
  eventId: uuid,
  attendeeName: z.string().trim().min(1).max(160),
  need: z.string().trim().min(1).max(500),
  gate: z.string().trim().max(80).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
  notes: z.string().trim().max(2000).optional().nullable()
});
const updateRequestSchema = z
  .object({
    attendeeName: z.string().trim().min(1).max(160),
    need: z.string().trim().min(1).max(500),
    gate: z.string().trim().max(80).nullable(),
    contact: z.string().trim().max(120).nullable(),
    status: z.enum(['pending', 'confirmed', 'cancelled']),
    notes: z.string().trim().max(2000).nullable()
  })
  .partial();

export const accessibilityRoutes = new Hono<AppEnv>();

accessibilityRoutes.use('*', authMiddleware);
accessibilityRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

const manage = requirePermission(['event.manage']);

// Zones
accessibilityRoutes.get('/zones', validateQuery(listQuerySchema), async (c) => {
  const tenant = c.get('tenant')!;
  const query = c.get('validatedQuery') as z.infer<typeof listQuerySchema>;
  return successResponse(c, await svc.listZones(tenant.id, query.eventId), 'Zones loaded');
});
accessibilityRoutes.post('/zones', manage, validateBody(createZoneSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const body = c.get('validatedBody') as z.infer<typeof createZoneSchema>;
  return successResponse(c, await svc.createZone(tenant.id, body), 'Zone created', 201);
});
accessibilityRoutes.patch('/zones/:id', manage, validateParams(idParamsSchema), validateBody(updateZoneSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  const body = c.get('validatedBody') as z.infer<typeof updateZoneSchema>;
  return successResponse(c, await svc.updateZone(tenant.id, id, body), 'Zone updated');
});
accessibilityRoutes.delete('/zones/:id', manage, validateParams(idParamsSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await svc.deleteZone(tenant.id, id), 'Zone deleted');
});

// Requests
accessibilityRoutes.get('/requests', validateQuery(listQuerySchema), async (c) => {
  const tenant = c.get('tenant')!;
  const query = c.get('validatedQuery') as z.infer<typeof listQuerySchema>;
  return successResponse(c, await svc.listRequests(tenant.id, query), 'Requests loaded');
});
accessibilityRoutes.post('/requests', manage, validateBody(createRequestSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const user = c.get('user')!;
  const body = c.get('validatedBody') as z.infer<typeof createRequestSchema>;
  return successResponse(c, await svc.createRequest(tenant.id, user.id, body), 'Request created', 201);
});
accessibilityRoutes.patch('/requests/:id', manage, validateParams(idParamsSchema), validateBody(updateRequestSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  const body = c.get('validatedBody') as z.infer<typeof updateRequestSchema>;
  return successResponse(c, await svc.updateRequest(tenant.id, id, body), 'Request updated');
});
accessibilityRoutes.delete('/requests/:id', manage, validateParams(idParamsSchema), async (c) => {
  const tenant = c.get('tenant')!;
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await svc.deleteRequest(tenant.id, id), 'Request deleted');
});
