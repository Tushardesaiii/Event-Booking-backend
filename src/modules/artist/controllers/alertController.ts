// src/modules/artist/controllers/alertController.ts
import type { Context } from 'hono';
import { AlertCreateSchema } from '../validators/alertValidator.js';
import { alertService } from '../services/alertService.js';
import { artistService } from '../services/artistService.js';

export const createOrUpdateAlert = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({}));
  const payload = AlertCreateSchema.parse({ tenantId, artistSlug: slug, ...body });

  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const user = c.get('user');
  const userId = user?.id as string;
  const alert = await alertService.createOrUpdateAlert(tenantId, artist.id, userId, {
    radiusKm: payload.radiusKm,
    enabled: payload.enabled
  });
  return c.json(alert, 201);
};

export const deleteAlert = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const user = c.get('user');
  const userId = user?.id as string;
  await alertService.deleteAlert(tenantId, artist.id, userId);
  return c.json({ success: true }, 200);
};

export const listAlertsForUser = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const user = c.get('user');
  const userId = user?.id as string;

  const alerts = await alertService.listAlertsForUser(tenantId, userId);
  return c.json(alerts);
};
