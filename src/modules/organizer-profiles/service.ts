import { and, desc, eq, gte, ilike, isNull, lt, sql, or, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { createSlug, createUniqueSlug } from '../../lib/slug.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { insertWithSlugRetry } from '../../lib/slug-write.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { hasRole } from '../../lib/permissions.js';
import { organizerSocialLinks } from './schema.js';
import {
  createOrganizerRecord,
  deactivateOrganizerRecord,
  findOrganizerByTenantAndSlug,
  findOrganizerById,
  getOrganizerSocialLinks,
  listOrganizersForTenant,
  syncOrganizerSocialLinks,
  updateOrganizerRecord,
  createOrganizerReviewRecord,
  updateOrganizerReviewRecord,
  deleteOrganizerReviewRecord,
  listOrganizerReviews,
  getOrganizerReviewStats,
  listEventsForOrganizer,
  followOrganizerRecord,
  unfollowOrganizerRecord,
  getOrganizerFollowersList,
  getUserFollowingOrganizersList,
  likeOrganizerRecord,
  unlikeOrganizerRecord,
  getOrganizerLikesList,
  createVerificationRequestRecord,
  approveOrRejectVerificationRecord,
  getOrganizerSafetyProfileRecord,
  upsertOrganizerSafetyProfileRecord,
  createSosAlertRecord,
  listSosAlertRecords,
  updateSosAlertStatusRecord,
  listTrendingOrganizers,
  listPopularOrganizers,
  listRecommendedOrganizers,
  organizerSelect
} from './repository.js';
import {
  organizers,
  organizerLikes,
  organizerSafetyProfiles,
  organizerVerifications,
  sosAlerts,
  organizerReviews
} from './schema.js';
import { events } from '../../db/schema/events.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { issuedTickets } from '../../db/schema/issued-tickets.js';
import { profiles, profileActivity, trustedContacts } from '../../db/schema/profile.js';
import { organizerFollows } from '../follow-system/schema.js';
import { activityService } from '../profile/services/activityService.js';
import type {
  CreateOrganizerDTO,
  UpdateOrganizerDTO,
  CreateOrganizerReviewDTO,
  UpdateOrganizerReviewDTO,
  OrganizerDetailItem,
  OrganizerListQuery,
  OrganizerVerificationRequestDTO,
  OrganizerVerificationDecisionDTO,
  OrganizerSafetyProfileDTO,
  SosReportIssueDTO,
  SosEmergencyAlertDTO
} from './types.js';

function assertManagementAccess(membership: TenantMembershipRecord) {
  if (membership.role !== 'owner' && membership.role !== 'admin' && membership.role !== 'manager') {
    throw forbidden('Insufficient permissions to manage organizers');
  }
}

function normalizeSlug(slug: string) {
  const normalized = createSlug(slug);
  if (!normalized) {
    throw badRequest('Invalid organizer slug');
  }
  return normalized;
}

async function getUserProfile(tenantId: string, userId: string) {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
    .limit(1);
  return profile ?? null;
}

export async function createOrganizer(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  input: CreateOrganizerDTO
) {
  assertManagementAccess(actorMembership);

  return db.transaction(async (tx) => {
    const organizer = await insertWithSlugRetry(
      (slug) =>
        createOrganizerRecord(tx, {
          ...input,
          tenantId,
          slug,
          createdByUserId: actorUserId
        }),
      () => createUniqueSlug(input.name)
    );

    if (!organizer) {
      throw conflict('Unable to create organizer');
    }

    if (input.socialLinks) {
      await syncOrganizerSocialLinks(tx, organizer.id, input.socialLinks);
    }

    const links = await getOrganizerSocialLinks(tx, organizer.id);

    // Log Activity
    const profile = await getUserProfile(tenantId, actorUserId);
    if (profile) {
      await activityService.logActivity(tenantId, profile.id, 'organizer created', organizer.id, {
        organizerSlug: organizer.slug,
        organizerName: organizer.name
      });
    }

    return {
      ...organizer,
      socialLinks: links
    };
  });
}

export async function listOrganizers(
  tenantId: string,
  input: OrganizerListQuery
) {
  const pagination = parsePagination(input);
  const { rows, total } = await listOrganizersForTenant(db, tenantId, input, pagination);

  const organizerIds = rows.map((r) => r.id);
  const socialLinks = organizerIds.length > 0 ? await db
    .select()
    .from(organizerSocialLinks)
    .where(inArray(organizerSocialLinks.organizerId, organizerIds)) : [];

  const socialLinksMap = new Map<string, any[]>();
  for (const link of socialLinks) {
    const arr = socialLinksMap.get(link.organizerId) || [];
    arr.push(link);
    socialLinksMap.set(link.organizerId, arr);
  }

  const items = rows.map((row) => ({
    ...row,
    socialLinks: socialLinksMap.get(row.id) || []
  }));

  return {
    items,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getOrganizerBySlug(
  tenantId: string,
  slug: string
): Promise<OrganizerDetailItem> {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const socialLinks = await getOrganizerSocialLinks(db, organizer.id);
  const reviewStats = await getOrganizerReviewStats(db, organizer.id);

  // Expose counts
  const [followerCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerFollows)
    .where(and(eq(organizerFollows.tenantId, tenantId), eq(organizerFollows.organizerId, organizer.id)));

  const [likesCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerLikes)
    .where(and(eq(organizerLikes.tenantId, tenantId), eq(organizerLikes.organizerId, organizer.id)));

  const [eventsStatsRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      upcoming: sql<number>`count(case when start_date_time > now() and deleted_at is null then 1 else null end)::int`,
      live: sql<number>`count(case when start_date_time <= now() and end_date_time >= now() and deleted_at is null then 1 else null end)::int`,
      completed: sql<number>`count(case when end_date_time < now() and deleted_at is null then 1 else null end)::int`
    })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.organizerId, organizer.id), isNull(events.deletedAt)));

  // Attendees hosted (count of unique purchaser user IDs across confirmed orders)
  const [attendeesRow] = await db
    .select({ count: sql<number>`count(distinct ${bookingOrders.purchaserUserId})::int` })
    .from(bookingOrders)
    .innerJoin(events, eq(bookingOrders.eventId, events.id))
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.organizerId, organizer.id),
        eq(bookingOrders.status, 'confirmed'),
        isNull(bookingOrders.deletedAt)
      )
    );

  return {
    ...organizer,
    socialLinks,
    reviewStats,
    followersCount: Number(followerCountRow?.count ?? 0),
    likesCount: Number(likesCountRow?.count ?? 0),
    ratings: reviewStats.averageRating,
    reviews: reviewStats.totalReviews,
    totalEventsHosted: Number(eventsStatsRow?.total ?? 0),
    totalAttendeesHosted: Number(attendeesRow?.count ?? 0),
    upcomingEventsCount: Number(eventsStatsRow?.upcoming ?? 0),
    liveEventsCount: Number(eventsStatsRow?.live ?? 0),
    completedEventsCount: Number(eventsStatsRow?.completed ?? 0)
  };
}

export async function updateOrganizerBySlug(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  input: UpdateOrganizerDTO
) {
  assertManagementAccess(actorMembership);
  const normalizedSlug = normalizeSlug(slug);

  return db.transaction(async (tx) => {
    const original = await findOrganizerByTenantAndSlug(tx, tenantId, normalizedSlug);
    if (!original) {
      throw notFound('Organizer not found');
    }

    const updated = await updateOrganizerRecord(tx, tenantId, normalizedSlug, {
      ...input,
      updatedByUserId: actorUserId
    } as any);

    assertOptimisticUpdate(updated);

    if (input.socialLinks) {
      await syncOrganizerSocialLinks(tx, original.id, input.socialLinks);
    }

    const socialLinks = await getOrganizerSocialLinks(tx, original.id);
    const reviewStats = await getOrganizerReviewStats(tx, original.id);

    return {
      ...updated!,
      socialLinks,
      reviewStats
    };
  });
}

export async function deleteOrganizerBySlug(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  lastKnownUpdatedAt: string
) {
  assertManagementAccess(actorMembership);
  const normalizedSlug = normalizeSlug(slug);

  const deleted = await deactivateOrganizerRecord(db, tenantId, normalizedSlug, actorUserId, lastKnownUpdatedAt);
  assertOptimisticUpdate(deleted);

  return deleted;
}

// ----------------------------------------------------
// FOLLOWS SYSTEM logic
// ----------------------------------------------------
export async function followOrganizer(
  tenantId: string,
  userId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const follow = await followOrganizerRecord(db, tenantId, userId, organizer.id);

  // Log Activity
  const profile = await getUserProfile(tenantId, userId);
  if (profile) {
    await activityService.logActivity(tenantId, profile.id, 'organizer followed', organizer.id, {
      organizerSlug: organizer.slug,
      organizerName: organizer.name
    });
  }

  return follow;
}

export async function unfollowOrganizer(
  tenantId: string,
  userId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return unfollowOrganizerRecord(db, tenantId, userId, organizer.id);
}

export async function getOrganizerFollowers(
  tenantId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return getOrganizerFollowersList(db, tenantId, organizer.id);
}

export async function getUserFollowing(
  tenantId: string,
  userId: string
) {
  return getUserFollowingOrganizersList(db, tenantId, userId);
}

// ----------------------------------------------------
// LIKES SYSTEM logic
// ----------------------------------------------------
export async function likeOrganizer(
  tenantId: string,
  userId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return likeOrganizerRecord(db, tenantId, userId, organizer.id);
}

export async function unlikeOrganizer(
  tenantId: string,
  userId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return unlikeOrganizerRecord(db, tenantId, userId, organizer.id);
}

export async function getOrganizerLikes(
  tenantId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return getOrganizerLikesList(db, tenantId, organizer.id);
}

// ----------------------------------------------------
// REVIEWS logic
// ----------------------------------------------------
export async function createOrganizerReview(
  tenantId: string,
  reviewerUserId: string,
  slug: string,
  input: CreateOrganizerReviewDTO
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const review = await createOrganizerReviewRecord(db, {
    ...input,
    organizerId: organizer.id,
    reviewerUserId
  });

  // Log Activity
  const profile = await getUserProfile(tenantId, reviewerUserId);
  if (profile && review) {
    await activityService.logActivity(tenantId, profile.id, 'review submitted', review.id, {
      organizerId: organizer.id,
      organizerSlug: organizer.slug,
      rating: input.rating
    });
  }

  return review;
}

export async function updateOrganizerReview(
  tenantId: string,
  reviewerUserId: string,
  reviewId: string,
  input: UpdateOrganizerReviewDTO
) {
  const [existing] = await db
    .select({
      review: organizerReviews,
      organizerTenantId: organizers.tenantId
    })
    .from(organizerReviews)
    .innerJoin(organizers, eq(organizerReviews.organizerId, organizers.id))
    .where(and(eq(organizerReviews.id, reviewId), isNull(organizerReviews.deletedAt)))
    .limit(1);

  if (!existing || existing.organizerTenantId !== tenantId) {
    throw notFound('Review not found');
  }

  if (existing.review.reviewerUserId !== reviewerUserId) {
    throw forbidden('Not authorized to update this review');
  }

  return updateOrganizerReviewRecord(db, reviewId, input);
}

export async function deleteOrganizerReview(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  reviewId: string
) {
  const [existing] = await db
    .select({
      review: organizerReviews,
      organizerTenantId: organizers.tenantId
    })
    .from(organizerReviews)
    .innerJoin(organizers, eq(organizerReviews.organizerId, organizers.id))
    .where(and(eq(organizerReviews.id, reviewId), isNull(organizerReviews.deletedAt)))
    .limit(1);

  if (!existing || existing.organizerTenantId !== tenantId) {
    throw notFound('Review not found');
  }

  const hasManagerRole = hasRole(actorMembership.role, 'manager');

  if (existing.review.reviewerUserId !== actorUserId && !hasManagerRole) {
    throw forbidden('Not authorized to delete this review');
  }

  return deleteOrganizerReviewRecord(db, reviewId);
}

export async function getReviewsForOrganizer(
  tenantId: string,
  slug: string,
  query: { page?: number; limit?: number }
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const pagination = parsePagination(query);
  const { rows, total } = await listOrganizerReviews(db, organizer.id, pagination);
  const reviewStats = await getOrganizerReviewStats(db, organizer.id);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total }),
    stats: reviewStats
  };
}

export async function getEventsForOrganizer(
  tenantId: string,
  slug: string,
  query: { page?: number; limit?: number }
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const pagination = parsePagination(query);
  const { rows, total } = await listEventsForOrganizer(db, tenantId, organizer.id, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getOrganizerAnalytics(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const isCreator = organizer.createdByUserId === actorUserId;
  const isStaffOrAbove = hasRole(actorMembership.role, 'staff');

  if (!isCreator && !isStaffOrAbove) {
    throw forbidden('Not authorized to view organizer data');
  }

  const reviewStats = await getOrganizerReviewStats(db, organizer.id);

  // Follower count
  const [followerRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerFollows)
    .where(and(eq(organizerFollows.tenantId, tenantId), eq(organizerFollows.organizerId, organizer.id)));

  // Events count
  const [eventsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.organizerId, organizer.id), isNull(events.deletedAt)));

  return {
    organizerId: organizer.id,
    averageRating: reviewStats.averageRating,
    totalReviews: reviewStats.totalReviews,
    totalFollowers: Number(followerRow?.count ?? 0),
    totalEvents: Number(eventsRow?.count ?? 0)
  };
}

// ----------------------------------------------------
// TRUST WORKFLOW logic
// ----------------------------------------------------
export async function requestOrganizerVerification(
  tenantId: string,
  actorUserId: string,
  slug: string,
  input: OrganizerVerificationRequestDTO
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  // Double check authorization: only owner/manager or creator of organizer profile can request verification
  if (organizer.createdByUserId !== actorUserId) {
    // Check if membership is admin/owner
    const [membership] = await db
      .select()
      .from(sql`tenant_members`)
      .where(and(sql`tenant_id = ${tenantId}`, sql`user_id = ${actorUserId}`))
      .limit(1) as any[];
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin' && membership.role !== 'manager')) {
      throw forbidden('Not authorized to request verification for this organizer');
    }
  }

  return createVerificationRequestRecord(db, tenantId, organizer.id, input.reason);
}

export async function reviewOrganizerVerification(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  input: OrganizerVerificationDecisionDTO
) {
  assertManagementAccess(actorMembership);
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const result = await approveOrRejectVerificationRecord(db, tenantId, organizer.id, input.status, input.reason, actorUserId);

  // Log Activity
  const profile = await getUserProfile(tenantId, actorUserId);
  if (profile && input.status === 'verified') {
    await activityService.logActivity(tenantId, profile.id, 'verification approved', organizer.id, {
      organizerSlug: organizer.slug,
      organizerName: organizer.name
    });
  }

  return result;
}

// ----------------------------------------------------
// SAFETY & SOS logic
// ----------------------------------------------------
export async function getOrganizerSafetyProfile(
  tenantId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const profile = await getOrganizerSafetyProfileRecord(db, tenantId, organizer.id);
  if (!profile) {
    // Return a default safety profile mapped from organizer emergency numbers if configured
    return {
      id: null,
      tenantId,
      organizerId: organizer.id,
      emergencyHelplineNumber: organizer.emergencyHelplineNumber ?? null,
      emergencyWhatsappNumber: organizer.emergencyWhatsappNumber ?? null,
      medicalHelpDeskInfo: null,
      lostAndFoundDeskInfo: null,
      womenSafetyDeskInfo: null,
      securityDeskInfo: null
    };
  }

  return profile;
}

export async function upsertOrganizerSafetyProfile(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  slug: string,
  input: OrganizerSafetyProfileDTO
) {
  assertManagementAccess(actorMembership);
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  return upsertOrganizerSafetyProfileRecord(db, tenantId, organizer.id, input);
}

export async function getEventSafetyProfile(
  tenantId: string,
  eventSlug: string
) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.slug, eventSlug), isNull(events.deletedAt)))
    .limit(1);

  if (!event) {
    throw notFound('Event not found');
  }

  let safety = {
    emergencyContact: event.emergencyContact,
    medicalDesk: event.medicalDesk,
    securityDesk: event.securityDesk,
    womenSafetyDesk: event.womenSafetyDesk,
    lostAndFoundDesk: event.lostAndFoundDesk
  };

  // Inherit from organizer if fields are null
  if (
    event.organizerId &&
    (!safety.emergencyContact || !safety.medicalDesk || !safety.securityDesk || !safety.womenSafetyDesk || !safety.lostAndFoundDesk)
  ) {
    const safetyProfile = await getOrganizerSafetyProfileRecord(db, tenantId, event.organizerId);
    const organizer = await findOrganizerById(db, tenantId, event.organizerId);

    if (safetyProfile) {
      safety.emergencyContact = safety.emergencyContact ?? safetyProfile.emergencyHelplineNumber ?? organizer?.emergencyHelplineNumber;
      safety.medicalDesk = safety.medicalDesk ?? safetyProfile.medicalHelpDeskInfo;
      safety.securityDesk = safety.securityDesk ?? safetyProfile.securityDeskInfo;
      safety.womenSafetyDesk = safety.womenSafetyDesk ?? safetyProfile.womenSafetyDeskInfo;
      safety.lostAndFoundDesk = safety.lostAndFoundDesk ?? safetyProfile.lostAndFoundDeskInfo;
    } else if (organizer) {
      safety.emergencyContact = safety.emergencyContact ?? organizer.emergencyHelplineNumber;
    }
  }

  return safety;
}

export async function reportSosIssue(
  tenantId: string,
  userId: string | null,
  input: SosReportIssueDTO
) {
  return createSosAlertRecord(db, tenantId, userId, input);
}

export async function triggerEmergencyAlert(
  tenantId: string,
  userId: string | null,
  input: SosEmergencyAlertDTO
) {
  // Save safety alert
  const alert = await createSosAlertRecord(db, tenantId, userId, {
    eventId: input.eventId,
    organizerId: input.organizerId,
    issueCategory: input.issueCategory,
    severity: input.severity,
    details: input.details,
    latitude: input.latitude,
    longitude: input.longitude
  });

  // Log Activity if user is logged in
  let profile = null;
  if (userId) {
    profile = await getUserProfile(tenantId, userId);
    if (profile) {
      await activityService.logActivity(tenantId, profile.id, 'emergency alert', alert.id, {
        eventId: input.eventId,
        organizerId: input.organizerId,
        issueCategory: input.issueCategory,
        severity: input.severity
      });
    }
  }

  // Retrieve user's trusted contacts to alert them (return them in payload response)
  let contactsList: any[] = [];
  if (profile) {
    contactsList = await db
      .select()
      .from(trustedContacts)
      .where(and(eq(trustedContacts.tenantId, tenantId), eq(trustedContacts.profileId, profile.id)));
  }

  return {
    alert,
    notifiedContacts: contactsList.map(c => ({
      name: c.name,
      phone: c.phone,
      relationship: c.relationship
    }))
  };
}

// Map a joined sos_alerts row to the shape the dashboard SOS console consumes.
function mapSosAlertRow(row: any) {
  const created = row.createdAt ? new Date(row.createdAt).getTime() : null;
  const ack = row.acknowledgedAt ? new Date(row.acknowledgedAt).getTime() : null;
  const resolved = row.resolvedAt ? new Date(row.resolvedAt).getTime() : null;

  let respondedInSec: number | null = null;
  if (created && ack) respondedInSec = Math.max(0, Math.round((ack - created) / 1000));
  else if (created && resolved) respondedInSec = Math.max(0, Math.round((resolved - created) / 1000));

  return {
    id: row.id,
    status: row.status,
    type: row.issueCategory,
    severity: row.severity,
    details: row.details ?? null,
    zone: row.locationName ?? null,
    location: {
      lat: row.latitude != null ? Number(row.latitude) : null,
      lng: row.longitude != null ? Number(row.longitude) : null
    },
    eventId: row.eventId ?? null,
    eventTitle: row.eventTitle ?? null,
    userId: row.userId ?? null,
    userName: row.userName ?? null,
    userPhone: row.userPhone ?? null,
    trustedContacts: Array.isArray(row.trustedContacts) ? row.trustedContacts : [],
    raisedAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt ?? null,
    resolvedAt: row.resolvedAt ?? null,
    respondedInSec
  };
}

export async function listSosAlerts(
  tenantId: string,
  filters: { eventId?: string | null; status?: string | null } = {}
) {
  const rows = await listSosAlertRecords(db, tenantId, filters);
  return rows.map(mapSosAlertRow);
}

export async function updateSosAlertStatus(
  tenantId: string,
  id: string,
  status: 'active' | 'acknowledged' | 'resolved' | 'cancelled'
) {
  const updated = await updateSosAlertStatusRecord(db, tenantId, id, status);
  if (!updated) {
    throw notFound('SOS alert not found');
  }
  // Re-read with joins so the response matches the list shape.
  const rows = await listSosAlertRecords(db, tenantId, {});
  const full = rows.find((r: any) => r.id === id);
  return full ? mapSosAlertRow(full) : mapSosAlertRow(updated);
}

// ----------------------------------------------------
// ORGANIZER DASHBOARD logic
// ----------------------------------------------------
export async function getOrganizerDashboard(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const isCreator = organizer.createdByUserId === actorUserId;
  const isStaffOrAbove = hasRole(actorMembership.role, 'staff');

  if (!isCreator && !isStaffOrAbove) {
    throw forbidden('Not authorized to view organizer data');
  }

  // 1. Followers
  const [followerRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerFollows)
    .where(and(eq(organizerFollows.tenantId, tenantId), eq(organizerFollows.organizerId, organizer.id)));
  const followersCount = Number(followerRow?.count ?? 0);

  // 2. Growth (Followers added in the last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [growthRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerFollows)
    .where(
      and(
        eq(organizerFollows.tenantId, tenantId),
        eq(organizerFollows.organizerId, organizer.id),
        gte(organizerFollows.createdAt, thirtyDaysAgo)
      )
    );
  const growthCount = Number(growthRow?.count ?? 0);

  // 3. Likes
  const [likesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizerLikes)
    .where(and(eq(organizerLikes.tenantId, tenantId), eq(organizerLikes.organizerId, organizer.id)));
  const likesCount = Number(likesRow?.count ?? 0);

  // 4. Reviews and Avg Rating
  const stats = await getOrganizerReviewStats(db, organizer.id);

  // 5. Events Stats (Upcoming events)
  const [upcomingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.organizerId, organizer.id),
        sql`${events.startDateTime} > now()`,
        isNull(events.deletedAt)
      )
    );
  const upcomingCount = Number(upcomingRow?.count ?? 0);

  // 6. Total Attendees
  const [attendeesRow] = await db
    .select({ count: sql<number>`count(distinct ${bookingOrders.purchaserUserId})::int` })
    .from(bookingOrders)
    .innerJoin(events, eq(bookingOrders.eventId, events.id))
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.organizerId, organizer.id),
        eq(bookingOrders.status, 'confirmed'),
        isNull(bookingOrders.deletedAt)
      )
    );
  const totalAttendees = Number(attendeesRow?.count ?? 0);

  // 7. Ticket Sales (Sum of booking order total amounts)
  const [salesRow] = await db
    .select({ total: sql<number>`sum(cast(${bookingOrders.totalAmount} as decimal))` })
    .from(bookingOrders)
    .innerJoin(events, eq(bookingOrders.eventId, events.id))
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.organizerId, organizer.id),
        eq(bookingOrders.status, 'confirmed'),
        isNull(bookingOrders.deletedAt)
      )
    );
  const ticketSales = Number(salesRow?.total ?? 0);

  // 8. Event Engagement (average rating / reviews count metric)
  const eventEngagement = stats.totalReviews > 0 ? stats.averageRating * stats.totalReviews : 0;

  return {
    followers: followersCount,
    growth: growthCount,
    likes: likesCount,
    reviews: stats.totalReviews,
    averageRating: stats.averageRating,
    upcomingEvents: upcomingCount,
    totalAttendees,
    ticketSales,
    eventEngagement
  };
}

// ----------------------------------------------------
// ACTIVITY FEED logic (Cursor paginated)
// ----------------------------------------------------
export async function getOrganizerActivityFeed(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  limit = 20,
  cursor?: string
) {
  const organizer = await findOrganizerByTenantAndSlug(db, tenantId, normalizeSlug(slug));
  if (!organizer) {
    throw notFound('Organizer not found');
  }

  const isCreator = organizer.createdByUserId === actorUserId;
  const isStaffOrAbove = hasRole(actorMembership.role, 'staff');

  if (!isCreator && !isStaffOrAbove) {
    throw forbidden('Not authorized to view organizer data');
  }

  // Query activities matching organizerId in targetId or metadata
  let conditions = [
    eq(profileActivity.tenantId, tenantId),
    or(
      eq(profileActivity.targetId, organizer.id),
      sql`${profileActivity.metadata}->>'organizerId' = ${organizer.id}`,
      sql`${profileActivity.metadata}->>'targetOrganizerId' = ${organizer.id}`
    )
  ];

  if (cursor) {
    const cursorDate = new Date(Number(cursor));
    conditions.push(lt(profileActivity.createdAt, cursorDate));
  }

  const activities = await db
    .select()
    .from(profileActivity)
    .where(and(...conditions))
    .orderBy(desc(profileActivity.createdAt))
    .limit(limit + 1);

  const hasNextPage = activities.length > limit;
  const items = hasNextPage ? activities.slice(0, limit) : activities;
  const nextCursor = hasNextPage ? String(items[items.length - 1].createdAt.getTime()) : null;

  return {
    items,
    nextCursor
  };
}

// ----------------------------------------------------
// DISCOVERY logic
// ----------------------------------------------------
export async function getTrendingOrganizers(tenantId: string, limit = 10) {
  return listTrendingOrganizers(db, tenantId, limit);
}

export async function getPopularOrganizers(tenantId: string, limit = 10) {
  return listPopularOrganizers(db, tenantId, limit);
}

export async function getRecommendedOrganizers(tenantId: string, userId: string, limit = 10) {
  return listRecommendedOrganizers(db, tenantId, userId, limit);
}

export async function searchOrganizers(
  tenantId: string,
  query: { search?: string; city?: string; state?: string; country?: string; limit?: number; offset?: number }
) {
  const limit = query.limit ? Number(query.limit) : 20;
  const offset = query.offset ? Number(query.offset) : 0;
  const conditions = [eq(organizers.tenantId, tenantId), isNull(organizers.deletedAt)];

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    conditions.push(
      or(
        ilike(organizers.name, searchPattern),
        ilike(organizers.description, searchPattern)
      )!
    );
  }

  if (query.city) {
    conditions.push(ilike(organizers.city, `%${query.city}%`));
  }
  if (query.state) {
    conditions.push(ilike(organizers.state, `%${query.state}%`));
  }
  if (query.country) {
    conditions.push(ilike(organizers.country, `%${query.country}%`));
  }

  const rows = await db
    .select(organizerSelect)
    .from(organizers)
    .where(and(...conditions))
    .orderBy(desc(organizers.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}
