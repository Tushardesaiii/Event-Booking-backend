// src/modules/artist/services/eventArtistService.ts
import { db } from '../../../db/client.js';
import { eventArtists, artists } from '../../../db/schema/artist.js';
import { eq, and, sql } from 'drizzle-orm';

export class EventArtistService {
  /** Associate an artist with an event */
  async addArtist(tenantId: string, eventId: string, artistId: string, opts: { headline?: boolean; displayOrder?: number; performanceType?: string }) {
    await db
      .insert(eventArtists)
      .values({
        tenantId,
        eventId,
        artistId,
        headline: opts.headline ?? false,
        displayOrder: opts.displayOrder ?? 0,
        performanceType: opts.performanceType ?? null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .onConflictDoNothing();
  }

  /** Remove artist from event */
  async removeArtist(tenantId: string, eventId: string, artistId: string) {
    await db
      .delete(eventArtists)
      .where(and(eq(eventArtists.tenantId, tenantId), eq(eventArtists.eventId, eventId), eq(eventArtists.artistId, artistId)));
  }

  /** Get artists for an event */
  async getArtistsForEvent(tenantId: string, eventId: string) {
    return db
      .select()
      .from(eventArtists)
      .where(and(eq(eventArtists.tenantId, tenantId), eq(eventArtists.eventId, eventId)))
      .orderBy(sql`display_order ASC`);
  }

  /** Get events for an artist */
  async getEventsForArtist(tenantId: string, artistId: string) {
    return db
      .select()
      .from(eventArtists)
      .where(and(eq(eventArtists.tenantId, tenantId), eq(eventArtists.artistId, artistId)));
  }
}

export const eventArtistService = new EventArtistService();
