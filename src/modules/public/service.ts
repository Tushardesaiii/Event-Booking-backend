// Consumer discovery service: assembles public event DTOs from the cross-tenant
// repository, resolving asset keys to CDN URLs and attaching priceFrom, tags,
// and (for detail) ticket types and artist lineup.

import { db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { getLikeCount, getLikeCountsByEventIds } from '../event-likes/service.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';
import {
  findPublicEventByIdOrSlug,
  findPublicOrganizerByIdOrSlug,
  listPublicEventArtists,
  listPublicEventDates,
  listPublicEvents,
  listPublicEventsByOrganizer,
  listPublicOrganizers,
  listPublicTicketTypesForEvent,
  listTrendingEvents,
  priceFromByEventIds,
  tagsByEventIds,
  type PublicEventListInput,
  type PublicEventRow,
  type TrendingEventsInput,
} from './repository.js';

const VERIFIED_STATUSES = new Set(['verified', 'approved']);

// Build the consumer-facing organizer card from a joined event-detail row.
function organizerFromEventRow(row: Record<string, any>) {
  if (!row.organizerId || !row.organizerName) return null;
  return {
    id: row.organizerId,
    name: row.organizerDisplayName || row.organizerName,
    slug: row.organizerSlug ?? null,
    bio: row.organizerBio || row.organizerDescription || null,
    description: row.organizerDescription || null,
    logoUrl: toUrl(row.organizerLogoKey) || row.organizerLogo || null,
    coverUrl: row.organizerCover || null,
    website: row.organizerWebsite || null,
    instagram: row.organizerInstagram || null,
    city: row.organizerCity || null,
    verified: VERIFIED_STATUSES.has(row.organizerVerification),
  };
}

function toUrl(key: string | null | undefined): string | null {
  return key ? cloudflareCdnService.buildPublicUrl(key) : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapEventRow(
  row: PublicEventRow,
  priceFrom: number,
  tags: Array<{ id: string; name: string; slug: string }>,
  likeCount = 0,
) {
  const bannerUrl = toUrl(row.bannerKey);
  const thumbnailUrl = toUrl(row.thumbnailKey);
  const images = [bannerUrl, thumbnailUrl].filter((u): u is string => !!u);

  const now = Date.now();
  const start = row.startDateTime ? new Date(row.startDateTime).getTime() : null;
  const end = row.endDateTime ? new Date(row.endDateTime).getTime() : null;
  const isLive = start !== null && end !== null && start <= now && end >= now;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription ?? null,
    description: row.description ?? null,
    startDateTime: toIso(row.startDateTime),
    endDateTime: toIso(row.endDateTime),
    timezone: row.timezone,
    status: row.status,
    visibility: row.visibility,
    isFeatured: !!row.isFeatured,
    isLive,
    likeCount,
    organizerId: row.organizerId ?? null,
    cancellationPolicy: row.cancellationPolicy ?? null,
    termsAndConditions: row.termsAndConditions ?? null,
    faq: Array.isArray(row.faq) ? row.faq : [],
    maxCapacity: row.maxCapacity ?? null,
    bannerUrl,
    thumbnailUrl,
    images,
    priceFrom,
    matchScore: typeof (row as any).matchScore === 'number' ? (row as any).matchScore : 70,
    currency: 'INR',
    category: row.categoryId
      ? { id: row.categoryId, name: row.categoryName, slug: row.categorySlug }
      : null,
    tags,
    venue: row.venueId
      ? {
          id: row.venueId,
          name: row.venueName,
          city: row.venueCity,
          addressLine1: row.venueAddress1 ?? null,
          addressLine2: row.venueAddress2 ?? null,
          state: row.venueState ?? null,
          country: row.venueCountry ?? null,
          latitude: toNumber(row.venueLatitude),
          longitude: toNumber(row.venueLongitude),
          capacity: row.venueCapacity ?? null,
        }
      : null,
  };
}

export async function listPublicEventsService(
  input: PublicEventListInput & { page?: number; limit?: number },
) {
  const pagination = parsePagination(input);
  const { rows, total } = await listPublicEvents(db, input, pagination);
  const eventIds = rows.map((r) => r.id);

  const [priceMap, tagMap, likeMap] = await Promise.all([
    priceFromByEventIds(db, eventIds),
    tagsByEventIds(db, eventIds),
    getLikeCountsByEventIds(eventIds),
  ]);

  const items = rows.map((row) =>
    mapEventRow(row, priceMap.get(row.id) ?? 0, tagMap.get(row.id) ?? [], likeMap.get(row.id) ?? 0),
  );

  return {
    items,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total }),
  };
}

export async function listTrendingEventsService(
  input: TrendingEventsInput & { limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const rows = await listTrendingEvents(db, input, limit);
  const eventIds = rows.map((r) => r.id);

  const [priceMap, tagMap, likeMap] = await Promise.all([
    priceFromByEventIds(db, eventIds),
    tagsByEventIds(db, eventIds),
    getLikeCountsByEventIds(eventIds),
  ]);

  // `trendingScore` is the count of genuine bookings in the trailing window — the
  // client can surface it ("🔥 42 booked this week") or just use the ordering.
  return rows.map((row) => ({
    ...mapEventRow(row, priceMap.get(row.id) ?? 0, tagMap.get(row.id) ?? [], likeMap.get(row.id) ?? 0),
    trendingScore: Number(row.trendingScore ?? 0),
  }));
}

export async function getPublicEventService(idOrSlug: string) {
  const row = await findPublicEventByIdOrSlug(db, idOrSlug);
  if (!row) {
    throw notFound('Event not found');
  }

  const [priceMap, tagMap, ticketTypeRows, artistRows, dateRows, likeCount] = await Promise.all([
    priceFromByEventIds(db, [row.id]),
    tagsByEventIds(db, [row.id]),
    listPublicTicketTypesForEvent(db, row.id),
    listPublicEventArtists(db, row.id),
    listPublicEventDates(db, row.id),
    getLikeCount(row.id),
  ]);

  const base = mapEventRow(row, priceMap.get(row.id) ?? 0, tagMap.get(row.id) ?? [], likeCount);

  const ticketTypes = ticketTypeRows.map((t) => {
    const total = t.totalQuantity ?? 0;
    const sold = t.soldQuantity ?? 0;
    const reserved = t.reservedQuantity ?? 0;
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description ?? null,
      price: Number(t.price ?? 0),
      currency: t.currency ?? 'INR',
      totalQuantity: total,
      soldQuantity: sold,
      reservedQuantity: reserved,
      available: Math.max(0, total - sold - reserved),
      minPerOrder: t.minPerOrder ?? 1,
      maxPerOrder: t.maxPerOrder ?? 10,
      isRefundable: !!t.isRefundable,
      isTransferable: !!t.isTransferable,
      saleStartDate: toIso(t.saleStartDate),
      saleEndDate: toIso(t.saleEndDate),
    };
  });

  // The selectable dates the app shows on the event screen + booking flow. Falls
  // back to the event's own span if (somehow) no rows exist.
  const dates = (dateRows.length
    ? dateRows
    : [{ id: null, startDateTime: row.startDateTime, endDateTime: row.endDateTime }]
  ).map((d) => ({
    id: d.id,
    startDateTime: toIso(d.startDateTime),
    endDateTime: toIso(d.endDateTime),
  }));

  return {
    ...base,
    dates,
    organizer: organizerFromEventRow(row as Record<string, any>),
    ticketTypes,
    artists: artistRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      stageName: a.stageName,
      photoUrl: a.profileImageUrl ?? null,
      headline: a.headline ?? false,
    })),
  };
}

// Public organizer profile + their published events (powers the organizer page).
export async function getPublicOrganizerService(idOrSlug: string) {
  const org = await findPublicOrganizerByIdOrSlug(db, idOrSlug);
  if (!org) {
    throw notFound('Organizer not found');
  }

  const eventRows = await listPublicEventsByOrganizer(db, org.id, 24);
  const eventIds = eventRows.map((r) => r.id);

  const [priceMap, tagMap] = await Promise.all([
    priceFromByEventIds(db, eventIds),
    tagsByEventIds(db, eventIds),
  ]);

  const events = eventRows.map((row) =>
    mapEventRow(row, priceMap.get(row.id) ?? 0, tagMap.get(row.id) ?? []),
  );

  return {
    id: org.id,
    name: org.displayName || org.name,
    slug: org.slug,
    bio: org.bio || org.description || null,
    description: org.description || null,
    logoUrl: toUrl(org.logoKey) || org.logo || null,
    coverUrl: org.cover || null,
    website: org.website || null,
    instagram: org.instagram || null,
    facebook: org.facebook || null,
    city: org.city || null,
    state: org.state || null,
    verified: VERIFIED_STATUSES.has(org.verification),
    eventCount: events.length,
    events,
  };
}

// Discovery rail: real organizers (each with a published public event), mapped to
// the consumer card shape — logo resolved to a CDN url, display name, slug, city.
export async function listPublicOrganizersService(limit = 24) {
  const rows = await listPublicOrganizers(db, limit);
  return rows.map((o) => ({
    id: o.id,
    name: o.displayName || o.name,
    slug: o.slug,
    logoUrl: toUrl(o.logoKey) || o.logo || null,
    city: o.city || null,
    verified: VERIFIED_STATUSES.has(o.verification),
    eventCount: Number(o.eventCount ?? 0),
  }));
}
