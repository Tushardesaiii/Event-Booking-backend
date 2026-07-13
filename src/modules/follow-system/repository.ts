import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { userFollows, organizerFollows, artistFollows } from './schema.js';
import { users } from '../../db/schema/users.js';
import type { UserFollowRecord, OrganizerFollowRecord, ArtistFollowRecord } from './types.js';

type DBInstance = typeof db | any;

export async function followUser(
  database: DBInstance,
  tenantId: string,
  followerUserId: string,
  followingUserId: string
) {
  const [follow] = await database
    .insert(userFollows)
    .values({
      tenantId,
      followerUserId,
      followingUserId
    })
    .onConflictDoNothing()
    .returning();

  return follow ?? null;
}

export async function unfollowUser(
  database: DBInstance,
  tenantId: string,
  followerUserId: string,
  followingUserId: string
) {
  const [follow] = await database
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.tenantId, tenantId),
        eq(userFollows.followerUserId, followerUserId),
        eq(userFollows.followingUserId, followingUserId)
      )
    )
    .returning();

  return follow ?? null;
}

export async function followOrganizer(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const [follow] = await database
    .insert(organizerFollows)
    .values({
      tenantId,
      userId,
      organizerId
    })
    .onConflictDoNothing()
    .returning();

  return follow ?? null;
}

export async function unfollowOrganizer(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const [follow] = await database
    .delete(organizerFollows)
    .where(
      and(
        eq(organizerFollows.tenantId, tenantId),
        eq(organizerFollows.userId, userId),
        eq(organizerFollows.organizerId, organizerId)
      )
    )
    .returning();

  return follow ?? null;
}

export async function followArtist(
  database: DBInstance,
  tenantId: string,
  userId: string,
  artistId: string
) {
  const [follow] = await database
    .insert(artistFollows)
    .values({
      tenantId,
      userId,
      artistId
    })
    .onConflictDoNothing()
    .returning();

  return follow ?? null;
}

export async function unfollowArtist(
  database: DBInstance,
  tenantId: string,
  userId: string,
  artistId: string
) {
  const [follow] = await database
    .delete(artistFollows)
    .where(
      and(
        eq(artistFollows.tenantId, tenantId),
        eq(artistFollows.userId, userId),
        eq(artistFollows.artistId, artistId)
      )
    )
    .returning();

  return follow ?? null;
}

export async function getUserFollowers(
  database: DBInstance,
  tenantId: string,
  userId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(userFollows.tenantId, tenantId), eq(userFollows.followingUserId, userId)];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(userFollows)
    .where(whereClause);

  const rows = await database
    .select({
      id: userFollows.id,
      followerUserId: userFollows.followerUserId,
      createdAt: userFollows.createdAt,
      follower: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarAssetId: users.avatarAssetId
      }
    })
    .from(userFollows)
    .innerJoin(users, eq(userFollows.followerUserId, users.id))
    .where(whereClause)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getUserFollowing(
  database: DBInstance,
  tenantId: string,
  userId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(userFollows.tenantId, tenantId), eq(userFollows.followerUserId, userId)];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(userFollows)
    .where(whereClause);

  const rows = await database
    .select({
      id: userFollows.id,
      followingUserId: userFollows.followingUserId,
      createdAt: userFollows.createdAt,
      following: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarAssetId: users.avatarAssetId
      }
    })
    .from(userFollows)
    .innerJoin(users, eq(userFollows.followingUserId, users.id))
    .where(whereClause)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}
