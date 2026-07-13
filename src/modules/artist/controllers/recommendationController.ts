// src/modules/artist/controllers/recommendationController.ts
import type { Context } from 'hono';
import { RecommendationQuerySchema } from '../validators/recommendationValidator.js';
import { recommendationService } from '../services/recommendationService.js';

export const getRecommendedArtists = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const user = c.get('user');
  const userId = user?.id as string;
  const query = c.req.query();
  const payload = RecommendationQuerySchema.parse({ tenantId, ...query });

  const results = await recommendationService.getRecommendations(tenantId, userId, payload.limit, payload.offset);
  return c.json(results);
};
