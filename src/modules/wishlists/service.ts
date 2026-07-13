import { db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { events } from '../../db/schema/events.js';
import { eq, and } from 'drizzle-orm';
import {
  addToWishlist,
  removeFromWishlist,
  listWishlistForUser,
  getWishlistCountForEvent,
  getTrendingSavedEvents
} from './repository.js';
import type { WishlistListQuery, WishlistItem } from './types.js';

export async function addEventToWishlist(
  tenantId: string,
  userId: string,
  eventId: string
) {
  // Check if event exists
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.id, eventId)))
    .limit(1);

  if (!event) {
    throw notFound('Event not found');
  }

  const wish = await addToWishlist(db, tenantId, userId, eventId);
  return wish;
}

export async function removeEventFromWishlist(
  tenantId: string,
  userId: string,
  eventId: string
) {
  const wish = await removeFromWishlist(db, tenantId, userId, eventId);
  return wish;
}

export async function getUserWishlist(
  tenantId: string,
  userId: string,
  input: WishlistListQuery
) {
  const pagination = parsePagination(input);
  const { rows, total } = await listWishlistForUser(db, tenantId, userId, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getWishlistAnalytics(
  tenantId: string,
  eventId: string
) {
  const count = await getWishlistCountForEvent(db, tenantId, eventId);
  return {
    eventId,
    wishlistCount: count
  };
}

export async function getTrendingEvents(
  tenantId: string,
  limit?: number
) {
  const trending = await getTrendingSavedEvents(db, tenantId, limit ?? 10);
  return trending;
}
