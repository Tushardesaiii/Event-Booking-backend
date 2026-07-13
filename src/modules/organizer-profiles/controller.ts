import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  createOrganizer,
  deleteOrganizerBySlug,
  getEventsForOrganizer,
  getOrganizerAnalytics,
  getOrganizerBySlug,
  getReviewsForOrganizer,
  listOrganizers,
  updateOrganizerBySlug,
  createOrganizerReview,
  updateOrganizerReview,
  deleteOrganizerReview,
  followOrganizer,
  unfollowOrganizer,
  getOrganizerFollowers,
  getUserFollowing,
  likeOrganizer,
  unlikeOrganizer,
  getOrganizerLikes,
  requestOrganizerVerification,
  reviewOrganizerVerification,
  getOrganizerSafetyProfile,
  upsertOrganizerSafetyProfile,
  getOrganizerDashboard,
  getOrganizerActivityFeed,
  getTrendingOrganizers,
  getPopularOrganizers,
  getRecommendedOrganizers,
  searchOrganizers
} from './service.js';
import type {
  CreateOrganizerDTO,
  UpdateOrganizerDTO,
  CreateOrganizerReviewDTO,
  UpdateOrganizerReviewDTO,
  OrganizerListQuery,
  OrganizerSlugParams,
  OrganizerVerificationRequestDTO,
  OrganizerVerificationDecisionDTO,
  OrganizerSafetyProfileDTO
} from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const organizersController = {
  async create(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateOrganizerDTO;
    const organizer = await createOrganizer(tenant.id, membership, user.id, input);

    return successResponse(c, organizer, 'Organizer profile created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const input = c.get('validatedQuery') as OrganizerListQuery;
    const result = await listOrganizers(tenant.id, input);

    return paginatedResponse(c, result.items, result.meta, 'Organizers retrieved');
  },

  async getBySlug(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const organizer = await getOrganizerBySlug(tenant.id, slug);

    return successResponse(c, organizer, 'Organizer retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const input = c.get('validatedBody') as UpdateOrganizerDTO;
    const organizer = await updateOrganizerBySlug(tenant.id, membership, user.id, slug, input);

    return successResponse(c, organizer, 'Organizer updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const organizer = await deleteOrganizerBySlug(tenant.id, membership, user.id, slug, lastKnownUpdatedAt);

    return successResponse(c, organizer, 'Organizer deleted');
  },

  async getEvents(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const query = c.req.query();
    const result = await getEventsForOrganizer(tenant.id, slug, {
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined
    });

    return paginatedResponse(c, result.items, result.meta, 'Organizer events retrieved');
  },

  async getReviews(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const query = c.req.query();
    const result = await getReviewsForOrganizer(tenant.id, slug, {
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined
    });

    return successResponse(c, { reviews: result.items, stats: result.stats }, 'Organizer reviews retrieved');
  },

  async createReview(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const input = c.get('validatedBody') as CreateOrganizerReviewDTO;
    const review = await createOrganizerReview(tenant.id, user.id, slug, input);

    return successResponse(c, review, 'Review submitted successfully', 201);
  },

  async updateReview(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = c.req.param('id') as string;
    const input = c.get('validatedBody') as UpdateOrganizerReviewDTO;
    const review = await updateOrganizerReview(tenant.id, user.id, id, input);

    return successResponse(c, review, 'Review updated successfully');
  },

  async deleteReview(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const id = c.req.param('id') as string;
    await deleteOrganizerReview(tenant.id, membership, user.id, id);

    return successResponse(c, null, 'Review deleted successfully');
  },

  async getAnalytics(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const analytics = await getOrganizerAnalytics(tenant.id, membership, user.id, slug);

    return successResponse(c, analytics, 'Organizer analytics retrieved');
  },

  // ----------------------------------------------------
  // FOLLOW SYSTEM
  // ----------------------------------------------------
  async follow(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const follow = await followOrganizer(tenant.id, user.id, slug);

    return successResponse(c, follow, 'Successfully followed organizer');
  },

  async unfollow(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    await unfollowOrganizer(tenant.id, user.id, slug);

    return successResponse(c, null, 'Successfully unfollowed organizer');
  },

  async getFollowers(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const followers = await getOrganizerFollowers(tenant.id, slug);

    return successResponse(c, followers, 'Organizer followers retrieved');
  },

  async getFollowing(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    
    // If slug is me, return followed organizers for current user. Otherwise return for requested user/profile slug.
    const following = await getUserFollowing(tenant.id, user.id);

    return successResponse(c, following, 'Organizer following retrieved');
  },

  // ----------------------------------------------------
  // LIKE SYSTEM
  // ----------------------------------------------------
  async like(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const like = await likeOrganizer(tenant.id, user.id, slug);

    return successResponse(c, like, 'Successfully liked organizer');
  },

  async unlike(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    await unlikeOrganizer(tenant.id, user.id, slug);

    return successResponse(c, null, 'Successfully unliked organizer');
  },

  async getLikes(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const likes = await getOrganizerLikes(tenant.id, slug);

    return successResponse(c, likes, 'Organizer likes retrieved');
  },

  // ----------------------------------------------------
  // TRUST / VERIFICATION
  // ----------------------------------------------------
  async requestVerification(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const input = c.get('validatedBody') as OrganizerVerificationRequestDTO;
    const request = await requestOrganizerVerification(tenant.id, user.id, slug, input);

    return successResponse(c, request, 'Verification request submitted successfully', 201);
  },

  async submitVerificationDecision(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const input = c.get('validatedBody') as OrganizerVerificationDecisionDTO;
    const decision = await reviewOrganizerVerification(tenant.id, membership, user.id, slug, input);

    return successResponse(c, decision, 'Verification status updated successfully');
  },

  // ----------------------------------------------------
  // SAFETY & SOS
  // ----------------------------------------------------
  async getSafety(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const profile = await getOrganizerSafetyProfile(tenant.id, slug);

    return successResponse(c, profile, 'Safety profile retrieved successfully');
  },

  async upsertSafety(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const input = c.get('validatedBody') as OrganizerSafetyProfileDTO;
    const profile = await upsertOrganizerSafetyProfile(tenant.id, membership, slug, input);

    return successResponse(c, profile, 'Safety profile updated successfully');
  },

  // ----------------------------------------------------
  // DASHBOARD & ACTIVITY
  // ----------------------------------------------------
  async getDashboard(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const dashboard = await getOrganizerDashboard(tenant.id, membership, user.id, slug);

    return successResponse(c, dashboard, 'Organizer dashboard retrieved successfully');
  },

  async getActivity(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as OrganizerSlugParams;
    const { limit, cursor } = c.req.query();
    const result = await getOrganizerActivityFeed(tenant.id, membership, user.id, slug, limit ? Number(limit) : undefined, cursor);

    return successResponse(c, result, 'Organizer activity feed retrieved successfully');
  },

  // ----------------------------------------------------
  // DISCOVERY
  // ----------------------------------------------------
  async getTrending(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { limit } = c.req.query();
    const items = await getTrendingOrganizers(tenant.id, limit ? Number(limit) : undefined);

    return successResponse(c, items, 'Trending organizers retrieved successfully');
  },

  async getPopular(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const { limit } = c.req.query();
    const items = await getPopularOrganizers(tenant.id, limit ? Number(limit) : undefined);

    return successResponse(c, items, 'Popular organizers retrieved successfully');
  },

  async getRecommended(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { limit } = c.req.query();
    const items = await getRecommendedOrganizers(tenant.id, user.id, limit ? Number(limit) : undefined);

    return successResponse(c, items, 'Recommended organizers retrieved successfully');
  },

  async search(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const query = c.req.query();
    const items = await searchOrganizers(tenant.id, {
      search: query.search,
      city: query.city,
      state: query.state,
      country: query.country,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined
    });

    return successResponse(c, items, 'Search completed successfully');
  }
};
