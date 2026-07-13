// src/modules/artist/services/followService.ts
import { db } from '../../../db/client.js';
import { artistFollowers } from '../../../db/schema/artist.js';
import { eq, and, count } from 'drizzle-orm';

/** Service handling follow/unfollow logic with idempotency */
export class FollowService {
  /** Follow an artist – inserts a row or does nothing if already exists */
  async follow(tenantId: string, artistId: string, userId: string) {
    await db
      .insert(artistFollowers)
      .values({ tenantId, artistId, userId, createdAt: new Date() })
      .onConflictDoNothing();
  }

  /** Unfollow */
  async unfollow(tenantId: string, artistId: string, userId: string) {
    await db
      .delete(artistFollowers)
      .where(
        and(
          eq(artistFollowers.tenantId, tenantId),
          eq(artistFollowers.artistId, artistId),
          eq(artistFollowers.userId, userId)
        )
      );
  }

  /** Get followers of an artist */
  async getFollowers(tenantId: string, artistId: string, limit = 20, offset = 0) {
    return db
      .select()
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.artistId, artistId)))
      .limit(limit)
      .offset(offset);
  }

  /** Get artists a user follows */
  async getFollowing(tenantId: string, userId: string, limit = 20, offset = 0) {
    return db
      .select()
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.userId, userId)))
      .limit(limit)
      .offset(offset);
  }

  /** Count followers for sorting / trending */
  async countFollowers(tenantId: string, artistId: string) {
    const [{ count: cnt }] = await db
      .select({ count: count() })
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.artistId, artistId)));
    return Number(cnt);
  }
}

export const followService = new FollowService();
