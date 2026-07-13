// src/modules/artist/services/storyService.ts
import { db } from '../../../db/client.js';
import { artistStories, artistStoryViews, artistStoryReactions } from '../../../db/schema/artist.js';
import { eq, and, sql, gt } from 'drizzle-orm';

export class StoryService {
  /** Create a new story for an artist. Expires in 24h */
  async createStory(tenantId: string, artistId: string, payload: { mediaUrl: string; caption?: string; type: 'image' | 'video' }) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [story] = await db
      .insert(artistStories)
      .values({
        tenantId,
        artistId,
        mediaUrl: payload.mediaUrl,
        caption: payload.caption,
        type: payload.type,
        expiresAt,
        createdAt: new Date()
      })
      .returning();
    return story;
  }

  /** Get active stories for an artist */
  async getStories(tenantId: string, artistId: string) {
    const now = new Date();
    return db
      .select()
      .from(artistStories)
      .where(and(eq(artistStories.tenantId, tenantId), eq(artistStories.artistId, artistId), gt(artistStories.expiresAt, now)));
  }

  /** Delete a story */
  async deleteStory(tenantId: string, storyId: string) {
    await db.delete(artistStories).where(and(eq(artistStories.tenantId, tenantId), eq(artistStories.id, storyId)));
  }

  /** Global feed (stories from all artists, respecting expiration) */
  async getFeed(tenantId: string, limit = 20, offset = 0) {
    const now = new Date();
    return db
      .select()
      .from(artistStories)
      .where(and(eq(artistStories.tenantId, tenantId), gt(artistStories.expiresAt, now)))
      .orderBy(sql`created_at DESC`)
      .limit(limit)
      .offset(offset);
  }

  /** Record a view on a story */
  async recordView(tenantId: string, storyId: string, viewerUserId: string) {
    await db
      .insert(artistStoryViews)
      .values({
        tenantId,
        storyId,
        viewerUserId,
        createdAt: new Date()
      });
  }

  /** Record a reaction on a story */
  async recordReaction(tenantId: string, storyId: string, userId: string, reactionType: string) {
    await db
      .insert(artistStoryReactions)
      .values({
        tenantId,
        storyId,
        userId,
        reactionType,
        createdAt: new Date()
      });
  }
}

export const storyService = new StoryService();
