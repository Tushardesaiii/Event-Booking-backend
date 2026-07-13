import { inArray, eq, desc, and, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { assets } from '../../db/schema/assets.js';
import { artists, eventArtists } from '../../db/schema/artist.js';
import { eventDates } from '../../db/schema/event-dates.js';
import { organizers } from '../organizer-profiles/schema.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { marketingHooks } from '../marketing/hooks.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { createSlug, createUniqueSlug } from '../../lib/slug.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { insertWithSlugRetry } from '../../lib/slug-write.js';
import { canManageEvents, canViewEvents } from '../../policies/event.policy.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import {
	createEventCategoryRecord,
	createEventRecord,
	createEventSeriesRecord,
	createEventTagRecord,
	findCategoryByIdForTenant,
	findEventByTenantAndId,
	findEventByTenantAndSlug,
	findEventCategoryByTenantAndSlug,
	findEventSeriesByTenantAndSlug,
	findEventTagByTenantAndSlug,
	findSeriesByIdForTenant,
	findTagsByEventIds,
	findTagsByIdsForTenant,
	findVenueByIdForTenant,
	listEventCategoriesForTenant,
	listEventsForTenant,
	listEventSeriesForTenant,
	listEventTagsForTenant,
	replaceEventTags,
	softDeleteEventRecord,
	updateEventRecord
} from './repository.js';
import type {
	CreateEventCategoryDTO,
	CreateEventDTO,
	CreateEventSeriesDTO,
	CreateEventTagDTO,
	EventCategoryRecord,
	EventDetailItem,
	EventListItem,
	EventListQuery,
	EventSeriesRecord,
	EventTagRecord,
	ListEventCategoriesQuery,
	ListEventSeriesQuery,
	ListEventTagsQuery,
	UpdateEventDTO
} from './types.js';

function assertEventManagementAccess(membership: TenantMembershipRecord) {
	if (!canManageEvents(membership.role)) {
		throw forbidden('Insufficient event permissions');
	}
}

function assertEventReadAccess(membership: TenantMembershipRecord) {
	if (!canViewEvents(membership.role)) {
		throw forbidden('Insufficient event permissions');
	}
}

function normalizeSlugOrThrow(value: string) {
	const normalized = createSlug(value);

	if (!normalized) {
		throw badRequest('Invalid slug value');
	}

	return normalized;
}

async function assertEventReferencesBelongToTenant(
	tenantId: string,
	input: Pick<CreateEventDTO | UpdateEventDTO, 'venueId' | 'categoryId' | 'eventSeriesId' | 'tagIds'>
) {
	if (input.venueId !== undefined && input.venueId !== null) {
		const venue = await findVenueByIdForTenant(db, tenantId, input.venueId);

		if (!venue) {
			throw badRequest('Invalid venueId for tenant');
		}
	}

	if (input.categoryId !== undefined && input.categoryId !== null) {
		const category = await findCategoryByIdForTenant(db, tenantId, input.categoryId);

		if (!category) {
			throw badRequest('Invalid categoryId for tenant');
		}
	}

	if (input.eventSeriesId !== undefined && input.eventSeriesId !== null) {
		const series = await findSeriesByIdForTenant(db, tenantId, input.eventSeriesId);

		if (!series) {
			throw badRequest('Invalid eventSeriesId for tenant');
		}
	}

	if (input.tagIds !== undefined) {
		const dedupedTagIds = [...new Set(input.tagIds)];
		const existingTags = await findTagsByIdsForTenant(db, tenantId, dedupedTagIds);

		if (existingTags.length !== dedupedTagIds.length) {
			throw badRequest('One or more tagIds do not belong to the tenant');
		}
	}
}

// Resolve banner/thumbnail asset ids to public (CDN) URLs so the dashboard can
// render images directly. Batched to a single lookup across the result set.
async function attachImageUrls<T extends { bannerAssetId: string | null; thumbnailAssetId: string | null }>(
	rows: T[]
): Promise<Array<T & { bannerUrl: string | null; thumbnailUrl: string | null; images: string[] }>> {
	const ids = [
		...new Set(
			rows.flatMap((r) => [r.bannerAssetId, r.thumbnailAssetId]).filter((id): id is string => !!id)
		)
	];

	const keyById = new Map<string, string>();
	if (ids.length > 0) {
		const found = await db.select({ id: assets.id, key: assets.key }).from(assets).where(inArray(assets.id, ids));
		for (const a of found) keyById.set(a.id, a.key);
	}

	const toUrl = (id: string | null) => {
		const key = id ? keyById.get(id) : undefined;
		return key ? cloudflareCdnService.buildPublicUrl(key) : null;
	};

	return rows.map((row) => {
		const bannerUrl = toUrl(row.bannerAssetId);
		const thumbnailUrl = toUrl(row.thumbnailAssetId);
		return {
			...row,
			bannerUrl,
			thumbnailUrl,
			images: [bannerUrl, thumbnailUrl].filter((u): u is string => !!u)
		};
	});
}

function resolvePublishedAt(status: CreateEventDTO['status'], publishedAt?: string | null) {
	if (status !== 'published') {
		return null;
	}

	return publishedAt ? new Date(publishedAt) : new Date();
}

function attachEventTags<T extends { id: string }>(
	rows: T[],
	tagRows: Array<{ eventId: string; tag: { id: string; tenantId: string; name: string; slug: string } }>
) {
	const tagsByEventId = new Map<string, Array<{ id: string; tenantId: string; name: string; slug: string }>>();

	for (const row of tagRows) {
		const existing = tagsByEventId.get(row.eventId) ?? [];
		existing.push(row.tag);
		tagsByEventId.set(row.eventId, existing);
	}

	return rows.map((row) => ({
		...row,
		tags: tagsByEventId.get(row.id) ?? []
	}));
}

// Sync an event's lineup to the given global artist ids. Invalid/deleted ids are
// dropped so a stale picker selection can never fail the whole event write. The
// first id is marked the headliner; order is preserved as displayOrder.
async function replaceEventArtists(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	tenantId: string,
	eventId: string,
	artistIds: string[]
) {
	await tx.delete(eventArtists).where(eq(eventArtists.eventId, eventId));
	const unique = [...new Set(artistIds)];
	if (unique.length === 0) return;
	// Only superadmin-verified artists may be attached to an event. Pending/rejected
	// (or deleted) ids are silently dropped, exactly like stale picker selections.
	const valid = await tx
		.select({ id: artists.id })
		.from(artists)
		.where(and(inArray(artists.id, unique), isNull(artists.deletedAt), eq(artists.verificationStatus, 'verified')));
	const validIds = new Set(valid.map((v) => v.id));
	const rows = unique
		.filter((id) => validIds.has(id))
		.map((artistId, i) => ({ eventId, artistId, tenantId, headline: i === 0, displayOrder: i }));
	if (rows.length) await tx.insert(eventArtists).values(rows);
}

// Sync an event's bookable occurrences. When `dates` is given, each becomes a
// row (order preserved as displayOrder). When omitted, we synthesize a single
// occurrence from the event's own start/end so every event always has ≥1 date.
async function replaceEventDates(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	tenantId: string,
	eventId: string,
	dates: CreateEventDTO['dates'] | undefined,
	fallback: { startDateTime: Date; endDateTime: Date }
) {
	await tx.delete(eventDates).where(eq(eventDates.eventId, eventId));
	const rows =
		dates && dates.length
			? dates.map((d, i) => ({
					tenantId,
					eventId,
					startDateTime: new Date(d.startDateTime),
					endDateTime: new Date(d.endDateTime),
					displayOrder: i
				}))
			: [
					{
						tenantId,
						eventId,
						startDateTime: fallback.startDateTime,
						endDateTime: fallback.endDateTime,
						displayOrder: 0
					}
				];
	await tx.insert(eventDates).values(rows);
}

// The event's overall span is the earliest start → latest end across its dates.
function spanFromDates(dates: CreateEventDTO['dates']) {
	if (!dates || !dates.length) return null;
	const starts = dates.map((d) => new Date(d.startDateTime).getTime());
	const ends = dates.map((d) => new Date(d.endDateTime).getTime());
	return { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
}

export async function createEvent(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	input: CreateEventDTO
) {
	assertEventManagementAccess(actorMembership);
	await assertEventReferencesBelongToTenant(tenantId, input);

	// Link the event to this tenant's organizer profile so the consumer app can
	// show real organizer info. Events have one organizer per tenant; pick the
	// most recent profile. (No-op if the tenant has no organizer yet.)
	const [tenantOrganizer] = await db
		.select({ id: organizers.id })
		.from(organizers)
		.where(eq(organizers.tenantId, tenantId))
		.orderBy(desc(organizers.createdAt))
		.limit(1);
	const organizerId = tenantOrganizer?.id ?? null;

	// If concrete dates were provided, the event's span mirrors their min→max.
	const span = spanFromDates(input.dates);
	const effectiveStart = span ? span.start.toISOString() : input.startDateTime;
	const effectiveEnd = span ? span.end.toISOString() : input.endDateTime;

	const result = await db.transaction(async (tx) => {
		const event = await insertWithSlugRetry(
			(slug) =>
				createEventRecord(tx, {
					...input,
					startDateTime: effectiveStart,
					endDateTime: effectiveEnd,
					tenantId,
					slug,
					organizerId,
					createdByUserId: actorUserId,
					publishedAt: resolvePublishedAt(input.status, input.publishedAt)
				}),
			() => createUniqueSlug(input.slug ?? input.title)
		);

		if (!event) {
			throw conflict('Unable to create event');
		}

		await replaceEventDates(tx, tenantId, event.id, input.dates, {
			startDateTime: new Date(effectiveStart),
			endDateTime: new Date(effectiveEnd)
		});

		const tagIds = [...new Set(input.tagIds ?? [])];
		await replaceEventTags(tx, tenantId, event.id, tagIds);

		if (input.artistIds !== undefined) {
			await replaceEventArtists(tx, tenantId, event.id, input.artistIds);
		}

		const tags = await findTagsByEventIds(tx, tenantId, [event.id]);
		const [withTags] = attachEventTags([event], tags);
		const [withImages] = await attachImageUrls([withTags]);

		return withImages as unknown as EventDetailItem;
	});

	if (result && result.status === 'published') {
		try {
			await marketingHooks.onEventPublished({ id: result.id, name: result.title }, { tenantId });
		} catch (err) {
			// Fail silently or log error to prevent breaking creation flow
		}
	}

	return result;
}

export async function listEvents(tenantId: string, actorMembership: TenantMembershipRecord, input: EventListQuery) {
	assertEventReadAccess(actorMembership);

	const pagination = parsePagination(input);
	const { rows, total } = await listEventsForTenant(db, tenantId, input, pagination);
	const tagRows = await findTagsByEventIds(
		db,
		tenantId,
		rows.map((row) => row.id)
	);

	const withImages = await attachImageUrls(attachEventTags(rows, tagRows));

	return {
		items: withImages as unknown as EventListItem[],
		meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
	};
}

export async function getEventBySlug(tenantId: string, actorMembership: TenantMembershipRecord, slug: string) {
	assertEventReadAccess(actorMembership);

	const normalizedSlug = normalizeSlugOrThrow(slug);
	const event = await findEventByTenantAndSlug(db, tenantId, normalizedSlug);

	if (!event) {
		throw notFound('Event not found');
	}

	const tags = await findTagsByEventIds(db, tenantId, [event.id]);
	const [withTags] = attachEventTags([event], tags);
	const [withImages] = await attachImageUrls([withTags]);

	return withImages as unknown as EventDetailItem;
}

export async function updateEventBySlug(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	slug: string,
	input: UpdateEventDTO
) {
	assertEventManagementAccess(actorMembership);
	await assertEventReferencesBelongToTenant(tenantId, input);

	const normalizedSlug = normalizeSlugOrThrow(slug);

	const existing = await findEventByTenantAndSlug(db, tenantId, normalizedSlug);

	if (!existing) {
		throw notFound('Event not found');
	}

	// When dates are supplied, the event span follows their min→max; otherwise fall
	// back to any provided start/end, else the existing values.
	const span = spanFromDates(input.dates);
	const nextStartDateTime = span
		? span.start
		: input.startDateTime
			? new Date(input.startDateTime)
			: existing.startDateTime;
	const nextEndDateTime = span
		? span.end
		: input.endDateTime
			? new Date(input.endDateTime)
			: existing.endDateTime;

	if (!(nextEndDateTime.getTime() > nextStartDateTime.getTime())) {
		throw badRequest('endDateTime must be after startDateTime');
	}

	const nextStatus = input.status ?? existing.status;
	const publishedAt =
		input.publishedAt !== undefined
			? input.publishedAt === null
				? null
				: new Date(input.publishedAt)
			: nextStatus === 'published'
				? existing.publishedAt ?? new Date()
				: null;

	if (nextStatus !== 'published' && input.publishedAt !== undefined && input.publishedAt !== null) {
		throw badRequest('publishedAt can only be set when status is published');
	}

	const isStatusTransitionToPublished = nextStatus === 'published' && existing.status !== 'published';

	const result = await db.transaction(async (tx) => {
		const updated = await updateEventRecord(tx, tenantId, normalizedSlug, {
			...input,
			// Keep the stored span in lock-step with the supplied dates.
			...(span ? { startDateTime: nextStartDateTime.toISOString(), endDateTime: nextEndDateTime.toISOString() } : {}),
			publishedAt,
			updatedByUserId: actorUserId,
			lastKnownUpdatedAt: input.lastKnownUpdatedAt
		});

		assertOptimisticUpdate(updated);

		if (input.dates !== undefined) {
			await replaceEventDates(tx, tenantId, updated.id, input.dates, {
				startDateTime: nextStartDateTime,
				endDateTime: nextEndDateTime
			});
		}

		if (input.tagIds !== undefined) {
			await replaceEventTags(tx, tenantId, updated.id, [...new Set(input.tagIds)]);
		}

		if (input.artistIds !== undefined) {
			await replaceEventArtists(tx, tenantId, updated.id, input.artistIds);
		}

		const finalEvent = await findEventByTenantAndId(tx, tenantId, updated.id);

		if (!finalEvent) {
			throw notFound('Event not found');
		}

		const tags = await findTagsByEventIds(tx, tenantId, [finalEvent.id]);
		const [withTags] = attachEventTags([finalEvent], tags);
		const [withImages] = await attachImageUrls([withTags]);

		return withImages as unknown as EventDetailItem;
	});

	if (result && isStatusTransitionToPublished) {
		try {
			await marketingHooks.onEventPublished({ id: result.id, name: result.title }, { tenantId });
		} catch (err) {
			// Fail silently or log error
		}
	}

	return result;
}

export async function deleteEventBySlug(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	slug: string,
	lastKnownUpdatedAt: string
) {
	assertEventManagementAccess(actorMembership);

	const normalizedSlug = normalizeSlugOrThrow(slug);
	const deleted = await softDeleteEventRecord(db, tenantId, normalizedSlug, actorUserId, lastKnownUpdatedAt);

	assertOptimisticUpdate(deleted);

	const tags = await findTagsByEventIds(db, tenantId, [deleted.id]);
	const [withTags] = attachEventTags([deleted], tags);

	return withTags as EventDetailItem;
}

export async function createEventCategory(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	input: CreateEventCategoryDTO
) {
	assertEventManagementAccess(actorMembership);

	const category = await insertWithSlugRetry(
		(slug) =>
			createEventCategoryRecord(db, {
				...input,
				tenantId,
				slug,
				actorUserId
			}),
		() => createUniqueSlug(input.slug ?? input.name)
	);

	if (!category) {
		throw conflict('Unable to create event category');
	}

	return category as EventCategoryRecord;
}

export async function listEventCategories(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	input: ListEventCategoriesQuery
) {
	assertEventReadAccess(actorMembership);

	const pagination = parsePagination(input);
	const { rows, total } = await listEventCategoriesForTenant(db, tenantId, input, pagination);

	return {
		items: rows,
		meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
	};
}

export async function createEventTag(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	input: CreateEventTagDTO
) {
	assertEventManagementAccess(actorMembership);

	const tag = await insertWithSlugRetry(
		(slug) =>
			createEventTagRecord(db, {
				...input,
				tenantId,
				slug,
				actorUserId
			}),
		() => createUniqueSlug(input.slug ?? input.name)
	);

	if (!tag) {
		throw conflict('Unable to create event tag');
	}

	return tag as EventTagRecord;
}

export async function listEventTags(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	input: ListEventTagsQuery
) {
	assertEventReadAccess(actorMembership);

	const pagination = parsePagination(input);
	const { rows, total } = await listEventTagsForTenant(db, tenantId, input, pagination);

	return {
		items: rows,
		meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
	};
}

export async function createEventSeries(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	input: CreateEventSeriesDTO
) {
	assertEventManagementAccess(actorMembership);

	const series = await insertWithSlugRetry(
		(slug) =>
			createEventSeriesRecord(db, {
				...input,
				tenantId,
				slug,
				actorUserId
			}),
		() => createUniqueSlug(input.slug ?? input.title)
	);

	if (!series) {
		throw conflict('Unable to create event series');
	}

	return series as EventSeriesRecord;
}

export async function listEventSeries(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	input: ListEventSeriesQuery
) {
	assertEventReadAccess(actorMembership);

	const pagination = parsePagination(input);
	const { rows, total } = await listEventSeriesForTenant(db, tenantId, input, pagination);

	return {
		items: rows,
		meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
	};
}

export async function getEventSeriesBySlug(tenantId: string, actorMembership: TenantMembershipRecord, slug: string) {
	assertEventReadAccess(actorMembership);

	const normalizedSlug = normalizeSlugOrThrow(slug);
	const series = await findEventSeriesByTenantAndSlug(db, tenantId, normalizedSlug);

	if (!series) {
		throw notFound('Event series not found');
	}

	return series as EventSeriesRecord;
}