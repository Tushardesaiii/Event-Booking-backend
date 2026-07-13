import { db } from '../../db/client.js';
import { forbidden, notFound, badRequest, conflict } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import {
  createStoryRecord,
  deleteStoryRecord,
  findStoryById,
  listActiveStories,
  createStoryViewRecord,
  getStoryViewsCount,
  createStoryReactionRecord,
  getStoryReactions,
  createStoryReplyRecord,
  getStoryReplies,
  cleanupExpiredStories
} from './repository.js';
import type {
  CreateStoryDTO,
  StoryReplyDTO,
  StoryReactionDTO,
  StoryListQuery,
  StoryItem
} from './types.js';
import { createInAppNotification } from '../notifications/service.js';
import { users } from '../../db/schema/users.js';
import { and, eq, inArray, sql, isNull } from 'drizzle-orm';
import { storyViews, storyReactions, storyReplies } from './schema.js';

export async function postStory(
  tenantId: string,
  createdByUserId: string,
  input: CreateStoryDTO
) {
  // Story expires in exactly 24 hours
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const story = await createStoryRecord(db, {
    ...input,
    tenantId,
    createdByUserId,
    expiresAt
  });

  return story;
}

export async function getStories(
  tenantId: string,
  query: StoryListQuery
) {
  const pagination = parsePagination(query);
  const { rows, total } = await listActiveStories(db, tenantId, query, pagination);

  const storyIds = rows.map((r: any) => r.id);

  // Batch query views counts
  const viewsCounts = storyIds.length > 0 ? await db
    .select({
      storyId: storyViews.storyId,
      count: sql<number>`count(*)::int`
    })
    .from(storyViews)
    .where(inArray(storyViews.storyId, storyIds))
    .groupBy(storyViews.storyId) : [];

  const viewsCountMap = new Map(viewsCounts.map((v) => [v.storyId, v.count]));

  // Batch query reactions
  const reactions = storyIds.length > 0 ? await db
    .select()
    .from(storyReactions)
    .where(inArray(storyReactions.storyId, storyIds)) : [];

  const reactionsMap = new Map<string, any[]>();
  for (const r of reactions) {
    const arr = reactionsMap.get(r.storyId) || [];
    arr.push(r);
    reactionsMap.set(r.storyId, arr);
  }

  // Batch query replies
  const replies = storyIds.length > 0 ? await db
    .select()
    .from(storyReplies)
    .where(and(inArray(storyReplies.storyId, storyIds), isNull(storyReplies.deletedAt))) : [];

  const repliesMap = new Map<string, any[]>();
  for (const r of replies) {
    const arr = repliesMap.get(r.storyId) || [];
    arr.push(r);
    repliesMap.set(r.storyId, arr);
  }

  const items = rows.map((row: any) => ({
    ...row,
    viewsCount: viewsCountMap.get(row.id) || 0,
    reactions: reactionsMap.get(row.id) || [],
    replies: repliesMap.get(row.id) || []
  }));

  return {
    items: items as StoryItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getStoryDetails(
  tenantId: string,
  id: string,
  userId: string
): Promise<StoryItem> {
  const story = await findStoryById(db, tenantId, id);
  if (!story) {
    throw notFound('Story not found');
  }

  // Fetch creator info
  const [creator] = await db
    .select({
      username: users.username,
      fullName: users.fullName,
      avatarAssetId: users.avatarAssetId
    })
    .from(users)
    .where(eq(users.id, story.createdByUserId ?? ''))
    .limit(1);

  const viewsCount = await getStoryViewsCount(db, story.id);
  const reactions = await getStoryReactions(db, story.id);
  const replies = await getStoryReplies(db, story.id);

  return {
    ...story,
    creator: creator ?? { username: 'unknown', fullName: 'Unknown User', avatarAssetId: null },
    viewsCount,
    reactions,
    replies
  };
}

export async function viewStory(
  tenantId: string,
  id: string,
  viewerUserId: string
) {
  const story = await findStoryById(db, tenantId, id);
  if (!story) {
    throw notFound('Story not found');
  }

  const view = await createStoryViewRecord(db, id, viewerUserId);
  return view;
}

export async function reactToStory(
  tenantId: string,
  id: string,
  userId: string,
  input: StoryReactionDTO
) {
  const story = await findStoryById(db, tenantId, id);
  if (!story) {
    throw notFound('Story not found');
  }

  const reaction = await createStoryReactionRecord(db, id, userId, input.reactionType);
  return reaction;
}

export async function replyToStory(
  tenantId: string,
  id: string,
  senderUserId: string,
  input: StoryReplyDTO
) {
  const story = await findStoryById(db, tenantId, id);
  if (!story) {
    throw notFound('Story not found');
  }

  return db.transaction(async (tx) => {
    const reply = await createStoryReplyRecord(tx, id, senderUserId, input.message);
    if (!reply) {
      throw conflict('Unable to send story reply');
    }

    // Fetch sender info for notification message
    const [sender] = await tx
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, senderUserId))
      .limit(1);

    // Auto-generate notification: story reply received (if sender is not story owner)
    if (story.createdByUserId && story.createdByUserId !== senderUserId) {
      await createInAppNotification({
        tenantId,
        userId: story.createdByUserId,
        title: 'New Story Reply',
        message: `${sender?.username ?? 'Someone'} replied to your story: "${input.message}"`,
        type: 'story_reply_received',
        entityType: 'story',
        entityId: story.id,
        metadata: { replyId: reply.id, message: input.message }
      });
    }

    return reply;
  });
}

export async function deleteStory(
  tenantId: string,
  id: string,
  actorUserId: string
) {
  const story = await findStoryById(db, tenantId, id);
  if (!story) {
    throw notFound('Story not found');
  }

  if (story.createdByUserId !== actorUserId) {
    throw forbidden('You can only delete your own stories');
  }

  const deleted = await deleteStoryRecord(db, tenantId, id);
  return deleted;
}

export async function runStoriesCleanup() {
  const cleaned = await cleanupExpiredStories(db);
  return {
    cleanedCount: cleaned.length,
    cleanedIds: cleaned.map((c: any) => c.id)
  };
}
