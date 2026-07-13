// src/modules/artist/services/recommendationService.ts
import { db } from '../../../db/client.js';
import { artists, artistFollowers, artistGenres } from '../../../db/schema/artist.js';
import { eq, and, notInArray, isNull, inArray } from 'drizzle-orm';

export class RecommendationService {
  async getRecommendations(tenantId: string, userId?: string, limit = 10, offset = 0) {
    if (!userId) {
      return db
        .select()
        .from(artists)
        .where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
        .orderBy(artists.featured)
        .limit(limit)
        .offset(offset);
    }

    const followedArtists = await db
      .select({ artistId: artistFollowers.artistId })
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.userId, userId)));

    const followedIds = followedArtists.map((f) => f.artistId);

    if (followedIds.length === 0) {
      return db
        .select()
        .from(artists)
        .where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
        .orderBy(artists.featured)
        .limit(limit)
        .offset(offset);
    }

    const genresOfFollowed = await db
      .select({ genreId: artistGenres.genreId })
      .from(artistGenres)
      .where(and(eq(artistGenres.tenantId, tenantId), inArray(artistGenres.artistId, followedIds)));

    const genreIds = genresOfFollowed.map((g) => g.genreId);

    if (genreIds.length === 0) {
      const recs = await db
        .select()
        .from(artists)
        .where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt), notInArray(artists.id, followedIds)))
        .orderBy(artists.featured)
        .limit(limit)
        .offset(offset);

      if (recs.length > 0) return recs;
    } else {
      const recs = await db
        .select({
          id: artists.id,
          stageName: artists.stageName,
          slug: artists.slug,
          profileImageUrl: artists.profileImageUrl,
          bio: artists.bio,
          featured: artists.featured,
          verified: artists.verified
        })
        .from(artists)
        .innerJoin(artistGenres, eq(artistGenres.artistId, artists.id))
        .where(
          and(
            eq(artists.tenantId, tenantId),
            isNull(artists.deletedAt),
            notInArray(artists.id, followedIds),
            inArray(artistGenres.genreId, genreIds)
          )
        )
        .limit(limit)
        .offset(offset);

      if (recs.length > 0) return recs;
    }

    // Fallback: return any active artists in the tenant (even if followed)
    return db
      .select()
      .from(artists)
      .where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
      .orderBy(artists.featured)
      .limit(limit)
      .offset(offset);
  }
}

export const recommendationService = new RecommendationService();
