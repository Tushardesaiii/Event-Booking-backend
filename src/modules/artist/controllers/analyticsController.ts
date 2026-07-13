// src/modules/artist/controllers/analyticsController.ts
import type { Context } from 'hono';
import { analyticsService } from '../services/analyticsService.js';
import { artistService } from '../services/artistService.js';

export const getArtistDashboard = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const dashboard = await analyticsService.getArtistDashboard(tenantId, artist.id);
  return c.json(dashboard);
};
