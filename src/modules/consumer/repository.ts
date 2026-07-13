// Cross-tenant helpers for the authenticated consumer surface. A consumer is a
// buyer who is NOT a member of any organizer tenant, so these resolve the tenant
// from the event/booking rather than from a membership.

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../../db/client.js';
import { bookingOrders, paymentRefunds, paymentTransactions, paymentOrders } from '../../db/schema/index.js';
import { events } from '../../db/schema/events.js';
import { eventDates } from '../../db/schema/event-dates.js';
import { venues } from '../../db/schema/venues.js';
import { assets } from '../../db/schema/assets.js';
import { users } from '../../db/schema/users.js';
import { issuedTickets } from '../../db/schema/issued-tickets.js';
import { notifications } from '../notifications/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';

// Resolves the owning tenant for an event that is open to the public, or throws.
export async function resolvePublicEventTenantId(eventId: string): Promise<string> {
  const [row] = await db
    .select({
      tenantId: events.tenantId,
      status: events.status,
      visibility: events.visibility,
      deletedAt: events.deletedAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!row || row.deletedAt) {
    throw notFound('Event not found');
  }
  if (row.status !== 'published' || row.visibility !== 'public') {
    throw badRequest('This event is not open for booking');
  }
  return row.tenantId;
}

export async function findBuyerBookingById(bookingId: string, userId: string) {
  const [row] = await db
    .select()
    .from(bookingOrders)
    .where(
      and(
        eq(bookingOrders.id, bookingId),
        eq(bookingOrders.purchaserUserId, userId),
        isNull(bookingOrders.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The mobile app references a booking by its UUID, while order numbers are
// human-facing — accept either.
export async function findBuyerBookingByIdOrOrderNumber(value: string, userId: string) {
  if (UUID_RE.test(value)) {
    const byId = await findBuyerBookingById(value, userId);
    if (byId) return byId;
  }
  return findBuyerBookingByOrderNumber(value, userId);
}

export async function findBuyerBookingByOrderNumber(orderNumber: string, userId: string) {
  const [row] = await db
    .select()
    .from(bookingOrders)
    .where(
      and(
        eq(bookingOrders.orderNumber, orderNumber.trim().toUpperCase()),
        eq(bookingOrders.purchaserUserId, userId),
        isNull(bookingOrders.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getUserById(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

export interface ConsumerProfilePatch {
  fullName?: string;
  email?: string | null;
  city?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  interests?: string[];
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface TrustedContact {
  name: string;
  relation?: string;
  phone: string;
}

export async function updateUserTrustedContacts(userId: string, contacts: TrustedContact[]) {
  const [row] = await db
    .update(users)
    .set({ trustedContacts: contacts, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return row ?? null;
}

export async function updateUserProfile(userId: string, patch: ConsumerProfilePatch) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.fullName !== undefined) set.fullName = patch.fullName;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.city !== undefined) set.city = patch.city;
  if (patch.gender !== undefined) set.gender = patch.gender;
  if (patch.dateOfBirth !== undefined) set.dateOfBirth = patch.dateOfBirth;
  if (patch.interests !== undefined) set.interests = patch.interests;
  if (patch.bio !== undefined) set.bio = patch.bio;
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;

  const [row] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  return row ?? null;
}

export async function listBuyerBookings(
  userId: string,
  pagination: { offset: number; limit: number },
) {
  return db
    .select()
    .from(bookingOrders)
    .where(and(eq(bookingOrders.purchaserUserId, userId), isNull(bookingOrders.deletedAt)))
    .orderBy(desc(bookingOrders.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
}

// --- Notifications (cross-tenant, scoped to the authenticated user) --------

export async function listUserNotifications(
  userId: string,
  pagination: { offset: number; limit: number },
  isRead?: boolean,
) {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.deletedAt)];
  if (isRead === true) conditions.push(isNotNull(notifications.readAt));
  if (isRead === false) conditions.push(isNull(notifications.readAt));
  const where = and(...conditions);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(notifications)
    .where(where);

  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return { rows, total: Number(totalRow?.total ?? 0) };
}

export async function markUserNotificationRead(userId: string, id: string) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function markAllUserNotificationsRead(userId: string) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

// --- Issued tickets (scoped to the buyer via the booking order) ------------

const ticketBannerAsset = alias(assets, 'consumer_ticket_banner_asset');
const ticketThumbAsset = alias(assets, 'consumer_ticket_thumb_asset');

export async function listUserTickets(userId: string, bookingId?: string) {
  const conditions = [
    eq(bookingOrders.purchaserUserId, userId),
    isNull(issuedTickets.deletedAt),
  ];
  if (bookingId) conditions.push(eq(issuedTickets.bookingOrderId, bookingId));

  return db
    .select({
      id: issuedTickets.id,
      eventId: issuedTickets.eventId,
      ticketTypeId: issuedTickets.ticketTypeId,
      bookingOrderId: issuedTickets.bookingOrderId,
      ticketNumber: issuedTickets.ticketNumber,
      qrCodeToken: issuedTickets.qrCodeToken,
      status: issuedTickets.status,
      issuedAt: issuedTickets.issuedAt,
      ticketTypeName: issuedTickets.ticketTypeNameSnapshot,
      ticketTypeSlug: issuedTickets.ticketTypeSlugSnapshot,
      unitPrice: issuedTickets.unitPriceSnapshot,
      currency: issuedTickets.currencySnapshot,
      purchaserUserId: bookingOrders.purchaserUserId,
      // Event + venue snapshot so the app's "My Tickets" can render real event
      // details (title, image, venue, date) without a separate lookup.
      eventTitle: events.title,
      eventSlug: events.slug,
      // The specific booked occurrence date/time, falling back to the event span
      // for legacy/single-date tickets.
      eventStartDateTime: sql<Date>`coalesce(${eventDates.startDateTime}, ${events.startDateTime})`,
      eventEndDateTime: sql<Date>`coalesce(${eventDates.endDateTime}, ${events.endDateTime})`,
      eventTimezone: events.timezone,
      venueName: venues.name,
      venueCity: venues.city,
      // Full location so the ticket can show the real address + a directions button.
      venueAddressLine1: venues.addressLine1,
      venueAddressLine2: venues.addressLine2,
      venueState: venues.state,
      venueCountry: venues.country,
      venueLatitude: venues.latitude,
      venueLongitude: venues.longitude,
      bannerKey: ticketBannerAsset.key,
      thumbnailKey: ticketThumbAsset.key,
    })
    .from(issuedTickets)
    .innerJoin(bookingOrders, eq(bookingOrders.id, issuedTickets.bookingOrderId))
    .leftJoin(events, eq(events.id, issuedTickets.eventId))
    .leftJoin(eventDates, eq(eventDates.id, issuedTickets.eventDateId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(ticketBannerAsset, eq(ticketBannerAsset.id, events.bannerAssetId))
    .leftJoin(ticketThumbAsset, eq(ticketThumbAsset.id, events.thumbnailAssetId))
    .where(and(...conditions))
    .orderBy(desc(issuedTickets.issuedAt));
}

// --- Refunds (scoped to the buyer via the payment order) -------------------

export async function findUserRefundById(userId: string, refundId: string) {
  const [row] = await db
    .select({
      id: paymentRefunds.id,
      amount: paymentRefunds.amount,
      status: paymentRefunds.status,
      approvalStatus: paymentRefunds.approvalStatus,
      reason: paymentRefunds.reason,
      rejectionReason: paymentRefunds.rejectionReason,
      createdAt: paymentRefunds.createdAt,
      bookingOrderId: paymentOrders.bookingOrderId,
    })
    .from(paymentRefunds)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, paymentRefunds.paymentTransactionId))
    .innerJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
    .where(and(eq(paymentRefunds.id, refundId), eq(paymentOrders.createdBy, userId)))
    .limit(1);
  return row ?? null;
}
