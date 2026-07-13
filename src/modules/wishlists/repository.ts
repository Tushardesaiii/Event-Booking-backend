import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { wishlists } from './schema.js';
import { events } from '../../db/schema/events.js';
import type { WishlistRecord, WishlistItem } from './types.js';

type DBInstance = typeof db | any;

export async function addToWishlist(
  database: DBInstance,
  tenantId: string,
  userId: string,
  eventId: string
) {
  const [wish] = await database
    .insert(wishlists)
    .values({
      tenantId,
      userId,
      eventId
    })
    .onConflictDoNothing()
    .returning();

  return wish ?? null;
}

export async function removeFromWishlist(
  database: DBInstance,
  tenantId: string,
  userId: string,
  eventId: string
) {
  const [wish] = await database
    .delete(wishlists)
    .where(and(eq(wishlists.tenantId, tenantId), eq(wishlists.userId, userId), eq(wishlists.eventId, eventId)))
    .returning();

  return wish ?? null;
}

export async function listWishlistForUser(
  database: DBInstance,
  tenantId: string,
  userId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(wishlists.tenantId, tenantId), eq(wishlists.userId, userId)];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(wishlists)
    .where(whereClause);

  const rows = await database
    .select({
      id: wishlists.id,
      tenantId: wishlists.tenantId,
      userId: wishlists.userId,
      eventId: wishlists.eventId,
      createdAt: wishlists.createdAt,
      event: {
        id: events.id,
        title: events.title,
        slug: events.slug,
        startDateTime: events.startDateTime,
        bannerAssetId: events.bannerAssetId
      }
    })
    .from(wishlists)
    .innerJoin(events, eq(wishlists.eventId, events.id))
    .where(whereClause)
    .orderBy(desc(wishlists.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getWishlistCountForEvent(
  database: DBInstance,
  tenantId: string,
  eventId: string
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(wishlists)
    .where(and(eq(wishlists.tenantId, tenantId), eq(wishlists.eventId, eventId)));

  return Number(row?.count ?? 0);
}

export async function getTrendingSavedEvents(
  database: DBInstance,
  tenantId: string,
  limit = 10
) {
  const rows = await database
    .select({
      eventId: wishlists.eventId,
      count: sql<number>`count(*)::int`,
      event: {
        id: events.id,
        title: events.title,
        slug: events.slug,
        startDateTime: events.startDateTime,
        bannerAssetId: events.bannerAssetId
      }
    })
    .from(wishlists)
    .innerJoin(events, eq(wishlists.eventId, events.id))
    .where(eq(wishlists.tenantId, tenantId))
    .groupBy(wishlists.eventId, events.id)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows;
}
