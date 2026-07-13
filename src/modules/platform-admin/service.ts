import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { events } from '../../db/schema/events.js';
import { tenants } from '../../db/schema/tenants.js';
import { tenantMembers } from '../../db/schema/tenant-members.js';
import { settlements } from '../settlements/schema.js';
import { stories } from '../stories/schema.js';
import { mediaAssets, mediaLinks } from '../media/schema.js';
import {
  paymentOrders,
  paymentTransactions,
  paymentRefunds,
  reconciliationReports,
  paymentDisputes,
  paymentWebhookEvents
} from '../../db/schema/payments.js';
import { RazorpayClient } from '../../lib/razorpay.js';
import { env } from '../../config/env.js';
import { venues } from '../../db/schema/venues.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { assets } from '../../db/schema/assets.js';
import { users } from '../../db/schema/users.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { organizers, organizerReviews } from '../organizer-profiles/schema.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';

// Booking statuses that represent recognised revenue (for GMV / spend).
const PAID_STATUSES = ['paid', 'completed', 'confirmed', 'partially_refunded'] as const;
const orgLogoAsset = alias(assets, 'platform_org_logo_asset');
const toCdnUrl = (key: string | null | undefined) =>
  key ? cloudflareCdnService.buildPublicUrl(key) : null;

/**
 * Cross-tenant event review for platform admins. Lists events in a given status
 * (default 'draft' = submitted for review) with organizer (tenant) name, venue,
 * tiers and resolved image URLs.
 */
type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed' | 'archived';

/**
 * Cross-tenant events for the platform console. `status` filters by lifecycle
 * state; omit it (undefined) to return every event regardless of status (the
 * "All Events" admin view). Each row carries the organizer (tenant) name, venue,
 * ticket tiers and resolved image URLs.
 */
export async function listEventsForReview(status?: EventStatus) {
  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      shortDescription: events.shortDescription,
      description: events.description,
      startDateTime: events.startDateTime,
      endDateTime: events.endDateTime,
      status: events.status,
      maxCapacity: events.maxCapacity,
      bannerAssetId: events.bannerAssetId,
      thumbnailAssetId: events.thumbnailAssetId,
      rejectionReason: events.rejectionReason,
      tenantId: events.tenantId,
      tenantName: tenants.name,
      venueName: venues.name,
      venueCity: venues.city,
      createdAt: events.createdAt,
      updatedAt: events.updatedAt
    })
    .from(events)
    .leftJoin(tenants, eq(tenants.id, events.tenantId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(...(status ? [eq(events.status, status)] : []), isNull(events.deletedAt)))
    .orderBy(desc(events.createdAt));

  if (rows.length === 0) return [];

  // Resolve banner/thumbnail asset ids → public URLs (batched).
  const assetIds = [
    ...new Set(rows.flatMap((r) => [r.bannerAssetId, r.thumbnailAssetId]).filter((x): x is string => !!x))
  ];
  const keyById = new Map<string, string>();
  if (assetIds.length > 0) {
    const found = await db.select({ id: assets.id, key: assets.key }).from(assets).where(inArray(assets.id, assetIds));
    for (const a of found) keyById.set(a.id, a.key);
  }
  const toUrl = (id: string | null) => {
    const key = id ? keyById.get(id) : undefined;
    return key ? cloudflareCdnService.buildPublicUrl(key) : null;
  };

  // Ticket tiers per event (batched).
  const eventIds = rows.map((r) => r.id);
  const tiers = await db
    .select({ eventId: ticketTypes.eventId, name: ticketTypes.name, price: ticketTypes.price, totalQuantity: ticketTypes.totalQuantity })
    .from(ticketTypes)
    .where(and(inArray(ticketTypes.eventId, eventIds), isNull(ticketTypes.deletedAt)));
  const tiersByEvent = new Map<string, Array<{ name: string; price: number; totalQuantity: number }>>();
  for (const t of tiers) {
    const arr = tiersByEvent.get(t.eventId) ?? [];
    arr.push({ name: t.name, price: Number(t.price), totalQuantity: t.totalQuantity });
    tiersByEvent.set(t.eventId, arr);
  }

  return rows.map((r) => ({
    ...r,
    bannerUrl: toUrl(r.bannerAssetId),
    thumbnailUrl: toUrl(r.thumbnailAssetId),
    tiers: tiersByEvent.get(r.id) ?? [],
    // The dashboard event card renders tags; platform view doesn't join them.
    tags: [] as Array<{ id: string; name: string; slug: string }>
  }));
}

export async function approveEvent(eventId: string, actorUserId: string) {
  const [updated] = await db
    .update(events)
    .set({
      status: 'published',
      visibility: 'public',
      publishedAt: new Date(),
      rejectionReason: null,
      updatedByUserId: actorUserId,
      updatedAt: new Date()
    })
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .returning();
  if (!updated) throw notFound('Event not found');
  return updated;
}

export async function rejectEvent(eventId: string, reason: string | null, actorUserId: string) {
  const [updated] = await db
    .update(events)
    .set({
      status: 'cancelled',
      rejectionReason: reason ?? null,
      updatedByUserId: actorUserId,
      updatedAt: new Date()
    })
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .returning();
  if (!updated) throw notFound('Event not found');
  return updated;
}

// ---------------------------------------------------------------------------
// Organizers — cross-tenant governance for the superadmin console.
// ---------------------------------------------------------------------------

// verificationStatus → the console's organizer status.
function organizerStatus(v: string): 'active' | 'pending' | 'suspended' {
  if (v === 'verified') return 'active';
  if (v === 'rejected' || v === 'suspended') return 'suspended';
  return 'pending';
}

/** Every organizer on the platform with live event count, GMV (₹) and rating. */
export async function listAllOrganizers() {
  const orgRows = await db
    .select({
      id: organizers.id,
      name: organizers.name,
      displayName: organizers.displayName,
      slug: organizers.slug,
      city: organizers.city,
      logo: organizers.logo,
      logoKey: orgLogoAsset.key,
      verificationStatus: organizers.verificationStatus,
      createdAt: organizers.createdAt
    })
    .from(organizers)
    .leftJoin(orgLogoAsset, eq(orgLogoAsset.id, organizers.logoAssetId))
    .orderBy(desc(organizers.createdAt));

  if (orgRows.length === 0) return [];

  const [eventCounts, gmvRows, ratingRows] = await Promise.all([
    db
      .select({ organizerId: events.organizerId, count: sql<number>`count(*)::int` })
      .from(events)
      .where(isNull(events.deletedAt))
      .groupBy(events.organizerId),
    db
      .select({
        organizerId: events.organizerId,
        gmv: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), 0)`
      })
      .from(bookingOrders)
      .innerJoin(events, eq(events.id, bookingOrders.eventId))
      .where(and(inArray(bookingOrders.status, [...PAID_STATUSES]), isNull(bookingOrders.deletedAt)))
      .groupBy(events.organizerId),
    db
      .select({ organizerId: organizerReviews.organizerId, avg: sql<string>`avg(${organizerReviews.rating})` })
      .from(organizerReviews)
      .where(isNull(organizerReviews.deletedAt))
      .groupBy(organizerReviews.organizerId)
  ]);

  const countById = new Map(eventCounts.map((r) => [r.organizerId, Number(r.count)]));
  const gmvById = new Map(gmvRows.map((r) => [r.organizerId, Number(r.gmv)]));
  const ratingById = new Map(
    ratingRows.map((r) => [r.organizerId, r.avg ? Math.round(Number(r.avg) * 10) / 10 : 0])
  );

  return orgRows.map((o) => ({
    id: o.id,
    name: o.displayName || o.name,
    slug: o.slug,
    logoUrl: toCdnUrl(o.logoKey) || o.logo || null,
    city: o.city || null,
    status: organizerStatus(o.verificationStatus),
    kycVerified: o.verificationStatus === 'verified',
    eventsCount: countById.get(o.id) ?? 0,
    gmv: gmvById.get(o.id) ?? 0,
    rating: ratingById.get(o.id) ?? 0,
    joinedAt: o.createdAt
  }));
}

/** Set an organizer's verification (Approve → verified, Suspend → rejected). */
export async function setOrganizerVerification(
  organizerId: string,
  status: 'verified' | 'rejected' | 'pending'
) {
  const [updated] = await db
    .update(organizers)
    .set({ verificationStatus: status, updatedAt: new Date() })
    .where(eq(organizers.id, organizerId))
    .returning({ id: organizers.id, verificationStatus: organizers.verificationStatus });
  if (!updated) throw notFound('Organizer not found');
  return {
    id: updated.id,
    status: organizerStatus(updated.verificationStatus),
    kycVerified: updated.verificationStatus === 'verified'
  };
}

// ---------------------------------------------------------------------------
// Organizer applications — the "become an organizer" approval queue.
//
// A tenant is the workspace an organizer signs into, so an "application" is a
// tenant plus its owner. Superadmins approve/reject here; the change gates the
// organizer's dashboard access immediately (see tenants.approvalStatus).
// ---------------------------------------------------------------------------

export type OrganizerApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Organizer applications, optionally filtered by approval status. */
export async function listOrganizerApplications(status?: OrganizerApprovalStatus) {
  const conditions = [isNull(tenants.deletedAt)];
  if (status) conditions.push(eq(tenants.approvalStatus, status));

  const rows = await db
    .select({
      id: tenants.id,
      organizationName: tenants.name,
      slug: tenants.slug,
      city: tenants.city,
      tenantEmail: tenants.email,
      tenantPhone: tenants.phone,
      approvalStatus: tenants.approvalStatus,
      rejectionReason: tenants.rejectionReason,
      isVerified: tenants.isVerified,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
      ownerName: users.fullName,
      ownerEmail: users.email,
      ownerPhone: users.phoneNumber
    })
    .from(tenants)
    .innerJoin(
      tenantMembers,
      and(eq(tenantMembers.tenantId, tenants.id), eq(tenantMembers.role, 'owner'))
    )
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(...conditions))
    .orderBy(desc(tenants.createdAt));

  return rows.map((r) => ({
    id: r.id,
    organizationName: r.organizationName,
    slug: r.slug,
    city: r.city ?? null,
    ownerName: r.ownerName,
    email: r.ownerEmail ?? r.tenantEmail ?? null,
    phone: r.ownerPhone ?? r.tenantPhone ?? null,
    status: r.approvalStatus as OrganizerApprovalStatus,
    rejectionReason: r.rejectionReason ?? null,
    isVerified: r.isVerified,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }));
}

/** Approve an organizer application → dashboard access unlocks immediately. */
export async function approveOrganizerApplication(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({
      approvalStatus: 'approved',
      rejectionReason: null,
      isVerified: true,
      updatedAt: new Date()
    })
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .returning({ id: tenants.id, status: tenants.approvalStatus });
  if (!updated) throw notFound('Organizer application not found');
  return { id: updated.id, status: updated.status as OrganizerApprovalStatus };
}

/** Reject an organizer application, storing an optional reason for the organizer. */
export async function rejectOrganizerApplication(tenantId: string, reason: string | null) {
  const [updated] = await db
    .update(tenants)
    .set({
      approvalStatus: 'rejected',
      rejectionReason: reason ?? null,
      updatedAt: new Date()
    })
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .returning({ id: tenants.id, status: tenants.approvalStatus });
  if (!updated) throw notFound('Organizer application not found');
  return { id: updated.id, status: updated.status as OrganizerApprovalStatus };
}

// ---------------------------------------------------------------------------
// Users & attendees — platform-wide directory for the superadmin console.
// ---------------------------------------------------------------------------

/** Consumer users with booking count + lifetime spend (₹), plus platform totals. */
export async function listAllUsers(limit = 200) {
  const [userRows, [totals], [bookingAgg]] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        city: users.city,
        avatarUrl: users.avatarUrl,
        phoneVerifiedAt: users.phoneVerifiedAt,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.isPlatformAdmin, false))
      .orderBy(desc(users.createdAt))
      .limit(limit),
    db
      .select({
        total: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${users.phoneVerifiedAt} is not null or ${users.emailVerifiedAt} is not null)::int`
      })
      .from(users)
      .where(eq(users.isPlatformAdmin, false)),
    db
      .select({
        buyers: sql<number>`count(distinct ${bookingOrders.purchaserUserId})::int`,
        spend: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), 0)`
      })
      .from(bookingOrders)
      .where(and(inArray(bookingOrders.status, [...PAID_STATUSES]), isNull(bookingOrders.deletedAt)))
  ]);

  // Per-user booking aggregates (only for the returned page of users).
  const ids = userRows.map((u) => u.id);
  const aggById = new Map<string, { bookings: number; spend: number }>();
  if (ids.length > 0) {
    const agg = await db
      .select({
        userId: bookingOrders.purchaserUserId,
        bookings: sql<number>`count(*)::int`,
        spend: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), 0)`
      })
      .from(bookingOrders)
      .where(
        and(
          inArray(bookingOrders.purchaserUserId, ids),
          inArray(bookingOrders.status, [...PAID_STATUSES]),
          isNull(bookingOrders.deletedAt)
        )
      )
      .groupBy(bookingOrders.purchaserUserId);
    for (const r of agg) aggById.set(r.userId, { bookings: Number(r.bookings), spend: Number(r.spend) });
  }

  const items = userRows.map((u) => {
    const a = aggById.get(u.id);
    return {
      id: u.id,
      name: u.fullName,
      city: u.city || null,
      avatarUrl: u.avatarUrl || null,
      verified: !!(u.phoneVerifiedAt || u.emailVerifiedAt),
      bookings: a?.bookings ?? 0,
      spend: a?.spend ?? 0,
      joinedAt: u.createdAt
    };
  });

  return {
    items,
    stats: {
      total: Number(totals?.total ?? 0),
      verified: Number(totals?.verified ?? 0),
      withBookings: Number(bookingAgg?.buyers ?? 0),
      totalSpend: Number(bookingAgg?.spend ?? 0)
    }
  };
}

// ---------------------------------------------------------------------------
// Settlements — cross-tenant read view for the platform console.
// ---------------------------------------------------------------------------

/** Every settlement across the platform with its event + organizer name. */
export async function listAllSettlements() {
  return db
    .select({
      id: settlements.id,
      tenantId: settlements.tenantId,
      organizerName: tenants.name,
      eventId: settlements.eventId,
      eventTitle: events.title,
      type: settlements.type,
      grossSales: settlements.grossSales,
      platformFee: settlements.platformFee,
      refunds: settlements.refunds,
      netPayable: settlements.netPayable,
      chequeNo: settlements.chequeNo,
      scheduledDate: settlements.scheduledDate,
      status: settlements.status,
      createdAt: settlements.createdAt,
      updatedAt: settlements.updatedAt
    })
    .from(settlements)
    .leftJoin(events, eq(events.id, settlements.eventId))
    .leftJoin(tenants, eq(tenants.id, settlements.tenantId))
    .where(isNull(settlements.deletedAt))
    .orderBy(desc(settlements.createdAt));
}

// ---------------------------------------------------------------------------
// Social content — cross-tenant read views for platform moderation.
// ---------------------------------------------------------------------------

/** Every live (unexpired) event story across the platform, with organizer + event. */
export async function listAllStories() {
  return db
    .select({
      id: stories.id,
      mediaUrl: stories.mediaUrl,
      mediaType: stories.mediaType,
      caption: stories.caption,
      viewsCount: stories.viewerCount,
      eventId: stories.ownerId,
      eventTitle: events.title,
      organizerName: tenants.name,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt
    })
    .from(stories)
    .leftJoin(events, eq(events.id, stories.ownerId))
    .leftJoin(tenants, eq(tenants.id, stories.tenantId))
    .where(
      and(eq(stories.ownerType, 'event'), isNull(stories.deletedAt), gte(stories.expiresAt, new Date()))
    )
    .orderBy(desc(stories.createdAt));
}

/** Every event gallery photo across the platform, with organizer + event. */
export async function listAllGalleryPhotos() {
  const rows = await db
    .select({
      id: mediaLinks.id,
      storageKey: mediaAssets.storageKey,
      originalFileName: mediaAssets.originalFileName,
      eventId: mediaLinks.entityId,
      eventTitle: events.title,
      organizerName: tenants.name,
      createdAt: mediaLinks.createdAt
    })
    .from(mediaLinks)
    .innerJoin(mediaAssets, eq(mediaLinks.mediaAssetId, mediaAssets.id))
    .leftJoin(events, eq(events.id, mediaLinks.entityId))
    .leftJoin(tenants, eq(tenants.id, mediaLinks.tenantId))
    .where(
      and(eq(mediaLinks.entityType, 'event'), eq(mediaLinks.role, 'gallery'), isNull(mediaAssets.deletedAt))
    )
    .orderBy(desc(mediaLinks.createdAt));

  return rows.map((r) => ({
    id: r.id,
    cdnUrl: toCdnUrl(r.storageKey),
    originalFileName: r.originalFileName,
    eventId: r.eventId,
    eventTitle: r.eventTitle,
    organizerName: r.organizerName
  }));
}

// ---------------------------------------------------------------------------
// Payments — cross-tenant Razorpay money view for the platform console.
// ---------------------------------------------------------------------------

function maskKeyId(keyId: string) {
  if (!keyId) return null;
  return `${keyId.slice(0, 12)}…`;
}

/**
 * Platform-wide payments overview, sourced from the Razorpay-backed payment
 * ledger (payment_orders / _transactions / _refunds) across every tenant. All
 * money is in decimal rupees.
 */
export async function getPlatformPayments() {
  let gatewayKeyId: string | null = null;
  try {
    gatewayKeyId = maskKeyId(RazorpayClient.getInstance().getKeyId());
  } catch {
    gatewayKeyId = null;
  }

  const [
    [orderAgg],
    [txAgg],
    [refundAgg],
    [reconAgg],
    [disputeAgg],
    [webhookAgg],
    statusRows,
    recentTransactions,
    recentRefunds
  ] = await Promise.all([
    db
      .select({
        // Captured = money actually collected via Razorpay (capturedAmount is
        // unreliable in older rows, so derive from the order lifecycle status).
        collected: sql<string>`coalesce(sum(${paymentOrders.amount}) filter (where ${paymentOrders.status} in ('captured','partially_captured','refunded','partially_refunded')), 0)`,
        gross: sql<string>`coalesce(sum(${paymentOrders.amount}), 0)`,
        count: sql<number>`count(*)::int`
      })
      .from(paymentOrders),
    db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${paymentTransactions.amount}), 0)`
      })
      .from(paymentTransactions),
    db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
        pending: sql<number>`count(*) filter (where ${paymentRefunds.approvalStatus} = 'pending')::int`
      })
      .from(paymentRefunds),
    db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${reconciliationReports.status} = 'open')::int`
      })
      .from(reconciliationReports),
    db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${paymentDisputes.status} in ('received','under_review','evidence_required','evidence_submitted'))::int`
      })
      .from(paymentDisputes),
    db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${paymentWebhookEvents.status} = 'failed')::int`,
        lastReceivedAt: sql<string | null>`max(${paymentWebhookEvents.receivedAt})`
      })
      .from(paymentWebhookEvents),
    db
      .select({
        status: paymentOrders.status,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${paymentOrders.amount}), 0)`
      })
      .from(paymentOrders)
      .groupBy(paymentOrders.status),
    db
      .select({
        id: paymentTransactions.id,
        razorpayPaymentId: paymentTransactions.razorpayPaymentId,
        amount: paymentTransactions.amount,
        currency: paymentTransactions.currency,
        status: paymentTransactions.status,
        organizerName: tenants.name,
        eventTitle: events.title,
        createdAt: paymentTransactions.createdAt
      })
      .from(paymentTransactions)
      .leftJoin(tenants, eq(tenants.id, paymentTransactions.tenantId))
      .leftJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
      .leftJoin(bookingOrders, eq(bookingOrders.id, paymentOrders.bookingOrderId))
      .leftJoin(events, eq(events.id, bookingOrders.eventId))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(20),
    db
      .select({
        id: paymentRefunds.id,
        razorpayRefundId: paymentRefunds.razorpayRefundId,
        amount: paymentRefunds.amount,
        status: paymentRefunds.status,
        approvalStatus: paymentRefunds.approvalStatus,
        reason: paymentRefunds.reason,
        organizerName: tenants.name,
        createdAt: paymentRefunds.createdAt
      })
      .from(paymentRefunds)
      .leftJoin(tenants, eq(tenants.id, paymentRefunds.tenantId))
      .orderBy(desc(paymentRefunds.createdAt))
      .limit(15)
  ]);

  const collected = Number(orderAgg?.collected ?? 0);
  const refunded = Number(refundAgg?.amount ?? 0);

  return {
    gateway: {
      provider: 'razorpay' as const,
      mode: env.RAZORPAY_MODE, // 'test' | 'production'
      keyId: gatewayKeyId,
      connected: !!gatewayKeyId,
      webhooks: {
        total: Number(webhookAgg?.total ?? 0),
        failed: Number(webhookAgg?.failed ?? 0),
        lastReceivedAt: webhookAgg?.lastReceivedAt ?? null
      }
    },
    summary: {
      collected,
      gross: Number(orderAgg?.gross ?? 0),
      refunded,
      net: collected - refunded,
      orderCount: Number(orderAgg?.count ?? 0),
      transactionCount: Number(txAgg?.count ?? 0),
      refundCount: Number(refundAgg?.count ?? 0),
      refundsPending: Number(refundAgg?.pending ?? 0),
      reconciliationsOpen: Number(reconAgg?.open ?? 0),
      reconciliationsTotal: Number(reconAgg?.total ?? 0),
      disputesOpen: Number(disputeAgg?.open ?? 0),
      disputesTotal: Number(disputeAgg?.total ?? 0)
    },
    statusBreakdown: statusRows.map((r) => ({
      status: r.status,
      count: Number(r.count),
      amount: Number(r.amount)
    })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id,
      razorpayPaymentId: t.razorpayPaymentId,
      amount: Number(t.amount),
      currency: t.currency,
      status: t.status,
      organizerName: t.organizerName,
      eventTitle: t.eventTitle,
      createdAt: t.createdAt
    })),
    recentRefunds: recentRefunds.map((r) => ({
      id: r.id,
      razorpayRefundId: r.razorpayRefundId,
      amount: Number(r.amount),
      status: r.status,
      approvalStatus: r.approvalStatus,
      reason: r.reason,
      organizerName: r.organizerName,
      createdAt: r.createdAt
    }))
  };
}

// ---------------------------------------------------------------------------
// Platform analytics — the superadmin's cross-tenant overview.
// ---------------------------------------------------------------------------

/** Platform-wide KPIs (organizers, users, events, revenue) + trends. */
export async function getPlatformAnalytics() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [[orgAgg], [userAgg], [eventAgg], [bookingAgg], [ticketAgg], revenueTrend, allOrganizers] =
    await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          approved: sql<number>`count(*) filter (where ${tenants.approvalStatus} = 'approved')::int`,
          pending: sql<number>`count(*) filter (where ${tenants.approvalStatus} = 'pending')::int`,
          rejected: sql<number>`count(*) filter (where ${tenants.approvalStatus} = 'rejected')::int`
        })
        .from(tenants)
        .where(isNull(tenants.deletedAt)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${users.phoneVerifiedAt} is not null or ${users.emailVerifiedAt} is not null)::int`
        })
        .from(users)
        .where(eq(users.isPlatformAdmin, false)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          published: sql<number>`count(*) filter (where ${events.status} = 'published')::int`,
          pendingReview: sql<number>`count(*) filter (where ${events.status} = 'draft')::int`
        })
        .from(events)
        .where(isNull(events.deletedAt)),
      db
        .select({
          paidOrders: sql<number>`count(*)::int`,
          gmv: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), 0)`
        })
        .from(bookingOrders)
        .where(and(inArray(bookingOrders.status, [...PAID_STATUSES]), isNull(bookingOrders.deletedAt))),
      db
        .select({ sold: sql<number>`coalesce(sum(${ticketTypes.soldQuantity}), 0)::int` })
        .from(ticketTypes)
        .where(isNull(ticketTypes.deletedAt)),
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${bookingOrders.createdAt}), 'YYYY-MM')`,
          revenue: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), 0)`
        })
        .from(bookingOrders)
        .where(
          and(
            inArray(bookingOrders.status, [...PAID_STATUSES]),
            isNull(bookingOrders.deletedAt),
            gte(bookingOrders.createdAt, sixMonthsAgo)
          )
        )
        .groupBy(sql`date_trunc('month', ${bookingOrders.createdAt})`)
        .orderBy(sql`date_trunc('month', ${bookingOrders.createdAt})`),
      listAllOrganizers()
    ]);

  const topOrganizers = [...allOrganizers]
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 5)
    .map((o) => ({ id: o.id, name: o.name, gmv: o.gmv, eventsCount: o.eventsCount, city: o.city }));

  return {
    organizers: {
      total: Number(orgAgg?.total ?? 0),
      approved: Number(orgAgg?.approved ?? 0),
      pending: Number(orgAgg?.pending ?? 0),
      rejected: Number(orgAgg?.rejected ?? 0)
    },
    users: {
      total: Number(userAgg?.total ?? 0),
      verified: Number(userAgg?.verified ?? 0)
    },
    events: {
      total: Number(eventAgg?.total ?? 0),
      published: Number(eventAgg?.published ?? 0),
      pendingReview: Number(eventAgg?.pendingReview ?? 0)
    },
    revenue: {
      // GMV uses the same unit as the organizers directory (bookingOrders.total_amount).
      gmv: Number(bookingAgg?.gmv ?? 0),
      paidOrders: Number(bookingAgg?.paidOrders ?? 0)
    },
    ticketsSold: Number(ticketAgg?.sold ?? 0),
    revenueTrend: revenueTrend.map((r) => ({ month: r.month, revenue: Number(r.revenue) })),
    topOrganizers
  };
}
