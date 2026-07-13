import { desc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/platform-settings.js';

// Global, superadmin-curated configuration. There is exactly one row (guaranteed
// by the migration seed + singleton unique index); we always read/update the
// most-recent one and lazily create a default if somehow missing.

const DEFAULT_CONVENIENCE_FEE_BPS = 900; // 9%

export interface PlatformSettingsDTO {
  convenienceFeeBps: number;
  convenienceFeePercent: number;
  updatedAt: string | null;
}

function toDto(row: typeof platformSettings.$inferSelect | null): PlatformSettingsDTO {
  const bps = row?.convenienceFeeBps ?? DEFAULT_CONVENIENCE_FEE_BPS;
  return {
    convenienceFeeBps: bps,
    convenienceFeePercent: bps / 100,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null
  };
}

async function readRow() {
  const [row] = await db.select().from(platformSettings).orderBy(desc(platformSettings.updatedAt)).limit(1);
  if (row) return row;
  // Self-heal: create the singleton default row if it doesn't exist yet.
  const [created] = await db
    .insert(platformSettings)
    .values({ singleton: true, convenienceFeeBps: DEFAULT_CONVENIENCE_FEE_BPS })
    .onConflictDoNothing({ target: platformSettings.singleton })
    .returning();
  if (created) return created;
  const [existing] = await db.select().from(platformSettings).limit(1);
  return existing ?? null;
}

export async function getPlatformSettings(): Promise<PlatformSettingsDTO> {
  return toDto(await readRow());
}

// --- convenience fee, cached for the booking hot path -----------------------

let cachedBps: number | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/** The configured convenience fee in basis points (cached ~60s). */
export async function getConvenienceFeeBps(): Promise<number> {
  const now = Date.now();
  if (cachedBps !== null && now - cachedAt < CACHE_TTL_MS) return cachedBps;
  const row = await readRow();
  cachedBps = row?.convenienceFeeBps ?? DEFAULT_CONVENIENCE_FEE_BPS;
  cachedAt = now;
  return cachedBps;
}

/** Update the platform-wide convenience fee (basis points). */
export async function updatePlatformSettings(
  input: { convenienceFeeBps: number },
  updatedByUserId: string | null
): Promise<PlatformSettingsDTO> {
  const current = await readRow();
  let updated: typeof platformSettings.$inferSelect | undefined;
  if (current) {
    [updated] = await db
      .update(platformSettings)
      .set({
        convenienceFeeBps: input.convenienceFeeBps,
        updatedByUserId,
        updatedAt: new Date()
      })
      .where(eq(platformSettings.id, current.id))
      .returning();
  } else {
    [updated] = await db
      .insert(platformSettings)
      .values({ singleton: true, convenienceFeeBps: input.convenienceFeeBps, updatedByUserId })
      .returning();
  }
  // Invalidate the hot-path cache so the new rate applies immediately.
  cachedBps = updated?.convenienceFeeBps ?? input.convenienceFeeBps;
  cachedAt = Date.now();
  return toDto(updated ?? null);
}
