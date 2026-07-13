// src/modules/artist/controllers/discoveryController.ts
import type { Context } from 'hono';
import { ArtistDiscoveryQuerySchema } from '../validators/discoveryValidator.js';
import { discoveryService } from '../services/discoveryService.js';

export const discoverArtists = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id;
  const query = c.req.query();
  const payload = ArtistDiscoveryQuerySchema.parse({ tenantId, ...query });

  const results = await discoveryService.discover(payload);
  return c.json(results);
};
