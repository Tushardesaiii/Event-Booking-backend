import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  addEventToWishlist,
  getTrendingEvents,
  getUserWishlist,
  removeEventFromWishlist
} from './service.js';
import type { WishlistEventParams, WishlistListQuery } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const wishlistsController = {
  async add(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { eventId } = c.get('validatedParams') as WishlistEventParams;
    const wish = await addEventToWishlist(tenant.id, user.id, eventId);

    return successResponse(c, wish, 'Event added to wishlist', 201);
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { eventId } = c.get('validatedParams') as WishlistEventParams;
    const wish = await removeEventFromWishlist(tenant.id, user.id, eventId);

    return successResponse(c, wish, 'Event removed from wishlist');
  },

  async list(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const query = c.req.query();
    const limit = query.limit ? Number(query.limit) : 10;
    const trending = await getTrendingEvents(tenant.id, limit);

    return successResponse(c, trending, 'Trending saved events retrieved');
  },

  async getMyWishlist(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const query = c.get('validatedQuery') as WishlistListQuery;
    const result = await getUserWishlist(tenant.id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'User wishlist retrieved');
  }
};
