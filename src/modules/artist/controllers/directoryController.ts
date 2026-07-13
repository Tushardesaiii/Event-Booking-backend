// Organizer-facing directory endpoints (mounted under /artists, behind auth +
// tenant). Organizers SEARCH the global catalogue while building an event and,
// if an artist isn't there yet, CONTRIBUTE a new one — which then becomes
// available to every other organizer and the consumer app.

import type { Context } from 'hono';

import { successResponse } from '../../../lib/response.js';
import { unauthorized } from '../../../lib/errors.js';
import type { AppEnv } from '../../../types/context.js';
import {
  directoryArtistCreateSchema,
  directorySearchSchema,
} from '../validators/directoryValidator.js';
import {
  createDirectoryArtist,
  searchDirectory,
} from '../services/directoryService.js';

export const searchArtistDirectory = async (c: Context<AppEnv>) => {
  const { q, limit } = directorySearchSchema.parse(c.req.query());
  const results = await searchDirectory({ q, limit });
  return successResponse(c, results, 'Artist directory results');
};

export const contributeArtist = async (c: Context<AppEnv>) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  if (!user) throw unauthorized('Authentication required');
  const input = directoryArtistCreateSchema.parse(await c.req.json());
  const artist = await createDirectoryArtist(input, {
    tenantId: tenant?.id ?? null,
    createdByUserId: user.id,
    source: 'organizer',
  });
  return successResponse(c, artist, 'Artist added to directory', 201);
};
