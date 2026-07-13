import { db } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { users } from '../../db/schema/users.js';
import { organizers } from '../organizer-profiles/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  followUser,
  unfollowUser,
  followOrganizer,
  unfollowOrganizer,
  followArtist,
  unfollowArtist,
  getUserFollowers,
  getUserFollowing
} from './repository.js';
import type { FollowQuery } from './types.js';

async function assertUserExists(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw notFound('User not found');
  }
  return user;
}

export async function followUserByUserId(
  tenantId: string,
  followerUserId: string,
  followingUserId: string
) {
  if (followerUserId === followingUserId) {
    throw badRequest('You cannot follow yourself');
  }

  await assertUserExists(followingUserId);

  const follow = await followUser(db, tenantId, followerUserId, followingUserId);
  return follow;
}

export async function unfollowUserByUserId(
  tenantId: string,
  followerUserId: string,
  followingUserId: string
) {
  const follow = await unfollowUser(db, tenantId, followerUserId, followingUserId);
  return follow;
}

export async function followOrganizerByOrganizerId(
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const [org] = await db
    .select()
    .from(organizers)
    .where(and(eq(organizers.tenantId, tenantId), eq(organizers.id, organizerId)))
    .limit(1);

  if (!org) {
    throw notFound('Organizer not found');
  }

  const follow = await followOrganizer(db, tenantId, userId, organizerId);
  return follow;
}

export async function unfollowOrganizerByOrganizerId(
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const follow = await unfollowOrganizer(db, tenantId, userId, organizerId);
  return follow;
}

export async function followArtistByArtistId(
  tenantId: string,
  userId: string,
  artistId: string
) {
  if (userId === artistId) {
    throw badRequest('You cannot follow yourself as an artist');
  }

  await assertUserExists(artistId);

  const follow = await followArtist(db, tenantId, userId, artistId);
  return follow;
}

export async function unfollowArtistByArtistId(
  tenantId: string,
  userId: string,
  artistId: string
) {
  const follow = await unfollowArtist(db, tenantId, userId, artistId);
  return follow;
}

export async function listUserFollowers(
  tenantId: string,
  userId: string,
  query: FollowQuery
) {
  await assertUserExists(userId);
  const pagination = parsePagination(query);
  const { rows, total } = await getUserFollowers(db, tenantId, userId, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function listUserFollowing(
  tenantId: string,
  userId: string,
  query: FollowQuery
) {
  await assertUserExists(userId);
  const pagination = parsePagination(query);
  const { rows, total } = await getUserFollowing(db, tenantId, userId, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}
