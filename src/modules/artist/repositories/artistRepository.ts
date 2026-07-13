// src/modules/artist/repositories/artistRepository.ts
import { db } from '../../../db/client.js';
import { artists, artistGenres, artistGenreLookup } from '../../../db/schema/artist.js';
import { eq, and, asc, desc, sql, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

// Zod schema for artist creation/update (reused from validators later)
export const ArtistCreateSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string().min(1).max(255),
  stageName: z.string().min(1).max(255),
  realName: z.string().max(255).optional(),
  bio: z.string().optional(),
  shortBio: z.string().optional(),
  profileImageUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  city: z.string().max(255).optional(),
  state: z.string().max(255).optional(),
  country: z.string().max(255).optional(),
  languages: z.array(z.string()).optional(),
  instagramUrl: z.string().url().optional(),
  youtubeUrl: z.string().url().optional(),
  spotifyUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  bookingEmail: z.string().email().optional(),
  managementContact: z.string().max(255).optional(),
  verified: z.boolean().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  genres: z.array(z.string()).optional()
});

export class ArtistRepository {
  /** Create a new artist. Handles slug uniqueness within tenant and OCC version init. */
  async create(data: z.infer<typeof ArtistCreateSchema>) {
    const { tenantId, slug, genres, ...rest } = data;
    // Insert artist row
    const [artist] = await db
      .insert(artists)
      .values({ ...rest, tenantId, slug })
      .returning();

    // Insert genre links if provided
    if (genres && genres.length) {
      const genreRows = await db
        .select()
        .from(artistGenreLookup)
        .where(inArray(artistGenreLookup.name, genres));
      const inserts = genreRows.map((g) => ({ artistId: artist.id, genreId: g.id, tenantId }));
      await db.insert(artistGenres).values(inserts);
    }
    return artist;
  }

  /** Find artist by slug within a tenant */
  async findBySlug(tenantId: string, slug: string) {
    return db
      .select()
      .from(artists)
      .where(and(eq(artists.tenantId, tenantId), eq(artists.slug, slug), isNull(artists.deletedAt)))
      .limit(1);
  }

  /** Update artist with optimistic concurrency (version check) */
  async update(tenantId: string, id: string, payload: Partial<z.infer<typeof ArtistCreateSchema>>, version: number) {
    const result = await db
      .update(artists)
      .set({ ...payload, version: sql`${artists.version} + 1` })
      .where(
        and(eq(artists.id, id), eq(artists.tenantId, tenantId), eq(artists.version, version), isNull(artists.deletedAt))
      )
      .returning();
    return result[0];
  }

  /** Soft delete artist */
  async softDelete(tenantId: string, id: string) {
    return db
      .update(artists)
      .set({ deletedAt: new Date() })
      .where(and(eq(artists.id, id), eq(artists.tenantId, tenantId)))
      .returning();
  }

  /** List artists with optional filters (search, genre, city, featured, verified, trending, etc.) */
  async list(params: {
    tenantId: string;
    search?: string;
    genre?: string;
    city?: string;
    featured?: boolean;
    verified?: boolean;
    limit?: number;
    offset?: number;
    orderBy?: keyof typeof artists;
    orderDesc?: boolean;
  }) {
    const { tenantId, search, genre, city, featured, verified, limit = 20, offset = 0, orderBy = 'createdAt', orderDesc = true } = params;
    
    const conditions = [
      eq(artists.tenantId, tenantId),
      isNull(artists.deletedAt)
    ];

    if (search) {
      conditions.push(sql`(stage_name ILIKE ${`%${search}%`} OR short_bio ILIKE ${`%${search}%`})`);
    }
    if (city) {
      conditions.push(eq(artists.city, city));
    }
    if (featured !== undefined) {
      conditions.push(eq(artists.featured, featured));
    }
    if (verified !== undefined) {
      conditions.push(eq(artists.verified, verified));
    }

    let query: any = db.select().from(artists);
    
    if (genre) {
      query = query
        .innerJoin(artistGenres, eq(artistGenres.artistId, artists.id))
        .innerJoin(artistGenreLookup, eq(artistGenreLookup.id, artistGenres.genreId));
      conditions.push(eq(artistGenreLookup.name, genre));
    }

    const orderCol = (artists as any)[orderBy] || artists.createdAt;
    const orderExpr = orderDesc ? desc(orderCol) : asc(orderCol);
    return query.where(and(...conditions)).orderBy(orderExpr).limit(limit).offset(offset);
  }
}

export const artistRepository = new ArtistRepository();
