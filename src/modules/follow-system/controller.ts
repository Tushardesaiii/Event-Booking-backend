import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  followArtistByArtistId,
  followOrganizerByOrganizerId,
  followUserByUserId,
  listUserFollowers,
  listUserFollowing,
  unfollowArtistByArtistId,
  unfollowOrganizerByOrganizerId,
  unfollowUserByUserId
} from './service.js';
import type { FollowParams, FollowQuery } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const user = c.get('user');

  if (!tenant || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, user };
}

export const followsController = {
  async followUser(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await followUserByUserId(tenant.id, user.id, id);

    return successResponse(c, follow, 'User followed successfully', 201);
  },

  async unfollowUser(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await unfollowUserByUserId(tenant.id, user.id, id);

    return successResponse(c, follow, 'User unfollowed successfully');
  },

  async followOrganizer(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await followOrganizerByOrganizerId(tenant.id, user.id, id);

    return successResponse(c, follow, 'Organizer followed successfully', 201);
  },

  async unfollowOrganizer(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await unfollowOrganizerByOrganizerId(tenant.id, user.id, id);

    return successResponse(c, follow, 'Organizer unfollowed successfully');
  },

  async followArtist(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await followArtistByArtistId(tenant.id, user.id, id);

    return successResponse(c, follow, 'Artist followed successfully', 201);
  },

  async unfollowArtist(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const follow = await unfollowArtistByArtistId(tenant.id, user.id, id);

    return successResponse(c, follow, 'Artist unfollowed successfully');
  },

  async getFollowers(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const query = c.get('validatedQuery') as FollowQuery;
    const result = await listUserFollowers(tenant.id, id, query);

    return paginatedResponse(c, result.items, result.meta, 'Followers retrieved');
  },

  async getFollowing(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { id } = c.get('validatedParams') as FollowParams;
    const query = c.get('validatedQuery') as FollowQuery;
    const result = await listUserFollowing(tenant.id, id, query);

    return paginatedResponse(c, result.items, result.meta, 'Following retrieved');
  }
};
