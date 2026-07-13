import { Hono } from 'hono';

import { paginatedResponse, successResponse } from '../../lib/response.js';
import { validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { searchRateLimit } from '../../middlewares/rate-limit.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { listPublicArtists, getPublicArtist } from '../artist/services/directoryService.js';
import { getPlatformSettings } from '../platform-admin/settings.service.js';
import { EVENT_CATEGORIES } from '../../constants/categories.js';
import { publicArtistListSchema } from '../artist/validators/directoryValidator.js';
import type { z } from 'zod';
import {
  getPublicEventService,
  getPublicOrganizerService,
  listPublicEventsService,
  listPublicOrganizersService,
  listTrendingEventsService,
} from './service.js';
import {
  publicEventListQuerySchema,
  publicEventParamsSchema,
  publicOrganizerParamsSchema,
  publicTrendingQuerySchema,
  type PublicEventListQuery,
  type PublicEventParams,
  type PublicOrganizerParams,
  type PublicTrendingQuery,
} from './validation.js';

// Public consumer discovery surface. No authentication and no tenant context:
// returns only published + public events across every tenant.
export const publicRoutes = new Hono<AppEnv>();

// App runtime config — the convenience fee the checkout must show so the
// displayed total matches the amount the backend actually charges.
publicRoutes.get('/config', async (c) => {
  const settings = await getPlatformSettings();
  return successResponse(
    c,
    { convenienceFeeBps: settings.convenienceFeeBps, convenienceFeePercent: settings.convenienceFeePercent },
    'Config retrieved',
  );
});

// Canonical category/interest taxonomy — the single list the mobile app's
// Interest DNA picker and the organizer dashboard's event-category picker
// both draw from, so a category chosen while creating an event always
// matches an interest a consumer can select. No auth/tenant needed: it's
// platform-wide, not per-tenant.
publicRoutes.get('/categories', async (c) => {
  const categories = EVENT_CATEGORIES.map(({ id, label }) => ({ id, label }));
  return successResponse(c, categories, 'Categories retrieved');
});

publicRoutes.get('/events', searchRateLimit, validateQuery(publicEventListQuerySchema), async (c) => {
  const input = c.get('validatedQuery') as PublicEventListQuery;
  const result = await listPublicEventsService(input);
  return paginatedResponse(c, result.items, result.meta, 'Events retrieved');
});

// Registered before '/events/:idOrSlug' so the static segment wins the match.
publicRoutes.get('/events/trending', searchRateLimit, validateQuery(publicTrendingQuerySchema), async (c) => {
  const input = c.get('validatedQuery') as PublicTrendingQuery;
  const items = await listTrendingEventsService(input);
  return successResponse(c, items, 'Trending events retrieved');
});

publicRoutes.get('/events/:idOrSlug', validateParams(publicEventParamsSchema), async (c) => {
  const { idOrSlug } = c.get('validatedParams') as PublicEventParams;
  const event = await getPublicEventService(idOrSlug);
  return successResponse(c, event, 'Event retrieved');
});

publicRoutes.get('/organizers', searchRateLimit, async (c) => {
  const organizers = await listPublicOrganizersService(24);
  return successResponse(c, organizers, 'Organizers retrieved');
});

publicRoutes.get('/organizers/:idOrSlug', searchRateLimit, validateParams(publicOrganizerParamsSchema), async (c) => {
  const { idOrSlug } = c.get('validatedParams') as PublicOrganizerParams;
  const organizer = await getPublicOrganizerService(idOrSlug);
  return successResponse(c, organizer, 'Organizer retrieved');
});

// Artists — platform-global directory for the app's Artists rail + artist screen.
publicRoutes.get('/artists', searchRateLimit, validateQuery(publicArtistListSchema), async (c) => {
  const { limit } = c.get('validatedQuery') as z.infer<typeof publicArtistListSchema>;
  const items = await listPublicArtists(limit ?? 24);
  return successResponse(c, items, 'Artists retrieved');
});

publicRoutes.get('/artists/:idOrSlug', searchRateLimit, async (c) => {
  const artist = await getPublicArtist(c.req.param('idOrSlug'));
  return successResponse(c, artist, 'Artist retrieved');
});
