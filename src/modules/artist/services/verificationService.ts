// src/modules/artist/services/verificationService.ts
import { db } from '../../../db/client.js';
import { artistVerifications, artists } from '../../../db/schema/artist.js';
import { eq, and } from 'drizzle-orm';

export class VerificationService {
  async requestVerification(tenantId: string, artistId: string) {
    const existing = await db
      .select()
      .from(artistVerifications)
      .where(and(eq(artistVerifications.tenantId, tenantId), eq(artistVerifications.artistId, artistId)))
      .limit(1);

    if (existing.length) {
      return db
        .update(artistVerifications)
        .set({ status: 'pending', requestedAt: new Date(), reviewedAt: null, reviewerId: null })
        .where(and(eq(artistVerifications.tenantId, tenantId), eq(artistVerifications.artistId, artistId)))
        .returning();
    }

    return db
      .insert(artistVerifications)
      .values({
        tenantId,
        artistId,
        status: 'pending',
        requestedAt: new Date()
      })
      .returning();
  }

  async approveVerification(tenantId: string, artistId: string, reviewerId: string) {
    await db.transaction(async (tx: any) => {
      await tx
        .update(artistVerifications)
        .set({
          status: 'verified',
          reviewedAt: new Date(),
          reviewerId
        })
        .where(and(eq(artistVerifications.tenantId, tenantId), eq(artistVerifications.artistId, artistId)));

      await tx
        .update(artists)
        .set({ verified: true, updatedAt: new Date() })
        .where(and(eq(artists.tenantId, tenantId), eq(artists.id, artistId)));
    });
  }

  async rejectVerification(tenantId: string, artistId: string, reviewerId: string) {
    await db.transaction(async (tx: any) => {
      await tx
        .update(artistVerifications)
        .set({
          status: 'rejected',
          reviewedAt: new Date(),
          reviewerId
        })
        .where(and(eq(artistVerifications.tenantId, tenantId), eq(artistVerifications.artistId, artistId)));

      await tx
        .update(artists)
        .set({ verified: false, updatedAt: new Date() })
        .where(and(eq(artists.tenantId, tenantId), eq(artists.id, artistId)));
    });
  }

  async getVerificationStatus(tenantId: string, artistId: string) {
    const [status] = await db
      .select()
      .from(artistVerifications)
      .where(and(eq(artistVerifications.tenantId, tenantId), eq(artistVerifications.artistId, artistId)))
      .limit(1);
    return status ?? null;
  }
}

export const verificationService = new VerificationService();
