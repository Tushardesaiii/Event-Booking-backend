import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { venues } from '../../db/schema/venues.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
	CreateVenueDTO,
	UpdateVenueDTO,
	VenueListQuery,
	VenueRecord
} from './types.js';

type VenueDatabase = Pick<typeof db, 'select' | 'insert' | 'update'>;

const venueSelect = {
	id: venues.id,
	tenantId: venues.tenantId,
	name: venues.name,
	slug: venues.slug,
	description: venues.description,
	addressLine1: venues.addressLine1,
	addressLine2: venues.addressLine2,
	landmark: venues.landmark,
	city: venues.city,
	state: venues.state,
	country: venues.country,
	postalCode: venues.postalCode,
	latitude: venues.latitude,
	longitude: venues.longitude,
	capacity: venues.capacity,
	contactEmail: venues.contactEmail,
	contactPhone: venues.contactPhone,
	website: venues.website,
	coverAssetId: venues.coverAssetId,
	isActive: venues.isActive,
	isVerified: venues.isVerified,
	createdByUserId: venues.createdByUserId,
	updatedByUserId: venues.updatedByUserId,
	createdAt: venues.createdAt,
	updatedAt: venues.updatedAt,
	deletedAt: venues.deletedAt
} as const;

function buildVenueWhereClause(
	tenantId: string,
	input: Pick<VenueListQuery, 'search' | 'city' | 'isActive'>
) {
	const conditions = [eq(venues.tenantId, tenantId), isNull(venues.deletedAt)];

	if (input.city) {
		conditions.push(eq(venues.city, input.city));
	}

	if (input.isActive !== undefined) {
		conditions.push(eq(venues.isActive, input.isActive));
	}

	if (input.search) {
		const search = `%${input.search}%`;
		conditions.push(
			or(
				ilike(venues.name, search),
				ilike(venues.slug, search),
				ilike(venues.description, search),
				ilike(venues.addressLine1, search),
				ilike(venues.addressLine2, search),
				ilike(venues.landmark, search),
				ilike(venues.city, search),
				ilike(venues.state, search),
				ilike(venues.country, search),
				ilike(venues.postalCode, search)
			)!
		);
	}

	return and(...conditions);
}

function resolveVenueSortOrder(input: Pick<VenueListQuery, 'sortBy' | 'sortOrder'>) {
	const direction = input.sortOrder === 'asc' ? asc : desc;

	switch (input.sortBy) {
		case 'name':
			return [direction(venues.name), asc(venues.slug)];
		case 'city':
			return [direction(venues.city), asc(venues.name), asc(venues.slug)];
		case 'capacity':
			return [direction(venues.capacity), asc(venues.name), asc(venues.slug)];
		case 'updatedAt':
			return [direction(venues.updatedAt), desc(venues.createdAt), asc(venues.slug)];
		case 'isActive':
			return [direction(venues.isActive), desc(venues.createdAt), asc(venues.slug)];
		case 'isVerified':
			return [direction(venues.isVerified), desc(venues.createdAt), asc(venues.slug)];
		case 'createdAt':
		default:
			return [direction(venues.createdAt), asc(venues.name), asc(venues.slug)];
	}
}

export async function findVenueByTenantAndSlug(database: VenueDatabase, tenantId: string, slug: string) {
	const [venue] = await database
		.select(venueSelect)
		.from(venues)
		.where(and(eq(venues.tenantId, tenantId), eq(venues.slug, slug), isNull(venues.deletedAt)))
		.limit(1);

	return venue ?? null;
}

export async function createVenueRecord(
	database: VenueDatabase,
	input: CreateVenueDTO & { tenantId: string; slug: string; createdByUserId: string }
) {
	const [venue] = await database
		.insert(venues)
		.values({
			tenantId: input.tenantId,
			name: input.name,
			slug: input.slug,
			description: input.description ?? null,
			addressLine1: input.addressLine1,
			addressLine2: input.addressLine2 ?? null,
			landmark: input.landmark ?? null,
			city: input.city,
			state: input.state,
			country: input.country,
			postalCode: input.postalCode ?? null,
			latitude: input.latitude === undefined || input.latitude === null ? null : String(input.latitude),
			longitude: input.longitude === undefined || input.longitude === null ? null : String(input.longitude),
			capacity: input.capacity ?? null,
			contactEmail: input.contactEmail ?? null,
			contactPhone: input.contactPhone ?? null,
			website: input.website ?? null,
			coverAssetId: input.coverAssetId ?? null,
			isActive: input.isActive ?? true,
			isVerified: input.isVerified ?? false,
			createdByUserId: input.createdByUserId,
			updatedByUserId: input.createdByUserId
		})
		.returning(venueSelect);

	return venue ?? null;
}

export async function updateVenueRecord(
	database: VenueDatabase,
	tenantId: string,
	slug: string,
	input: UpdateVenueDTO & { updatedByUserId: string }
) {
	const [venue] = await database
		.update(venues)
		.set({
			...(input.name === undefined ? {} : { name: input.name }),
			...(input.description === undefined ? {} : { description: input.description ?? null }),
			...(input.addressLine1 === undefined ? {} : { addressLine1: input.addressLine1 }),
			...(input.addressLine2 === undefined ? {} : { addressLine2: input.addressLine2 ?? null }),
			...(input.landmark === undefined ? {} : { landmark: input.landmark ?? null }),
			...(input.city === undefined ? {} : { city: input.city }),
			...(input.state === undefined ? {} : { state: input.state }),
			...(input.country === undefined ? {} : { country: input.country }),
			...(input.postalCode === undefined ? {} : { postalCode: input.postalCode ?? null }),
			...(input.latitude === undefined
				? {}
				: { latitude: input.latitude === null ? null : String(input.latitude) }),
			...(input.longitude === undefined
				? {}
				: { longitude: input.longitude === null ? null : String(input.longitude) }),
			...(input.capacity === undefined ? {} : { capacity: input.capacity ?? null }),
			...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail ?? null }),
			...(input.contactPhone === undefined ? {} : { contactPhone: input.contactPhone ?? null }),
			...(input.website === undefined ? {} : { website: input.website ?? null }),
			...(input.coverAssetId === undefined ? {} : { coverAssetId: input.coverAssetId ?? null }),
			...(input.isActive === undefined ? {} : { isActive: input.isActive }),
			...(input.isVerified === undefined ? {} : { isVerified: input.isVerified }),
			updatedByUserId: input.updatedByUserId,
			updatedAt: new Date()
		})
		.where(and(eq(venues.tenantId, tenantId), eq(venues.slug, slug), optimisticLockCondition(venues.updatedAt, input.lastKnownUpdatedAt), isNull(venues.deletedAt)))
		.returning(venueSelect);

	return venue ?? null;
}

export async function deactivateVenueRecord(
	database: VenueDatabase,
	tenantId: string,
	slug: string,
	updatedByUserId: string,
	lastKnownUpdatedAt: string
) {
	const [venue] = await database
		.update(venues)
		.set({
			isActive: false,
			updatedByUserId,
			updatedAt: new Date(),
			deletedAt: new Date()
		})
		.where(and(eq(venues.tenantId, tenantId), eq(venues.slug, slug), optimisticLockCondition(venues.updatedAt, lastKnownUpdatedAt), isNull(venues.deletedAt)))
		.returning(venueSelect);

	return venue ?? null;
}

export async function listVenuesForTenant(
	database: VenueDatabase,
	tenantId: string,
	input: VenueListQuery,
	pagination: { offset: number; limit: number }
) {
	const whereClause = buildVenueWhereClause(tenantId, input);
	const orderBy = resolveVenueSortOrder(input);

	const [totalRow] = await database
		.select({ total: sql<number>`count(*)` })
		.from(venues)
		.where(whereClause);

	const rows = await database
		.select(venueSelect)
		.from(venues)
		.where(whereClause)
		.orderBy(...orderBy)
		.limit(pagination.limit)
		.offset(pagination.offset);

	return {
		rows: rows as VenueRecord[],
		total: Number(totalRow?.total ?? 0)
	};
}