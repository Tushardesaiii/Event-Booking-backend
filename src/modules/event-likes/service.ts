import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { eventLikes } from '../../db/schema/event-likes.js';
import { events } from '../../db/schema/events.js';
import { notFound } from '../../lib/errors.js';

async function assertEventExists(eventId: string): Promise<void> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Event not found');
}

/** Current like count for a single event. */
export async function getLikeCount(eventId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(eventLikes)
    .where(eq(eventLikes.eventId, eventId));
  return row?.c ?? 0;
}

/** Batched like counts for many events (0 for events with no likes). */
export async function getLikeCountsByEventIds(eventIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({ eventId: eventLikes.eventId, c: sql<number>`count(*)::int` })
    .from(eventLikes)
    .where(inArray(eventLikes.eventId, eventIds))
    .groupBy(eventLikes.eventId);
  for (const row of rows) map.set(row.eventId, row.c);
  return map;
}

/** Event ids the user has liked (for rendering the filled heart everywhere). */
export async function getLikedEventIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ eventId: eventLikes.eventId })
    .from(eventLikes)
    .where(eq(eventLikes.userId, userId));
  return rows.map((r) => r.eventId);
}

/** Idempotently like an event; returns the fresh liked state + count. */
export async function likeEvent(userId: string, eventId: string): Promise<{ liked: boolean; likeCount: number }> {
  await assertEventExists(eventId);
  await db
    .insert(eventLikes)
    .values({ eventId, userId })
    .onConflictDoNothing({ target: [eventLikes.eventId, eventLikes.userId] });
  return { liked: true, likeCount: await getLikeCount(eventId) };
}

/** Idempotently unlike an event; returns the fresh liked state + count. */
export async function unlikeEvent(userId: string, eventId: string): Promise<{ liked: boolean; likeCount: number }> {
  await db.delete(eventLikes).where(and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)));
  return { liked: false, likeCount: await getLikeCount(eventId) };
}
