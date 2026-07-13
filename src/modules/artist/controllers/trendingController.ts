// src/modules/artist/controllers/trendingController.ts
import type { Context } from 'hono';
import { TrendingQuerySchema } from '../validators/trendingValidator.js';
import { trendingService } from '../services/trendingService.js';

export const getTrendingArtists = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const query = c.req.query();
  const payload = TrendingQuerySchema.parse({ tenantId, ...query });

  const results = await trendingService.getTrending(tenantId, payload.limit, payload.offset);
  return c.json(results);
};
