// src/modules/artist/services/alertService.ts
import { db } from '../../../db/client.js';
import { artistAlerts } from '../../../db/schema/artist.js';
import { eq, and } from 'drizzle-orm';

export class AlertService {
  async createOrUpdateAlert(tenantId: string, artistId: string, userId: string, opts: { radiusKm?: number; enabled?: boolean }) {
    const existing = await db
      .select()
      .from(artistAlerts)
      .where(and(eq(artistAlerts.tenantId, tenantId), eq(artistAlerts.artistId, artistId), eq(artistAlerts.userId, userId)))
      .limit(1);

    if (existing.length) {
      const [updated] = await db
        .update(artistAlerts)
        .set({
          radiusKm: opts.radiusKm ?? existing[0].radiusKm,
          enabled: opts.enabled ?? existing[0].enabled
        })
        .where(and(eq(artistAlerts.tenantId, tenantId), eq(artistAlerts.artistId, artistId), eq(artistAlerts.userId, userId)))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(artistAlerts)
      .values({
        tenantId,
        artistId,
        userId,
        radiusKm: opts.radiusKm ?? 50,
        enabled: opts.enabled ?? true,
        createdAt: new Date()
      })
      .returning();
    return inserted;
  }

  async deleteAlert(tenantId: string, artistId: string, userId: string) {
    return db
      .delete(artistAlerts)
      .where(and(eq(artistAlerts.tenantId, tenantId), eq(artistAlerts.artistId, artistId), eq(artistAlerts.userId, userId)));
  }

  async listAlertsForUser(tenantId: string, userId: string) {
    return db
      .select()
      .from(artistAlerts)
      .where(and(eq(artistAlerts.tenantId, tenantId), eq(artistAlerts.userId, userId)));
  }

  async listAlertsForArtist(tenantId: string, artistId: string) {
    return db
      .select()
      .from(artistAlerts)
      .where(and(eq(artistAlerts.tenantId, tenantId), eq(artistAlerts.artistId, artistId), eq(artistAlerts.enabled, true)));
  }
}

export const alertService = new AlertService();
