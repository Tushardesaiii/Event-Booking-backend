import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { stories, storyViews, storyReactions, storyReplies } from './schema.js';
import { users } from '../../db/schema/users.js';
import type {
  CreateStoryDTO,
  StoryRecord,
  StoryViewRecord,
  StoryReactionRecord,
  StoryReplyRecord,
  StoryListQuery
} from './types.js';

type DBInstance = typeof db | any;

export async function findStoryById(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [story] = await database
    .select()
    .from(stories)
    .where(and(eq(stories.tenantId, tenantId), eq(stories.id, id), isNull(stories.deletedAt)))
    .limit(1);

  return story ?? null;
}

export async function createStoryRecord(
  database: DBInstance,
  input: CreateStoryDTO & { tenantId: string; createdByUserId: string; expiresAt: Date }
) {
  const [story] = await database
    .insert(stories)
    .values({
      tenantId: input.tenantId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType ?? 'image',
      caption: input.caption ?? null,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId
    })
    .returning();

  return story ?? null;
}

export async function deleteStoryRecord(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [story] = await database
    .update(stories)
    .set({
      deletedAt: new Date()
    })
    .where(and(eq(stories.tenantId, tenantId), eq(stories.id, id), isNull(stories.deletedAt)))
    .returning();

  return story ?? null;
}

export async function listActiveStories(
  database: DBInstance,
  tenantId: string,
  query: StoryListQuery,
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(stories.tenantId, tenantId),
    isNull(stories.deletedAt),
    gt(stories.expiresAt, new Date())
  ];

  if (query.ownerType) {
    conditions.push(eq(stories.ownerType, query.ownerType));
  }

  if (query.ownerId) {
    conditions.push(eq(stories.ownerId, query.ownerId));
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(stories)
    .where(whereClause);

  const rows = await database
    .select({
      id: stories.id,
      tenantId: stories.tenantId,
      ownerType: stories.ownerType,
      ownerId: stories.ownerId,
      mediaUrl: stories.mediaUrl,
      mediaType: stories.mediaType,
      caption: stories.caption,
      expiresAt: stories.expiresAt,
      createdByUserId: stories.createdByUserId,
      createdAt: stories.createdAt,
      updatedAt: stories.updatedAt,
      creator: {
        username: users.username,
        fullName: users.fullName,
        avatarAssetId: users.avatarAssetId
      }
    })
    .from(stories)
    .leftJoin(users, eq(stories.createdByUserId, users.id))
    .where(whereClause)
    .orderBy(desc(stories.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function createStoryViewRecord(
  database: DBInstance,
  storyId: string,
  viewerUserId: string
) {
  const [view] = await database
    .insert(storyViews)
    .values({
      storyId,
      viewerUserId
    })
    .onConflictDoNothing()
    .returning();

  return view ?? null;
}

export async function getStoryViewsCount(
  database: DBInstance,
  storyId: string
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(storyViews)
    .where(eq(storyViews.storyId, storyId));

  return Number(row?.count ?? 0);
}

export async function createStoryReactionRecord(
  database: DBInstance,
  storyId: string,
  userId: string,
  reactionType: string
) {
  const [reaction] = await database
    .insert(storyReactions)
    .values({
      storyId,
      userId,
      reactionType
    })
    .onConflictDoNothing()
    .returning();

  return reaction ?? null;
}

export async function getStoryReactions(
  database: DBInstance,
  storyId: string
) {
  return database
    .select()
    .from(storyReactions)
    .where(eq(storyReactions.storyId, storyId));
}

export async function createStoryReplyRecord(
  database: DBInstance,
  storyId: string,
  senderUserId: string,
  message: string
) {
  const [reply] = await database
    .insert(storyReplies)
    .values({
      storyId,
      senderUserId,
      message
    })
    .returning();

  return reply ?? null;
}

export async function getStoryReplies(
  database: DBInstance,
  storyId: string
) {
  return database
    .select()
    .from(storyReplies)
    .where(and(eq(storyReplies.storyId, storyId), isNull(storyReplies.deletedAt)));
}

export async function cleanupExpiredStories(
  database: DBInstance
) {
  const rows = await database
    .update(stories)
    .set({
      deletedAt: new Date()
    })
    .where(and(lte(stories.expiresAt, new Date()), isNull(stories.deletedAt)))
    .returning({ id: stories.id });

  return rows;
}
