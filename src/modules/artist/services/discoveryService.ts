// src/modules/artist/services/discoveryService.ts
import { db } from '../../../db/client.js';
import { artists, artistGenres, artistGenreLookup, artistFollowers } from '../../../db/schema/artist.js';
import { eq, and, sql, count, asc, desc, isNull } from 'drizzle-orm';

/** Service to discover artists with filters and pagination */
export class DiscoveryService {
  async discover(params: {
    tenantId: string;
    search?: string;
    city?: string;
    genre?: string;
    verified?: boolean;
    featured?: boolean;
    trending?: boolean;
    popular?: boolean;
    new?: boolean;
    sortBy?: 'createdAt' | 'followersCount' | 'trendingScore' | 'popularity';
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) {
    const {
      tenantId,
      search,
      city,
      genre,
      verified,
      featured,
      limit = 20,
      offset = 0,
      sortBy = 'createdAt',
      order = 'desc'
    } = params;

    let base = db.select().from(artists).where(and(eq(artists.tenantId, tenantId), isNull(artists.deletedAt))) as any;

    if (search) {
      const pattern = `%${search}%`;
      base = base.where(sql`(stage_name ILIKE ${pattern} OR short_bio ILIKE ${pattern})`);
    }
    if (city) base = base.where(eq(artists.city, city));
    if (verified !== undefined) base = base.where(eq(artists.verified, verified));
    if (featured !== undefined) base = base.where(eq(artists.featured, featured));
    if (genre) {
      base = base
        .innerJoin(artistGenres, eq(artistGenres.artistId, artists.id))
        .innerJoin(artistGenreLookup, eq(artistGenreLookup.id, artistGenres.genreId))
        .where(eq(artistGenreLookup.name, genre));
    }

    if (sortBy === 'followersCount') {
      const sub = db
        .select({ artistId: artistFollowers.artistId, cnt: count() })
        .from(artistFollowers)
        .where(eq(artistFollowers.tenantId, tenantId))
        .groupBy(artistFollowers.artistId)
        .as('sub');
      base = base.leftJoin(sub, eq(sub.artistId, artists.id));
      const orderFn = order === 'desc' ? desc(sub.cnt) : asc(sub.cnt);
      base = base.orderBy(orderFn);
    } else if (sortBy === 'createdAt') {
      const orderFn = order === 'desc' ? desc(artists.createdAt) : asc(artists.createdAt);
      base = base.orderBy(orderFn);
    }

    return base.limit(limit).offset(offset);
  }
}

export const discoveryService = new DiscoveryService();
