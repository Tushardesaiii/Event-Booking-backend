// src/modules/artist/services/trendingService.ts
import { db } from '../../../db/client.js';
import { artists, artistFollowers } from '../../../db/schema/artist.js';
import { eq, and, count, desc, isNull } from 'drizzle-orm';

export class TrendingService {
  async getTrending(tenantId: string, limit = 10, offset = 0) {
    const sub = db
      .select({ artistId: artistFollowers.artistId, score: count().as('score') })
      .from(artistFollowers)
      .where(eq(artistFollowers.tenantId, tenantId))
      .groupBy(artistFollowers.artistId)
      .as('sub');

    return db
      .select({
        id: artists.id,
        stageName: artists.stageName,
        slug: artists.slug,
        profileImageUrl: artists.profileImageUrl,
        bio: artists.bio,
        featured: artists.featured,
        verified: artists.verified,
        trendingScore: sub.score
      })
      .from(artists)
      .leftJoin(sub, eq(sub.artistId, artists.id))
      .where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
      .orderBy(desc(sub.score))
      .limit(limit)
      .offset(offset);
  }
}

export const trendingService = new TrendingService();
