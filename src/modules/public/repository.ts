// Cross-tenant, read-only queries powering the consumer discovery surface.
//
// Unlike the tenant-scoped events module, these intentionally span ALL tenants
// and expose only events that are safe for the public: status='published' and
// visibility='public' (and not soft-deleted). No tenant membership is required.

import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../../db/client.js';
import { events } from '../../db/schema/events.js';
import { eventDates } from '../../db/schema/event-dates.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { venues } from '../../db/schema/venues.js';
import { categories } from '../../db/schema/categories.js';
import { tags } from '../../db/schema/tags.js';
import { eventTags } from '../../db/schema/event-tags.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { assets } from '../../db/schema/assets.js';
import { eventArtists, artists } from '../../db/schema/artist.js';
import { organizers } from '../organizer-profiles/schema.js';
import { users } from '../../db/schema/users.js';
import { INTEREST_ALIASES } from '../../constants/categories.js';

type PublicDatabase = Pick<typeof db, 'select'>;

const bannerAsset = alias(assets, 'public_banner_asset');
const thumbAsset = alias(assets, 'public_thumb_asset');
const orgLogoAsset = alias(assets, 'public_org_logo_asset');

// Organizer columns attached to the event-detail response (so the consumer can
// render a real organizer card without a second round trip). Logo resolves from
// an uploaded asset key first, then a stored URL.
const organizerColumns = {
  organizerName: organizers.name,
  organizerDisplayName: organizers.displayName,
  organizerSlug: organizers.slug,
  organizerDescription: organizers.description,
  organizerBio: organizers.bio,
  organizerLogo: organizers.logo,
  organizerLogoKey: orgLogoAsset.key,
  organizerCover: organizers.coverImage,
  organizerWebsite: organizers.website,
  organizerInstagram: organizers.instagram,
  organizerCity: organizers.city,
  organizerVerification: organizers.verificationStatus,
} as const;

const publicEventSelect = {
  id: events.id,
  tenantId: events.tenantId,
  slug: events.slug,
  title: events.title,
  shortDescription: events.shortDescription,
  description: events.description,
  startDateTime: events.startDateTime,
  endDateTime: events.endDateTime,
  timezone: events.timezone,
  status: events.status,
  visibility: events.visibility,
  isFeatured: events.isFeatured,
  organizerId: events.organizerId,
  cancellationPolicy: events.cancellationPolicy,
  termsAndConditions: events.termsAndConditions,
  faq: events.faq,
  maxCapacity: events.maxCapacity,
  bannerKey: bannerAsset.key,
  thumbnailKey: thumbAsset.key,
  categoryId: categories.id,
  categoryName: categories.name,
  categorySlug: categories.slug,
  venueId: venues.id,
  venueName: venues.name,
  venueCity: venues.city,
  venueAddress1: venues.addressLine1,
  venueAddress2: venues.addressLine2,
  venueState: venues.state,
  venueCountry: venues.country,
  venueLatitude: venues.latitude,
  venueLongitude: venues.longitude,
  venueCapacity: venues.capacity,
} as const;

export type PublicEventRow = {
  [K in keyof typeof publicEventSelect]: any;
};

export interface PublicEventListInput {
  city?: string;
  category?: string;
  search?: string;
  featured?: boolean;
  upcoming?: boolean;
  sortBy?: 'relevance' | 'date' | 'price-low' | 'price-high' | 'match-score';
  userId?: string;
}

function publicBaseConditions() {
  return [
    eq(events.status, 'published'),
    eq(events.visibility, 'public'),
    isNull(events.deletedAt),
  ];
}

function withListJoins<T extends { from: any }>(query: any) {
  return query
    .from(events)
    .leftJoin(venues, and(eq(venues.id, events.venueId), isNull(venues.deletedAt)))
    .leftJoin(categories, and(eq(categories.id, events.categoryId), isNull(categories.deletedAt)))
    .leftJoin(bannerAsset, eq(bannerAsset.id, events.bannerAssetId))
    .leftJoin(thumbAsset, eq(thumbAsset.id, events.thumbnailAssetId));
}

function buildListWhere(input: PublicEventListInput) {
  const conditions = publicBaseConditions();

  if (input.city) {
    conditions.push(ilike(venues.city, input.city));
  }
  if (input.category) {
    conditions.push(
      or(ilike(categories.slug, input.category), ilike(categories.name, input.category))!,
    );
  }
  if (input.featured) {
    conditions.push(eq(events.isFeatured, true));
  }
  if (input.upcoming) {
    conditions.push(gt(events.endDateTime, new Date()));
  }
  if (input.search) {
    const term = `%${input.search}%`;
    conditions.push(
      or(
        ilike(events.title, term),
        ilike(events.shortDescription, term),
        ilike(events.description, term),
        ilike(venues.city, term),
      )!,
    );
  }

  return and(...conditions);
}

export async function listPublicEvents(
  database: PublicDatabase,
  input: PublicEventListInput,
  pagination: { offset: number; limit: number },
) {
  const whereClause = buildListWhere(input);

  const [totalRow] = await withListJoins(
    database.select({ total: sql<number>`count(distinct ${events.id})` }),
  ).where(whereClause);

  const minPriceSub = database
    .select({
      eventId: ticketTypes.eventId,
      minPrice: sql<number>`coalesce(min(${ticketTypes.price}), 0)`.as('min_price'),
    })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.visibility, 'public'), isNull(ticketTypes.deletedAt), ne(ticketTypes.status, 'draft')))
    .groupBy(ticketTypes.eventId)
    .as('min_price_sub');

  let matchScoreSql = sql<number>`70`;
  let userInterests: string[] = [];
  if (input.userId) {
    const [userRow] = await database
      .select({ interests: users.interests })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (userRow && Array.isArray(userRow.interests)) {
      userInterests = userRow.interests;
    }
  }

  if (userInterests.length > 0) {
    const conditions = [];
    for (const interest of userInterests) {
      const aliases = INTEREST_ALIASES[interest.toLowerCase()] || [interest];
      for (const aliasVal of aliases) {
        conditions.push(ilike(events.title, `%${aliasVal}%`));
        conditions.push(ilike(categories.name, `%${aliasVal}%`));
        conditions.push(ilike(categories.slug, `%${aliasVal}%`));
      }
    }
    if (conditions.length > 0) {
      matchScoreSql = sql<number>`CASE WHEN ${or(...conditions)} THEN 95 ELSE 70 END`;
    }
  }

  const minPriceVal = sql<number>`coalesce(${minPriceSub.minPrice}, 0)`;

  const orderByClauses = [];
  if (input.sortBy === 'date') {
    orderByClauses.push(asc(events.startDateTime));
  } else if (input.sortBy === 'price-low') {
    orderByClauses.push(asc(minPriceVal));
  } else if (input.sortBy === 'price-high') {
    orderByClauses.push(desc(minPriceVal));
  } else if (input.sortBy === 'match-score') {
    orderByClauses.push(desc(matchScoreSql));
  } else {
    orderByClauses.push(desc(events.isFeatured));
    orderByClauses.push(asc(events.startDateTime));
    orderByClauses.push(asc(events.slug));
  }

  const rows = await withListJoins(
    database.select({
      ...publicEventSelect,
      priceFrom: minPriceVal,
      matchScore: matchScoreSql,
    })
  )
    .leftJoin(minPriceSub, eq(minPriceSub.eventId, events.id))
    .where(whereClause)
    .orderBy(...orderByClauses)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as PublicEventRow[],
    total: Number(totalRow?.total ?? 0),
  };
}

// ── Trending ───────────────────────────────────────────────────────────────
// "Trending" = real demand signal: count of paid/confirmed booking orders placed
// in the last 7 days, per event. We rank upcoming, published, public events by
// that velocity (featured + soonest break ties), so the feed reflects what people
// are actually booking right now rather than an editorial flag. Events with zero
// recent bookings still appear (score 0) so a fresh catalog is never empty — they
// just sort below anything with traction.
const TRENDING_WINDOW_DAYS = 7;
const REAL_BOOKING_STATUSES = ['confirmed', 'paid', 'completed'] as const;

export interface TrendingEventsInput {
  city?: string;
  category?: string;
}

export type TrendingEventRow = PublicEventRow & { trendingScore: number };

export async function listTrendingEvents(
  database: PublicDatabase,
  input: TrendingEventsInput,
  limit: number,
): Promise<TrendingEventRow[]> {
  const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Per-event count of genuine bookings within the window, as a joinable subquery.
  const bookingCounts = database
    .select({
      eventId: bookingOrders.eventId,
      cnt: sql<number>`count(*)`.as('booking_cnt'),
    })
    .from(bookingOrders)
    .where(
      and(
        isNull(bookingOrders.deletedAt),
        inArray(bookingOrders.status, [...REAL_BOOKING_STATUSES]),
        gte(bookingOrders.createdAt, since),
      ),
    )
    .groupBy(bookingOrders.eventId)
    .as('booking_counts');

  const trendingScore = sql<number>`coalesce(${bookingCounts.cnt}, 0)`;

  const conditions = [...publicBaseConditions(), gt(events.endDateTime, new Date())];
  if (input.city) {
    conditions.push(ilike(venues.city, input.city));
  }
  if (input.category) {
    conditions.push(
      or(ilike(categories.slug, input.category), ilike(categories.name, input.category))!,
    );
  }

  const rows = await database
    .select({ ...publicEventSelect, trendingScore })
    .from(events)
    .leftJoin(venues, and(eq(venues.id, events.venueId), isNull(venues.deletedAt)))
    .leftJoin(categories, and(eq(categories.id, events.categoryId), isNull(categories.deletedAt)))
    .leftJoin(bannerAsset, eq(bannerAsset.id, events.bannerAssetId))
    .leftJoin(thumbAsset, eq(thumbAsset.id, events.thumbnailAssetId))
    .leftJoin(bookingCounts, eq(bookingCounts.eventId, events.id))
    .where(and(...conditions))
    .orderBy(
      desc(trendingScore),
      desc(events.isFeatured),
      asc(events.startDateTime),
      asc(events.slug),
    )
    .limit(limit);

  return rows as TrendingEventRow[];
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function findPublicEventByIdOrSlug(database: PublicDatabase, idOrSlug: string) {
  const identifierCondition = UUID_RE.test(idOrSlug)
    ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
    : eq(events.slug, idOrSlug);

  // Explicit joins (rather than withListJoins) so we can also pull the organizer
  // and its logo asset into the detail row.
  const [row] = await database
    .select({ ...publicEventSelect, ...organizerColumns })
    .from(events)
    .leftJoin(venues, and(eq(venues.id, events.venueId), isNull(venues.deletedAt)))
    .leftJoin(categories, and(eq(categories.id, events.categoryId), isNull(categories.deletedAt)))
    .leftJoin(bannerAsset, eq(bannerAsset.id, events.bannerAssetId))
    .leftJoin(thumbAsset, eq(thumbAsset.id, events.thumbnailAssetId))
    .leftJoin(organizers, eq(organizers.id, events.organizerId))
    .leftJoin(orgLogoAsset, eq(orgLogoAsset.id, organizers.logoAssetId))
    .where(and(...publicBaseConditions(), identifierCondition))
    .limit(1);

  return (row as (PublicEventRow & Record<string, any>) | undefined) ?? null;
}

// Public organizer profile (by id or slug). Independent of tenant membership.
export async function findPublicOrganizerByIdOrSlug(database: PublicDatabase, idOrSlug: string) {
  const condition = UUID_RE.test(idOrSlug)
    ? or(eq(organizers.id, idOrSlug), eq(organizers.slug, idOrSlug))
    : eq(organizers.slug, idOrSlug);

  const [row] = await database
    .select({
      id: organizers.id,
      name: organizers.name,
      displayName: organizers.displayName,
      slug: organizers.slug,
      description: organizers.description,
      bio: organizers.bio,
      logo: organizers.logo,
      logoKey: orgLogoAsset.key,
      cover: organizers.coverImage,
      website: organizers.website,
      instagram: organizers.instagram,
      facebook: organizers.facebook,
      city: organizers.city,
      state: organizers.state,
      verification: organizers.verificationStatus,
    })
    .from(organizers)
    .leftJoin(orgLogoAsset, eq(orgLogoAsset.id, organizers.logoAssetId))
    .where(condition)
    .limit(1);

  return row ?? null;
}

// Public organizers for the discovery rail: every organizer that has at least
// one published, public event, with its logo (asset key → CDN url) and a live
// event count. Ordered by most-active first.
export async function listPublicOrganizers(database: PublicDatabase, limit: number) {
  const eventCount = sql<number>`count(distinct ${events.id})`;

  const rows = await database
    .select({
      id: organizers.id,
      name: organizers.name,
      displayName: organizers.displayName,
      slug: organizers.slug,
      logo: organizers.logo,
      logoKey: orgLogoAsset.key,
      city: organizers.city,
      verification: organizers.verificationStatus,
      eventCount,
    })
    .from(organizers)
    .innerJoin(events, and(eq(events.organizerId, organizers.id), ...publicBaseConditions()))
    .leftJoin(orgLogoAsset, eq(orgLogoAsset.id, organizers.logoAssetId))
    .groupBy(organizers.id, orgLogoAsset.key)
    .orderBy(desc(eventCount), asc(organizers.name))
    .limit(limit);

  return rows;
}

// Published, public events for a given organizer (their profile feed).
export async function listPublicEventsByOrganizer(
  database: PublicDatabase,
  organizerId: string,
  limit: number,
) {
  const rows = await withListJoins(database.select(publicEventSelect))
    .where(and(...publicBaseConditions(), eq(events.organizerId, organizerId)))
    .orderBy(desc(events.isFeatured), asc(events.startDateTime), asc(events.slug))
    .limit(limit);

  return rows as PublicEventRow[];
}

export async function priceFromByEventIds(database: PublicDatabase, eventIds: string[]) {
  const map = new Map<string, number>();
  if (eventIds.length === 0) return map;

  const rows = await database
    .select({ eventId: ticketTypes.eventId, minPrice: sql<string>`min(${ticketTypes.price})` })
    .from(ticketTypes)
    .where(
      and(
        inArray(ticketTypes.eventId, eventIds),
        isNull(ticketTypes.deletedAt),
        eq(ticketTypes.visibility, 'public'),
        ne(ticketTypes.status, 'draft'),
      ),
    )
    .groupBy(ticketTypes.eventId);

  for (const row of rows) {
    map.set(row.eventId, Number(row.minPrice ?? 0));
  }
  return map;
}

export async function tagsByEventIds(database: PublicDatabase, eventIds: string[]) {
  const map = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  if (eventIds.length === 0) return map;

  const rows = await database
    .select({ eventId: eventTags.eventId, id: tags.id, name: tags.name, slug: tags.slug })
    .from(eventTags)
    .innerJoin(tags, and(eq(tags.id, eventTags.tagId), isNull(tags.deletedAt)))
    .where(inArray(eventTags.eventId, eventIds));

  for (const row of rows) {
    const existing = map.get(row.eventId) ?? [];
    existing.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.eventId, existing);
  }
  return map;
}

export async function listPublicTicketTypesForEvent(database: PublicDatabase, eventId: string) {
  return database
    .select({
      id: ticketTypes.id,
      name: ticketTypes.name,
      slug: ticketTypes.slug,
      description: ticketTypes.description,
      price: ticketTypes.price,
      currency: ticketTypes.currency,
      totalQuantity: ticketTypes.totalQuantity,
      soldQuantity: ticketTypes.soldQuantity,
      reservedQuantity: ticketTypes.reservedQuantity,
      minPerOrder: ticketTypes.minPerOrder,
      maxPerOrder: ticketTypes.maxPerOrder,
      isRefundable: ticketTypes.isRefundable,
      isTransferable: ticketTypes.isTransferable,
      status: ticketTypes.status,
      saleStartDate: ticketTypes.saleStartDate,
      saleEndDate: ticketTypes.saleEndDate,
    })
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.eventId, eventId),
        isNull(ticketTypes.deletedAt),
        eq(ticketTypes.visibility, 'public'),
        ne(ticketTypes.status, 'draft'),
      ),
    )
    .orderBy(asc(ticketTypes.price));
}

export async function listPublicEventDates(database: PublicDatabase, eventId: string) {
  return database
    .select({
      id: eventDates.id,
      startDateTime: eventDates.startDateTime,
      endDateTime: eventDates.endDateTime,
      displayOrder: eventDates.displayOrder,
    })
    .from(eventDates)
    .where(eq(eventDates.eventId, eventId))
    .orderBy(asc(eventDates.displayOrder), asc(eventDates.startDateTime));
}

export async function listPublicEventArtists(database: PublicDatabase, eventId: string) {
  return database
    .select({
      id: artists.id,
      slug: artists.slug,
      stageName: artists.stageName,
      profileImageUrl: artists.profileImageUrl,
      headline: eventArtists.headline,
      displayOrder: eventArtists.displayOrder,
    })
    .from(eventArtists)
    .innerJoin(artists, and(eq(artists.id, eventArtists.artistId), isNull(artists.deletedAt)))
    .where(eq(eventArtists.eventId, eventId))
    .orderBy(asc(eventArtists.displayOrder));
}
