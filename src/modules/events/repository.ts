import { and, asc, desc, eq, gte, gt, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { categories } from '../../db/schema/categories.js';
import { eventSeries } from '../../db/schema/event-series.js';
import { eventTags } from '../../db/schema/event-tags.js';
import { events } from '../../db/schema/events.js';
import { tags } from '../../db/schema/tags.js';
import { venues } from '../../db/schema/venues.js';
import { eventArtists, artists } from '../../db/schema/artist.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
	CreateEventCategoryDTO,
	CreateEventDTO,
	CreateEventSeriesDTO,
	CreateEventTagDTO,
	EventCategoryRecord,
	EventListQuery,
	EventRecord,
	EventSeriesRecord,
	EventTagListItem,
	EventTagRecord,
	ListEventCategoriesQuery,
	ListEventSeriesQuery,
	ListEventTagsQuery,
	UpdateEventDTO
} from './types.js';

type EventsDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

const eventCoreSelect = {
	id: events.id,
	tenantId: events.tenantId,
	venueId: events.venueId,
	categoryId: events.categoryId,
	eventSeriesId: events.eventSeriesId,
	title: events.title,
	slug: events.slug,
	shortDescription: events.shortDescription,
	description: events.description,
	startDateTime: events.startDateTime,
	endDateTime: events.endDateTime,
	timezone: events.timezone,
	bannerAssetId: events.bannerAssetId,
	thumbnailAssetId: events.thumbnailAssetId,
	maxCapacity: events.maxCapacity,
	status: events.status,
	visibility: events.visibility,
	publishedAt: events.publishedAt,
	isFeatured: events.isFeatured,
	metaTitle: events.metaTitle,
	metaDescription: events.metaDescription,
	termsAndConditions: events.termsAndConditions,
	cancellationPolicy: events.cancellationPolicy,
	createdByUserId: events.createdByUserId,
	updatedByUserId: events.updatedByUserId,
	createdAt: events.createdAt,
	updatedAt: events.updatedAt,
	deletedAt: events.deletedAt
} as const;

const eventSelect = {
	...eventCoreSelect,
	venueCity: venues.city
} as const;

const eventSeriesSelect = {
	id: eventSeries.id,
	tenantId: eventSeries.tenantId,
	title: eventSeries.title,
	slug: eventSeries.slug,
	description: eventSeries.description,
	timezone: eventSeries.timezone,
	startDateTime: eventSeries.startDateTime,
	endDateTime: eventSeries.endDateTime,
	isActive: eventSeries.isActive,
	createdByUserId: eventSeries.createdByUserId,
	updatedByUserId: eventSeries.updatedByUserId,
	createdAt: eventSeries.createdAt,
	updatedAt: eventSeries.updatedAt,
	deletedAt: eventSeries.deletedAt
} as const;

const eventCategorySelect = {
	id: categories.id,
	tenantId: categories.tenantId,
	name: categories.name,
	slug: categories.slug,
	description: categories.description,
	createdByUserId: categories.createdByUserId,
	updatedByUserId: categories.updatedByUserId,
	createdAt: categories.createdAt,
	updatedAt: categories.updatedAt,
	deletedAt: categories.deletedAt
} as const;

const eventTagSelect = {
	id: tags.id,
	tenantId: tags.tenantId,
	name: tags.name,
	slug: tags.slug,
	description: tags.description,
	createdByUserId: tags.createdByUserId,
	updatedByUserId: tags.updatedByUserId,
	createdAt: tags.createdAt,
	updatedAt: tags.updatedAt,
	deletedAt: tags.deletedAt
} as const;

const UUID_FILTER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function collectUniqueValues(...values: Array<Array<string> | undefined>) {
	return [...new Set(values.flatMap((value) => value ?? []).filter((value) => value.trim().length > 0).map((value) => value.trim()))];
}

function normalizeEventSlugFilters(input: Pick<EventListQuery, 'category' | 'categories' | 'tag' | 'tags'>) {
	return {
		categorySlugs: collectUniqueValues(input.category, input.categories),
		tagSlugs: collectUniqueValues(input.tag, input.tags)
	};
}

async function resolveCategoryIdsBySlugs(database: EventsDatabase, tenantId: string, slugs: string[]) {
	if (slugs.length === 0) {
		return [];
	}

	const rows = await database
		.select({ id: categories.id, slug: categories.slug })
		.from(categories)
		.where(
			and(
				eq(categories.tenantId, tenantId),
				isNull(categories.deletedAt),
				or(
					...slugs.map((value) =>
						or(
							...(UUID_FILTER_PATTERN.test(value) ? [eq(categories.id, value)] : []),
							eq(categories.slug, value),
							ilike(categories.name, value),
							ilike(categories.slug, value)
						)
					)
				)
			)
		);

	return rows.map((row) => row.id);
}

async function resolveTagIdsBySlugs(database: EventsDatabase, tenantId: string, slugs: string[]) {
	if (slugs.length === 0) {
		return [];
	}

	const rows = await database
		.select({ id: tags.id, slug: tags.slug })
		.from(tags)
		.where(
			and(
				eq(tags.tenantId, tenantId),
				isNull(tags.deletedAt),
				or(
					...slugs.map((value) =>
						or(
							...(UUID_FILTER_PATTERN.test(value) ? [eq(tags.id, value)] : []),
							eq(tags.slug, value),
							ilike(tags.name, value),
							ilike(tags.slug, value)
						)
					)
				)
			)
		);

	return rows.map((row) => row.id);
}

async function resolveEventListFilters(database: EventsDatabase, tenantId: string, input: EventListQuery) {
	const { categorySlugs, tagSlugs } = normalizeEventSlugFilters(input);
	const categoryIds = collectUniqueValues(
		input.categoryId ? [input.categoryId] : undefined,
		await resolveCategoryIdsBySlugs(database, tenantId, categorySlugs)
	);
	const tagIds = collectUniqueValues(input.tagId ? [input.tagId] : undefined, await resolveTagIdsBySlugs(database, tenantId, tagSlugs));

	return {
		categoryIds,
		tagIds,
		hasCategoryFilter: input.categoryId !== undefined || categorySlugs.length > 0,
		hasTagFilter: input.tagId !== undefined || tagSlugs.length > 0
	};
}

function resolveEventOrderBy(input: Pick<EventListQuery, 'sortBy' | 'sortOrder' | 'featuredFirst'>) {
	const direction = input.sortOrder === 'desc' ? desc : asc;
	const featuredPrefix = input.featuredFirst ? [desc(events.isFeatured)] : [];

	switch (input.sortBy) {
		case 'createdAt':
			return [...featuredPrefix, direction(events.createdAt), asc(events.slug)];
		case 'updatedAt':
			return [...featuredPrefix, direction(events.updatedAt), asc(events.slug)];
		case 'endDateTime':
			return [...featuredPrefix, direction(events.endDateTime), asc(events.slug)];
		case 'publishedAt':
			return [...featuredPrefix, direction(events.publishedAt), asc(events.slug)];
		case 'title':
			return [...featuredPrefix, direction(events.title), asc(events.slug)];
		case 'popularity':
			return [desc(events.isFeatured), desc(events.publishedAt), desc(events.startDateTime), desc(events.createdAt), asc(events.slug)];
		case 'startDateTime':
		default:
			return [...featuredPrefix, direction(events.startDateTime), asc(events.slug)];
	}
}

function buildEventWhereClause(tenantId: string, input: EventListQuery, resolvedFilters: { categoryIds: string[]; tagIds: string[]; hasCategoryFilter: boolean; hasTagFilter: boolean; }) {
	const conditions = [eq(events.tenantId, tenantId), isNull(events.deletedAt)];

	if (input.status) {
		conditions.push(eq(events.status, input.status));
	}

	if (input.visibility) {
		conditions.push(eq(events.visibility, input.visibility));
	}

	if (input.venueId) {
		conditions.push(eq(events.venueId, input.venueId));
	}

	if (resolvedFilters.hasCategoryFilter) {
		if (resolvedFilters.categoryIds.length === 0) {
			conditions.push(sql`false`);
		} else {
			conditions.push(inArray(events.categoryId, resolvedFilters.categoryIds));
		}
	}

	if (input.isFeatured !== undefined) {
		conditions.push(eq(events.isFeatured, input.isFeatured));
	}

	if (input.upcoming) {
		conditions.push(gt(events.startDateTime, new Date()));
	}

	if (input.live) {
		const now = new Date();
		conditions.push(and(lte(events.startDateTime, now), gte(events.endDateTime, now))!);
	}

	if (input.past) {
		conditions.push(lt(events.endDateTime, new Date()));
	}

	if (input.startDate) {
		conditions.push(gte(events.startDateTime, new Date(`${input.startDate}T00:00:00.000Z`)));
	}

	if (input.endDate) {
		conditions.push(lte(events.endDateTime, new Date(`${input.endDate}T23:59:59.999Z`)));
	}

	if (input.search) {
		const search = `%${input.search}%`;
		conditions.push(
			or(
				ilike(events.title, search),
				ilike(events.shortDescription, search),
				ilike(events.description, search),
				ilike(venues.city, search),
				ilike(artists.stageName, search)
			)!
		);
	}

	if (input.city) {
		conditions.push(eq(venues.city, input.city));
	}

	if (resolvedFilters.hasTagFilter) {
		if (resolvedFilters.tagIds.length === 0) {
			conditions.push(sql`false`);
		} else {
			conditions.push(inArray(eventTags.tagId, resolvedFilters.tagIds));
		}
	}

	return and(...conditions);
}

export async function findEventByTenantAndSlug(database: EventsDatabase, tenantId: string, slug: string) {
	const [event] = await database
		.select(eventSelect)
		.from(events)
		.leftJoin(venues, and(eq(venues.id, events.venueId), eq(venues.tenantId, tenantId), isNull(venues.deletedAt)))
		.where(and(eq(events.tenantId, tenantId), eq(events.slug, slug), isNull(events.deletedAt)))
		.limit(1);

	return event ?? null;
}

export async function findEventByTenantAndId(database: EventsDatabase, tenantId: string, id: string) {
	const [event] = await database
		.select(eventSelect)
		.from(events)
		.leftJoin(venues, and(eq(venues.id, events.venueId), eq(venues.tenantId, tenantId), isNull(venues.deletedAt)))
		.where(and(eq(events.tenantId, tenantId), eq(events.id, id), isNull(events.deletedAt)))
		.limit(1);

	return event ?? null;
}

export async function createEventRecord(
	database: EventsDatabase,
	input: Omit<CreateEventDTO, 'publishedAt'> & {
		tenantId: string;
		slug: string;
		createdByUserId: string;
		publishedAt: Date | null;
		organizerId?: string | null;
	}
) {
	const [event] = await database
		.insert(events)
		.values({
			tenantId: input.tenantId,
			venueId: input.venueId ?? null,
			categoryId: input.categoryId ?? null,
			eventSeriesId: input.eventSeriesId ?? null,
			title: input.title,
			slug: input.slug,
			shortDescription: input.shortDescription ?? null,
			description: input.description ?? null,
			startDateTime: new Date(input.startDateTime),
			endDateTime: new Date(input.endDateTime),
			timezone: input.timezone,
			bannerAssetId: input.bannerAssetId ?? null,
			thumbnailAssetId: input.thumbnailAssetId ?? null,
			organizerId: input.organizerId ?? null,
			maxCapacity: input.maxCapacity ?? null,
			status: input.status,
			visibility: input.visibility,
			publishedAt: input.publishedAt,
			isFeatured: input.isFeatured,
			metaTitle: input.metaTitle ?? null,
			metaDescription: input.metaDescription ?? null,
			termsAndConditions: input.termsAndConditions ?? null,
			cancellationPolicy: input.cancellationPolicy ?? null,
			faq: input.faq ?? null,
			createdByUserId: input.createdByUserId,
			updatedByUserId: input.createdByUserId
		})
		.returning(eventCoreSelect);

	return event ?? null;
}

export async function updateEventRecord(
	database: EventsDatabase,
	tenantId: string,
	slug: string,
	input: Omit<UpdateEventDTO, 'publishedAt'> & {
		updatedByUserId: string;
		publishedAt: Date | null | undefined;
		lastKnownUpdatedAt: string;
	}
) {
	const [event] = await database
		.update(events)
		.set({
			...(input.venueId === undefined ? {} : { venueId: input.venueId }),
			...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
			...(input.eventSeriesId === undefined ? {} : { eventSeriesId: input.eventSeriesId }),
			...(input.title === undefined ? {} : { title: input.title }),
			...(input.shortDescription === undefined ? {} : { shortDescription: input.shortDescription }),
			...(input.description === undefined ? {} : { description: input.description }),
			...(input.startDateTime === undefined ? {} : { startDateTime: new Date(input.startDateTime) }),
			...(input.endDateTime === undefined ? {} : { endDateTime: new Date(input.endDateTime) }),
			...(input.timezone === undefined ? {} : { timezone: input.timezone }),
			...(input.bannerAssetId === undefined ? {} : { bannerAssetId: input.bannerAssetId }),
			...(input.thumbnailAssetId === undefined ? {} : { thumbnailAssetId: input.thumbnailAssetId }),
			...(input.maxCapacity === undefined ? {} : { maxCapacity: input.maxCapacity }),
			...(input.status === undefined ? {} : { status: input.status }),
			...(input.visibility === undefined ? {} : { visibility: input.visibility }),
			...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
			...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured }),
			...(input.metaTitle === undefined ? {} : { metaTitle: input.metaTitle }),
			...(input.metaDescription === undefined ? {} : { metaDescription: input.metaDescription }),
			...(input.termsAndConditions === undefined ? {} : { termsAndConditions: input.termsAndConditions }),
			...(input.cancellationPolicy === undefined ? {} : { cancellationPolicy: input.cancellationPolicy }),
			...(input.faq === undefined ? {} : { faq: input.faq }),
			updatedByUserId: input.updatedByUserId,
			updatedAt: new Date()
		})
		.where(and(eq(events.tenantId, tenantId), eq(events.slug, slug), optimisticLockCondition(events.updatedAt, input.lastKnownUpdatedAt), isNull(events.deletedAt)))
		.returning(eventCoreSelect);

	return event ?? null;
}

export async function softDeleteEventRecord(
	database: EventsDatabase,
	tenantId: string,
	slug: string,
	updatedByUserId: string,
	lastKnownUpdatedAt: string
) {
	const [event] = await database
		.update(events)
		.set({
			updatedByUserId,
			updatedAt: new Date(),
			deletedAt: new Date()
		})
		.where(and(eq(events.tenantId, tenantId), eq(events.slug, slug), optimisticLockCondition(events.updatedAt, lastKnownUpdatedAt), isNull(events.deletedAt)))
		.returning(eventCoreSelect);

	return event ?? null;
}

export async function listEventsForTenant(
	database: EventsDatabase,
	tenantId: string,
	input: EventListQuery,
	pagination: { offset: number; limit: number }
) {
	const resolvedFilters = await resolveEventListFilters(database, tenantId, input);
	const whereClause = buildEventWhereClause(tenantId, input, resolvedFilters);
	const orderBy = resolveEventOrderBy(input);

	const [totalRow] = await database
		.select({ total: sql<number>`count(distinct ${events.id})` })
		.from(events)
		.leftJoin(venues, and(eq(venues.id, events.venueId), eq(venues.tenantId, tenantId), isNull(venues.deletedAt)))
		.leftJoin(eventTags, and(eq(eventTags.eventId, events.id), eq(eventTags.tenantId, tenantId)))
		.leftJoin(eventArtists, and(eq(eventArtists.eventId, events.id), eq(eventArtists.tenantId, tenantId)))
		.leftJoin(artists, and(eq(artists.id, eventArtists.artistId), eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
		.where(whereClause);

	const rows = await database
		.select(eventSelect)
		.from(events)
		.leftJoin(venues, and(eq(venues.id, events.venueId), eq(venues.tenantId, tenantId), isNull(venues.deletedAt)))
		.leftJoin(eventTags, and(eq(eventTags.eventId, events.id), eq(eventTags.tenantId, tenantId)))
		.leftJoin(eventArtists, and(eq(eventArtists.eventId, events.id), eq(eventArtists.tenantId, tenantId)))
		.leftJoin(artists, and(eq(artists.id, eventArtists.artistId), eq(artists.tenantId, tenantId), isNull(artists.deletedAt)))
		.where(whereClause)
		.groupBy(
			events.id,
			events.tenantId,
			events.venueId,
			events.categoryId,
			events.eventSeriesId,
			events.title,
			events.slug,
			events.shortDescription,
			events.description,
			events.startDateTime,
			events.endDateTime,
			events.timezone,
			events.bannerAssetId,
			events.thumbnailAssetId,
			events.maxCapacity,
			events.status,
			events.visibility,
			events.publishedAt,
			events.isFeatured,
			events.metaTitle,
			events.metaDescription,
			events.termsAndConditions,
			events.cancellationPolicy,
			events.createdByUserId,
			events.updatedByUserId,
			events.createdAt,
			events.updatedAt,
			events.deletedAt,
			venues.city
		)
		.orderBy(...orderBy)
		.limit(pagination.limit)
		.offset(pagination.offset);

	return {
		rows: rows as Array<EventRecord & { venueCity: string | null }>,
		total: Number(totalRow?.total ?? 0)
	};
}

export async function findTagsByEventIds(database: EventsDatabase, tenantId: string, eventIds: string[]) {
	if (eventIds.length === 0) {
		return [] as Array<{ eventId: string; tag: EventTagListItem }>;
	}

	const rows = await database
		.select({
			eventId: eventTags.eventId,
			id: tags.id,
			tenantId: tags.tenantId,
			name: tags.name,
			slug: tags.slug
		})
		.from(eventTags)
		.innerJoin(tags, and(eq(tags.id, eventTags.tagId), eq(tags.tenantId, tenantId), isNull(tags.deletedAt)))
		.where(and(eq(eventTags.tenantId, tenantId), inArray(eventTags.eventId, eventIds)));

	return rows.map((row) => ({
		eventId: row.eventId,
		tag: {
			id: row.id,
			tenantId: row.tenantId,
			name: row.name,
			slug: row.slug
		}
	}));
}

export async function replaceEventTags(database: EventsDatabase, tenantId: string, eventId: string, tagIds: string[]) {
	await database
		.delete(eventTags)
		.where(and(eq(eventTags.tenantId, tenantId), eq(eventTags.eventId, eventId)));

	if (tagIds.length === 0) {
		return;
	}

	await database.insert(eventTags).values(tagIds.map((tagId) => ({ tenantId, eventId, tagId })));
}

export async function findVenueByIdForTenant(database: EventsDatabase, tenantId: string, venueId: string) {
	const [venue] = await database
		.select({ id: venues.id })
		.from(venues)
		.where(and(eq(venues.id, venueId), eq(venues.tenantId, tenantId), isNull(venues.deletedAt)))
		.limit(1);

	return venue ?? null;
}

export async function findCategoryByIdForTenant(database: EventsDatabase, tenantId: string, categoryId: string) {
	const [category] = await database
		.select({ id: categories.id })
		.from(categories)
		.where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
		.limit(1);

	return category ?? null;
}

export async function findSeriesByIdForTenant(database: EventsDatabase, tenantId: string, seriesId: string) {
	const [series] = await database
		.select({ id: eventSeries.id })
		.from(eventSeries)
		.where(and(eq(eventSeries.id, seriesId), eq(eventSeries.tenantId, tenantId), isNull(eventSeries.deletedAt)))
		.limit(1);

	return series ?? null;
}

export async function findTagsByIdsForTenant(database: EventsDatabase, tenantId: string, tagIds: string[]) {
	if (tagIds.length === 0) {
		return [];
	}

	return database
		.select({ id: tags.id })
		.from(tags)
		.where(and(eq(tags.tenantId, tenantId), isNull(tags.deletedAt), inArray(tags.id, tagIds)));
}

export async function findEventCategoryByTenantAndSlug(database: EventsDatabase, tenantId: string, slug: string) {
	const [category] = await database
		.select(eventCategorySelect)
		.from(categories)
		.where(and(eq(categories.tenantId, tenantId), eq(categories.slug, slug), isNull(categories.deletedAt)))
		.limit(1);

	return category ?? null;
}

export async function listEventCategoriesForTenant(
	database: EventsDatabase,
	tenantId: string,
	input: ListEventCategoriesQuery,
	pagination: { offset: number; limit: number }
) {
	const whereClause = and(
		eq(categories.tenantId, tenantId),
		isNull(categories.deletedAt),
		input.search
			? or(ilike(categories.name, `%${input.search}%`), ilike(categories.slug, `%${input.search}%`), ilike(categories.description, `%${input.search}%`))
			: undefined
	);

	const [totalRow] = await database
		.select({ total: sql<number>`count(*)` })
		.from(categories)
		.where(whereClause);

	const rows = await database
		.select(eventCategorySelect)
		.from(categories)
		.where(whereClause)
		.orderBy(asc(categories.name), asc(categories.slug))
		.limit(pagination.limit)
		.offset(pagination.offset);

	return {
		rows: rows as EventCategoryRecord[],
		total: Number(totalRow?.total ?? 0)
	};
}

export async function createEventCategoryRecord(
	database: EventsDatabase,
	input: CreateEventCategoryDTO & { tenantId: string; slug: string; actorUserId: string }
) {
	const [category] = await database
		.insert(categories)
		.values({
			tenantId: input.tenantId,
			name: input.name,
			slug: input.slug,
			description: input.description ?? null,
			createdByUserId: input.actorUserId,
			updatedByUserId: input.actorUserId
		})
		.returning(eventCategorySelect);

	return category ?? null;
}

export async function findEventTagByTenantAndSlug(database: EventsDatabase, tenantId: string, slug: string) {
	const [tag] = await database
		.select(eventTagSelect)
		.from(tags)
		.where(and(eq(tags.tenantId, tenantId), eq(tags.slug, slug), isNull(tags.deletedAt)))
		.limit(1);

	return tag ?? null;
}

export async function listEventTagsForTenant(
	database: EventsDatabase,
	tenantId: string,
	input: ListEventTagsQuery,
	pagination: { offset: number; limit: number }
) {
	const whereClause = and(
		eq(tags.tenantId, tenantId),
		isNull(tags.deletedAt),
		input.search ? or(ilike(tags.name, `%${input.search}%`), ilike(tags.slug, `%${input.search}%`), ilike(tags.description, `%${input.search}%`)) : undefined
	);

	const [totalRow] = await database
		.select({ total: sql<number>`count(*)` })
		.from(tags)
		.where(whereClause);

	const rows = await database
		.select(eventTagSelect)
		.from(tags)
		.where(whereClause)
		.orderBy(asc(tags.name), asc(tags.slug))
		.limit(pagination.limit)
		.offset(pagination.offset);

	return {
		rows: rows as EventTagRecord[],
		total: Number(totalRow?.total ?? 0)
	};
}

export async function createEventTagRecord(
	database: EventsDatabase,
	input: CreateEventTagDTO & { tenantId: string; slug: string; actorUserId: string }
) {
	const [tag] = await database
		.insert(tags)
		.values({
			tenantId: input.tenantId,
			name: input.name,
			slug: input.slug,
			description: input.description ?? null,
			createdByUserId: input.actorUserId,
			updatedByUserId: input.actorUserId
		})
		.returning(eventTagSelect);

	return tag ?? null;
}

export async function findEventSeriesByTenantAndSlug(database: EventsDatabase, tenantId: string, slug: string) {
	const [series] = await database
		.select(eventSeriesSelect)
		.from(eventSeries)
		.where(and(eq(eventSeries.tenantId, tenantId), eq(eventSeries.slug, slug), isNull(eventSeries.deletedAt)))
		.limit(1);

	return series ?? null;
}

export async function listEventSeriesForTenant(
	database: EventsDatabase,
	tenantId: string,
	input: ListEventSeriesQuery,
	pagination: { offset: number; limit: number }
) {
	const whereClause = and(
		eq(eventSeries.tenantId, tenantId),
		isNull(eventSeries.deletedAt),
		input.search
			? or(
					ilike(eventSeries.title, `%${input.search}%`),
					ilike(eventSeries.slug, `%${input.search}%`),
					ilike(eventSeries.description, `%${input.search}%`)
				)
			: undefined,
		input.isActive === undefined ? undefined : eq(eventSeries.isActive, input.isActive)
	);

	const [totalRow] = await database
		.select({ total: sql<number>`count(*)` })
		.from(eventSeries)
		.where(whereClause);

	const rows = await database
		.select(eventSeriesSelect)
		.from(eventSeries)
		.where(whereClause)
		.orderBy(desc(eventSeries.createdAt), asc(eventSeries.slug))
		.limit(pagination.limit)
		.offset(pagination.offset);

	return {
		rows: rows as EventSeriesRecord[],
		total: Number(totalRow?.total ?? 0)
	};
}

export async function createEventSeriesRecord(
	database: EventsDatabase,
	input: CreateEventSeriesDTO & { tenantId: string; slug: string; actorUserId: string }
) {
	const [series] = await database
		.insert(eventSeries)
		.values({
			tenantId: input.tenantId,
			title: input.title,
			slug: input.slug,
			description: input.description ?? null,
			timezone: input.timezone,
			startDateTime: input.startDateTime ? new Date(input.startDateTime) : null,
			endDateTime: input.endDateTime ? new Date(input.endDateTime) : null,
			isActive: input.isActive ?? true,
			createdByUserId: input.actorUserId,
			updatedByUserId: input.actorUserId
		})
		.returning(eventSeriesSelect);

	return series ?? null;
}