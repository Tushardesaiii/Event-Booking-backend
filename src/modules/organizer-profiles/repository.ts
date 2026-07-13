import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  organizers,
  organizerSocialLinks,
  organizerReviews,
  organizerLikes,
  organizerSafetyProfiles,
  organizerVerifications,
  sosAlerts
} from './schema.js';
import { events } from '../../db/schema/events.js';
import { users } from '../../db/schema/users.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
  CreateOrganizerDTO,
  UpdateOrganizerDTO,
  CreateOrganizerReviewDTO,
  UpdateOrganizerReviewDTO,
  OrganizerListQuery,
  OrganizerRecord,
  OrganizerSocialLinkRecord,
  OrganizerReviewRecord,
  OrganizerLikeRecord,
  OrganizerSafetyProfileRecord,
  OrganizerVerificationRecord,
  SosAlertRecord,
  OrganizerSafetyProfileDTO,
  SosReportIssueDTO
} from './types.js';

type DBInstance = typeof db | any;

export const organizerSelect = {
  id: organizers.id,
  tenantId: organizers.tenantId,
  name: organizers.name,
  displayName: organizers.displayName,
  username: organizers.username,
  slug: organizers.slug,
  description: organizers.description,
  logoAssetId: organizers.logoAssetId,
  bannerAssetId: organizers.bannerAssetId,
  logo: organizers.logo,
  coverImage: organizers.coverImage,
  bio: organizers.bio,
  website: organizers.website,
  instagram: organizers.instagram,
  facebook: organizers.facebook,
  twitterX: organizers.twitterX,
  youtube: organizers.youtube,
  verificationStatus: organizers.verificationStatus,
  supportEmail: organizers.supportEmail,
  supportPhone: organizers.supportPhone,
  emergencyHelplineNumber: organizers.emergencyHelplineNumber,
  emergencyWhatsappNumber: organizers.emergencyWhatsappNumber,
  city: organizers.city,
  state: organizers.state,
  country: organizers.country,
  version: organizers.version,
  createdByUserId: organizers.createdByUserId,
  updatedByUserId: organizers.updatedByUserId,
  createdAt: organizers.createdAt,
  updatedAt: organizers.updatedAt,
  deletedAt: organizers.deletedAt
} as const;

export async function findOrganizerByTenantAndSlug(
  database: DBInstance,
  tenantId: string,
  slug: string
) {
  const [organizer] = await database
    .select(organizerSelect)
    .from(organizers)
    .where(and(eq(organizers.tenantId, tenantId), eq(organizers.slug, slug), isNull(organizers.deletedAt)))
    .limit(1);

  return organizer ?? null;
}

export async function findOrganizerById(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [organizer] = await database
    .select(organizerSelect)
    .from(organizers)
    .where(and(eq(organizers.tenantId, tenantId), eq(organizers.id, id), isNull(organizers.deletedAt)))
    .limit(1);

  return organizer ?? null;
}

export async function createOrganizerRecord(
  database: DBInstance,
  input: CreateOrganizerDTO & { tenantId: string; slug: string; createdByUserId: string }
) {
  const [organizer] = await database
    .insert(organizers)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      displayName: input.displayName ?? input.name,
      username: input.username ?? null,
      slug: input.slug,
      description: input.description ?? null,
      logoAssetId: input.logoAssetId ?? null,
      bannerAssetId: input.bannerAssetId ?? null,
      logo: input.logo ?? null,
      coverImage: input.coverImage ?? null,
      bio: input.bio ?? null,
      website: input.website ?? null,
      instagram: input.instagram ?? null,
      facebook: input.facebook ?? null,
      twitterX: input.twitterX ?? null,
      youtube: input.youtube ?? null,
      supportEmail: input.supportEmail ?? null,
      supportPhone: input.supportPhone ?? null,
      emergencyHelplineNumber: input.emergencyHelplineNumber ?? null,
      emergencyWhatsappNumber: input.emergencyWhatsappNumber ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      verificationStatus: 'pending',
      version: 0,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId
    })
    .returning(organizerSelect);

  return organizer ?? null;
}

export async function updateOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  slug: string,
  input: UpdateOrganizerDTO & { updatedByUserId: string; version?: number }
) {
  let lockCondition;
  if (input.version !== undefined) {
    lockCondition = eq(organizers.version, input.version);
  } else if (input.lastKnownUpdatedAt) {
    lockCondition = optimisticLockCondition(organizers.updatedAt, input.lastKnownUpdatedAt);
  } else {
    // If neither is provided, match version 0 or throw
    lockCondition = sql`true`;
  }

  const [organizer] = await database
    .update(organizers)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.username === undefined ? {} : { username: input.username }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.logoAssetId === undefined ? {} : { logoAssetId: input.logoAssetId ?? null }),
      ...(input.bannerAssetId === undefined ? {} : { bannerAssetId: input.bannerAssetId ?? null }),
      ...(input.logo === undefined ? {} : { logo: input.logo }),
      ...(input.coverImage === undefined ? {} : { coverImage: input.coverImage }),
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.website === undefined ? {} : { website: input.website }),
      ...(input.instagram === undefined ? {} : { instagram: input.instagram }),
      ...(input.facebook === undefined ? {} : { facebook: input.facebook }),
      ...(input.twitterX === undefined ? {} : { twitterX: input.twitterX }),
      ...(input.youtube === undefined ? {} : { youtube: input.youtube }),
      ...(input.supportEmail === undefined ? {} : { supportEmail: input.supportEmail }),
      ...(input.supportPhone === undefined ? {} : { supportPhone: input.supportPhone }),
      ...(input.emergencyHelplineNumber === undefined ? {} : { emergencyHelplineNumber: input.emergencyHelplineNumber }),
      ...(input.emergencyWhatsappNumber === undefined ? {} : { emergencyWhatsappNumber: input.emergencyWhatsappNumber }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.country === undefined ? {} : { country: input.country }),
      updatedByUserId: input.updatedByUserId,
      version: sql`${organizers.version} + 1`,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(organizers.tenantId, tenantId),
        eq(organizers.slug, slug),
        lockCondition,
        isNull(organizers.deletedAt)
      )
    )
    .returning(organizerSelect);

  return organizer ?? null;
}

export async function deactivateOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  slug: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string
) {
  const [organizer] = await database
    .update(organizers)
    .set({
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(
      and(
        eq(organizers.tenantId, tenantId),
        eq(organizers.slug, slug),
        optimisticLockCondition(organizers.updatedAt, lastKnownUpdatedAt),
        isNull(organizers.deletedAt)
      )
    )
    .returning(organizerSelect);

  return organizer ?? null;
}

export async function listOrganizersForTenant(
  database: DBInstance,
  tenantId: string,
  input: OrganizerListQuery,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(organizers.tenantId, tenantId), isNull(organizers.deletedAt)];

  if (input.search) {
    const searchPattern = `%${input.search}%`;
    conditions.push(
      or(
        ilike(organizers.name, searchPattern),
        ilike(organizers.description, searchPattern),
        ilike(organizers.city, searchPattern),
        ilike(organizers.country, searchPattern)
      )!
    );
  }

  const whereClause = and(...conditions);
  const direction = input.sortOrder === 'asc' ? asc : desc;
  const orderBy = input.sortBy === 'name' ? [direction(organizers.name)] : [direction(organizers.createdAt)];

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(organizers)
    .where(whereClause);

  const rows = await database
    .select(organizerSelect)
    .from(organizers)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as OrganizerRecord[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getOrganizerSocialLinks(
  database: DBInstance,
  organizerId: string
) {
  return database
    .select()
    .from(organizerSocialLinks)
    .where(eq(organizerSocialLinks.organizerId, organizerId));
}

export async function syncOrganizerSocialLinks(
  database: DBInstance,
  organizerId: string,
  socialLinks: Array<{ platform: string; url: string }>
) {
  await database.delete(organizerSocialLinks).where(eq(organizerSocialLinks.organizerId, organizerId));

  if (socialLinks.length > 0) {
    await database.insert(organizerSocialLinks).values(
      socialLinks.map((link) => ({
        organizerId,
        platform: link.platform,
        url: link.url
      }))
    );
  }
}

// ----------------------------------------------------
// FOLLOW SYSTEM
// ----------------------------------------------------
import { organizerFollows } from '../follow-system/schema.js';

export async function followOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const existing = await database
    .select()
    .from(organizerFollows)
    .where(
      and(
        eq(organizerFollows.tenantId, tenantId),
        eq(organizerFollows.userId, userId),
        eq(organizerFollows.organizerId, organizerId)
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [follow] = await database
    .insert(organizerFollows)
    .values({
      tenantId,
      userId,
      organizerId
    })
    .returning();

  return follow;
}

export async function unfollowOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const [deleted] = await database
    .delete(organizerFollows)
    .where(
      and(
        eq(organizerFollows.tenantId, tenantId),
        eq(organizerFollows.userId, userId),
        eq(organizerFollows.organizerId, organizerId)
      )
    )
    .returning();

  return deleted ?? null;
}

export async function getOrganizerFollowersList(
  database: DBInstance,
  tenantId: string,
  organizerId: string
) {
  return database
    .select({
      id: organizerFollows.id,
      userId: organizerFollows.userId,
      createdAt: organizerFollows.createdAt,
      user: {
        id: users.id,
        fullName: users.fullName,
        username: users.username
      }
    })
    .from(organizerFollows)
    .leftJoin(users, eq(organizerFollows.userId, users.id))
    .where(and(eq(organizerFollows.tenantId, tenantId), eq(organizerFollows.organizerId, organizerId)));
}

export async function getUserFollowingOrganizersList(
  database: DBInstance,
  tenantId: string,
  userId: string
) {
  return database
    .select({
      id: organizerFollows.id,
      organizerId: organizerFollows.organizerId,
      createdAt: organizerFollows.createdAt,
      organizer: organizerSelect
    })
    .from(organizerFollows)
    .leftJoin(organizers, eq(organizerFollows.organizerId, organizers.id))
    .where(and(eq(organizerFollows.tenantId, tenantId), eq(organizerFollows.userId, userId)));
}

// ----------------------------------------------------
// LIKE SYSTEM
// ----------------------------------------------------
export async function likeOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const existing = await database
    .select()
    .from(organizerLikes)
    .where(
      and(
        eq(organizerLikes.tenantId, tenantId),
        eq(organizerLikes.userId, userId),
        eq(organizerLikes.organizerId, organizerId)
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [like] = await database
    .insert(organizerLikes)
    .values({
      tenantId,
      userId,
      organizerId
    })
    .returning();

  return like;
}

export async function unlikeOrganizerRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  organizerId: string
) {
  const [deleted] = await database
    .delete(organizerLikes)
    .where(
      and(
        eq(organizerLikes.tenantId, tenantId),
        eq(organizerLikes.userId, userId),
        eq(organizerLikes.organizerId, organizerId)
      )
    )
    .returning();

  return deleted ?? null;
}

export async function getOrganizerLikesList(
  database: DBInstance,
  tenantId: string,
  organizerId: string
) {
  return database
    .select({
      id: organizerLikes.id,
      userId: organizerLikes.userId,
      createdAt: organizerLikes.createdAt,
      user: {
        id: users.id,
        fullName: users.fullName,
        username: users.username
      }
    })
    .from(organizerLikes)
    .leftJoin(users, eq(organizerLikes.userId, users.id))
    .where(and(eq(organizerLikes.tenantId, tenantId), eq(organizerLikes.organizerId, organizerId)));
}

// ----------------------------------------------------
// REVIEWS
// ----------------------------------------------------
export async function createOrganizerReviewRecord(
  database: DBInstance,
  input: CreateOrganizerReviewDTO & { organizerId: string; reviewerUserId: string }
) {
  const [review] = await database
    .insert(organizerReviews)
    .values({
      organizerId: input.organizerId,
      reviewerUserId: input.reviewerUserId,
      rating: input.rating,
      comment: input.comment ?? input.reviewText ?? null,
      title: input.title ?? null,
      reviewText: input.reviewText ?? input.comment ?? null,
      visitEventId: input.visitEventId ?? null
    })
    .returning();

  return review ?? null;
}

export async function updateOrganizerReviewRecord(
  database: DBInstance,
  reviewId: string,
  input: UpdateOrganizerReviewDTO
) {
  const [review] = await database
    .update(organizerReviews)
    .set({
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.reviewText === undefined && input.comment === undefined ? {} : {
        reviewText: input.reviewText ?? input.comment ?? null,
        comment: input.comment ?? input.reviewText ?? null
      }),
      ...(input.visitEventId === undefined ? {} : { visitEventId: input.visitEventId }),
      updatedAt: new Date()
    })
    .where(eq(organizerReviews.id, reviewId))
    .returning();

  return review ?? null;
}

export async function deleteOrganizerReviewRecord(
  database: DBInstance,
  reviewId: string
) {
  const [review] = await database
    .update(organizerReviews)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(organizerReviews.id, reviewId))
    .returning();

  return review ?? null;
}

export async function listOrganizerReviews(
  database: DBInstance,
  organizerId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(organizerReviews.organizerId, organizerId), isNull(organizerReviews.deletedAt)];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(organizerReviews)
    .where(whereClause);

  const rows = await database
    .select()
    .from(organizerReviews)
    .where(whereClause)
    .orderBy(desc(organizerReviews.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as OrganizerReviewRecord[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getOrganizerReviewStats(
  database: DBInstance,
  organizerId: string
) {
  const [row] = await database
    .select({
      avgRating: sql<number>`avg(${organizerReviews.rating})`,
      total: sql<number>`count(*)`
    })
    .from(organizerReviews)
    .where(and(eq(organizerReviews.organizerId, organizerId), isNull(organizerReviews.deletedAt)));

  // Get rating distribution
  const distributionRows = await database
    .select({
      rating: organizerReviews.rating,
      count: sql<number>`count(*)::int`
    })
    .from(organizerReviews)
    .where(and(eq(organizerReviews.organizerId, organizerId), isNull(organizerReviews.deletedAt)))
    .groupBy(organizerReviews.rating);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distributionRows.forEach((r: any) => {
    if (r.rating >= 1 && r.rating <= 5) {
      distribution[r.rating as 1 | 2 | 3 | 4 | 5] = r.count;
    }
  });

  return {
    averageRating: Math.round(Number(row?.avgRating ?? 0) * 10) / 10,
    totalReviews: Number(row?.total ?? 0),
    ratingDistribution: distribution
  };
}

export async function listEventsForOrganizer(
  database: DBInstance,
  tenantId: string,
  organizerId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(events.tenantId, tenantId),
    eq(events.organizerId, organizerId),
    isNull(events.deletedAt)
  ];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(events)
    .where(whereClause);

  const rows = await database
    .select()
    .from(events)
    .where(whereClause)
    .orderBy(desc(events.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

// ----------------------------------------------------
// TRUST / VERIFICATION
// ----------------------------------------------------
export async function createVerificationRequestRecord(
  database: DBInstance,
  tenantId: string,
  organizerId: string,
  reason?: string | null
) {
  // Update organizer status to pending
  await database
    .update(organizers)
    .set({ verificationStatus: 'pending', updatedAt: new Date() })
    .where(eq(organizers.id, organizerId));

  const [request] = await database
    .insert(organizerVerifications)
    .values({
      tenantId,
      organizerId,
      status: 'pending',
      reason: reason ?? null,
      submittedAt: new Date()
    })
    .returning();

  return request;
}

export async function approveOrRejectVerificationRecord(
  database: DBInstance,
  tenantId: string,
  organizerId: string,
  status: 'verified' | 'rejected',
  reason: string,
  reviewerUserId: string
) {
  // Update organizer verification status
  await database
    .update(organizers)
    .set({ verificationStatus: status, updatedAt: new Date() })
    .where(eq(organizers.id, organizerId));

  // Find the latest pending verification request or insert directly
  const [latestPending] = await database
    .select()
    .from(organizerVerifications)
    .where(
      and(
        eq(organizerVerifications.tenantId, tenantId),
        eq(organizerVerifications.organizerId, organizerId),
        eq(organizerVerifications.status, 'pending')
      )
    )
    .orderBy(desc(organizerVerifications.submittedAt))
    .limit(1);

  if (latestPending) {
    const [updated] = await database
      .update(organizerVerifications)
      .set({
        status,
        reason,
        reviewerUserId,
        reviewedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(organizerVerifications.id, latestPending.id))
      .returning();
    return updated;
  } else {
    const [inserted] = await database
      .insert(organizerVerifications)
      .values({
        tenantId,
        organizerId,
        status,
        reason,
        reviewerUserId,
        submittedAt: new Date(),
        reviewedAt: new Date()
      })
      .returning();
    return inserted;
  }
}

// ----------------------------------------------------
// SAFETY & SOS
// ----------------------------------------------------
export async function getOrganizerSafetyProfileRecord(
  database: DBInstance,
  tenantId: string,
  organizerId: string
) {
  const [profile] = await database
    .select()
    .from(organizerSafetyProfiles)
    .where(
      and(
        eq(organizerSafetyProfiles.tenantId, tenantId),
        eq(organizerSafetyProfiles.organizerId, organizerId),
        isNull(organizerSafetyProfiles.deletedAt)
      )
    )
    .limit(1);

  return profile ?? null;
}

export async function upsertOrganizerSafetyProfileRecord(
  database: DBInstance,
  tenantId: string,
  organizerId: string,
  input: OrganizerSafetyProfileDTO
) {
  const existing = await getOrganizerSafetyProfileRecord(database, tenantId, organizerId);
  if (existing) {
    const [updated] = await database
      .update(organizerSafetyProfiles)
      .set({
        ...input,
        updatedAt: new Date()
      })
      .where(eq(organizerSafetyProfiles.id, existing.id))
      .returning();
    return updated;
  } else {
    const [inserted] = await database
      .insert(organizerSafetyProfiles)
      .values({
        tenantId,
        organizerId,
        ...input
      })
      .returning();
    return inserted;
  }
}

export async function createSosAlertRecord(
  database: DBInstance,
  tenantId: string,
  userId: string | null,
  input: SosReportIssueDTO
) {
  const [alert] = await database
    .insert(sosAlerts)
    .values({
      tenantId,
      userId,
      eventId: input.eventId ?? null,
      organizerId: input.organizerId ?? null,
      locationName: input.locationName ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      issueCategory: input.issueCategory,
      severity: input.severity,
      details: input.details ?? null
    })
    .returning();

  return alert;
}

// Tenant-scoped SOS alert feed for the dashboard console. Joins the reporting
// user (name/phone/trusted-contacts) and the event (title).
export async function listSosAlertRecords(
  database: DBInstance,
  tenantId: string,
  filters: { eventId?: string | null; status?: string | null } = {}
) {
  const conditions = [eq(sosAlerts.tenantId, tenantId), isNull(sosAlerts.deletedAt)];
  if (filters.eventId) conditions.push(eq(sosAlerts.eventId, filters.eventId));
  if (filters.status) conditions.push(eq(sosAlerts.status, filters.status));

  return database
    .select({
      id: sosAlerts.id,
      status: sosAlerts.status,
      issueCategory: sosAlerts.issueCategory,
      severity: sosAlerts.severity,
      details: sosAlerts.details,
      locationName: sosAlerts.locationName,
      latitude: sosAlerts.latitude,
      longitude: sosAlerts.longitude,
      createdAt: sosAlerts.createdAt,
      acknowledgedAt: sosAlerts.acknowledgedAt,
      resolvedAt: sosAlerts.resolvedAt,
      eventId: sosAlerts.eventId,
      eventTitle: events.title,
      userId: sosAlerts.userId,
      userName: users.fullName,
      userPhone: users.phoneNumber,
      trustedContacts: users.trustedContacts
    })
    .from(sosAlerts)
    .leftJoin(events, eq(events.id, sosAlerts.eventId))
    .leftJoin(users, eq(users.id, sosAlerts.userId))
    .where(and(...conditions))
    .orderBy(desc(sosAlerts.createdAt));
}

export async function updateSosAlertStatusRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  status: 'active' | 'acknowledged' | 'resolved' | 'cancelled'
) {
  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === 'acknowledged') patch.acknowledgedAt = new Date();
  if (status === 'resolved') patch.resolvedAt = new Date();

  const [updated] = await database
    .update(sosAlerts)
    .set(patch)
    .where(and(eq(sosAlerts.tenantId, tenantId), eq(sosAlerts.id, id), isNull(sosAlerts.deletedAt)))
    .returning();

  return updated ?? null;
}

// ----------------------------------------------------
// DISCOVERY
// ----------------------------------------------------
export async function listTrendingOrganizers(
  database: DBInstance,
  tenantId: string,
  limit: number
) {
  // Join organizers with follows count
  const rows = await database
    .select({
      organizer: organizerSelect,
      followsCount: sql<number>`count(${organizerFollows.id})::int`
    })
    .from(organizers)
    .leftJoin(organizerFollows, eq(organizers.id, organizerFollows.organizerId))
    .where(and(eq(organizers.tenantId, tenantId), isNull(organizers.deletedAt)))
    .groupBy(organizers.id)
    .orderBy(desc(sql`count(${organizerFollows.id})`))
    .limit(limit);

  return rows.map((r: any) => ({
    ...r.organizer,
    followersCount: r.followsCount
  }));
}

export async function listPopularOrganizers(
  database: DBInstance,
  tenantId: string,
  limit: number
) {
  // Join organizers with likes count
  const rows = await database
    .select({
      organizer: organizerSelect,
      likesCount: sql<number>`count(${organizerLikes.id})::int`
    })
    .from(organizers)
    .leftJoin(organizerLikes, eq(organizers.id, organizerLikes.organizerId))
    .where(and(eq(organizers.tenantId, tenantId), isNull(organizers.deletedAt)))
    .groupBy(organizers.id)
    .orderBy(desc(sql`count(${organizerLikes.id})`))
    .limit(limit);

  return rows.map((r: any) => ({
    ...r.organizer,
    likesCount: r.likesCount
  }));
}

export async function listRecommendedOrganizers(
  database: DBInstance,
  tenantId: string,
  userId: string,
  limit: number
) {
  // Find organizers in the same city as user profile, or fallback to popular
  const rows = await database
    .select(organizerSelect)
    .from(organizers)
    .where(and(eq(organizers.tenantId, tenantId), isNull(organizers.deletedAt)))
    .orderBy(desc(organizers.createdAt))
    .limit(limit);

  return rows;
}
