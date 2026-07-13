// src/modules/artist/services/artistService.ts
import { db } from '../../../db/client.js';
import { artists, artistGenres, artistGenreLookup } from '../../../db/schema/artist.js';
import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import { ArtistCreateSchema } from '../validators/artistCreateValidator.js';
import { ArtistUpdateSchema } from '../validators/artistUpdateValidator.js';
import { z } from 'zod';

/** Service handling business logic for Artist domain */
export class ArtistService {
  /** Generate a slug that is unique within a tenant (case‑insensitive). */
  async generateUniqueSlug(tenantId: string, desiredSlug: string): Promise<string> {
    let slug = desiredSlug.toLowerCase();
    let counter = 0;
    while (true) {
      const existing = await db
        .select()
        .from(artists)
        .where(and(eq(artists.tenantId, tenantId), eq(artists.slug, slug)))
        .limit(1);
      if (existing.length === 0) return slug;
      counter += 1;
      slug = `${desiredSlug.toLowerCase()}-${counter}`;
    }
  }

  /** Create a new artist, handling slug uniqueness, genre links and OCC initialization. */
  async create(data: z.infer<typeof ArtistCreateSchema>) {
    const { tenantId, slug, genres, ...rest } = data;
    const uniqueSlug = await this.generateUniqueSlug(tenantId, slug);
    const [artist] = await db
      .insert(artists)
      .values({
        ...rest,
        tenantId,
        slug: uniqueSlug,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    if (genres && genres.length) {
      const existingLookup = await db
        .select()
        .from(artistGenreLookup)
        .where(inArray(artistGenreLookup.name, genres));
      const existingNames = existingLookup.map((g) => g.name);
      const missing = genres.filter((g) => !existingNames.includes(g));
      if (missing.length) {
        const inserts = missing.map((name) => ({ name } as any));
        await db.insert(artistGenreLookup).values(inserts);
      }
      const lookupRows = await db
        .select()
        .from(artistGenreLookup)
        .where(inArray(artistGenreLookup.name, genres));
      const genreLinks = lookupRows.map((g) => ({ artistId: artist.id, genreId: g.id, tenantId }));
      await db.insert(artistGenres).values(genreLinks);
    }
    return artist;
  }

  /** Update an artist with OCC version check. */
  async update(tenantId: string, id: string, payload: Partial<z.infer<typeof ArtistUpdateSchema>>, version: number) {
    const setObj: any = { ...payload, updatedAt: new Date() };
    const [updated] = await db
      .update(artists)
      .set({
        ...setObj,
        version: sql`${artists.version} + 1`
      })
      .where(
        and(eq(artists.id, id), eq(artists.tenantId, tenantId), eq(artists.version, version), isNull(artists.deletedAt))
      )
      .returning();
    return updated;
  }

  /** Soft delete an artist */
  async softDelete(tenantId: string, id: string) {
    const [deleted] = await db
      .update(artists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(artists.id, id), eq(artists.tenantId, tenantId)))
      .returning();
    return deleted;
  }

  /** Find by slug (active only) */
  async findBySlug(tenantId: string, slug: string) {
    const result = await db
      .select()
      .from(artists)
      .where(and(eq(artists.tenantId, tenantId), eq(artists.slug, slug), isNull(artists.deletedAt)))
      .limit(1);
    return result[0] ?? null;
  }
}

export const artistService = new ArtistService();
