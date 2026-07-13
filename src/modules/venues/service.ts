import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { createSlug, createUniqueSlug } from '../../lib/slug.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { insertWithSlugRetry } from '../../lib/slug-write.js';
import { canManageVenues, canViewVenues } from '../../policies/venue.policy.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import {
	createVenueRecord,
	deactivateVenueRecord,
	findVenueByTenantAndSlug,
	listVenuesForTenant,
	updateVenueRecord
} from './repository.js';
import type {
	CreateVenueDTO,
	UpdateVenueDTO,
	VenueDetailItem,
	VenueListItem,
	VenueListQuery
} from './types.js';

function assertVenueManagementAccess(membership: TenantMembershipRecord) {
	if (!canManageVenues(membership.role)) {
		throw forbidden('Insufficient venue permissions');
	}
}

function assertVenueReadAccess(membership: TenantMembershipRecord) {
	if (!canViewVenues(membership.role)) {
		throw forbidden('Insufficient venue permissions');
	}
}

function normalizeSlug(slug: string) {
	const normalized = createSlug(slug);

	if (!normalized) {
		throw badRequest('Invalid venue slug');
	}

	return normalized;
}

export async function createVenue(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	input: CreateVenueDTO
) {
	assertVenueManagementAccess(actorMembership);

	return db.transaction(async (tx) => {
		const venue = await insertWithSlugRetry(
			(slug) =>
				createVenueRecord(tx, {
					...input,
					tenantId,
					slug,
					createdByUserId: actorUserId
				}),
			() => createUniqueSlug(input.name)
		);

		if (!venue) {
			throw conflict('Unable to create venue');
		}

		return venue;
	});
}

export async function listVenues(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	input: VenueListQuery
) {
	assertVenueReadAccess(actorMembership);

	const pagination = parsePagination(input);
	const { rows, total } = await listVenuesForTenant(db, tenantId, input, pagination);

	return {
		items: rows as VenueListItem[],
		meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
	};
}

export async function getVenueBySlug(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	slug: string
) {
	assertVenueReadAccess(actorMembership);

	const venue = await findVenueByTenantAndSlug(db, tenantId, normalizeSlug(slug));

	if (!venue) {
		throw notFound('Venue not found');
	}

	return venue as VenueDetailItem;
}

export async function updateVenueBySlug(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	slug: string,
	input: UpdateVenueDTO
) {
	assertVenueManagementAccess(actorMembership);

	const venue = await updateVenueRecord(db, tenantId, normalizeSlug(slug), {
		...input,
		updatedByUserId: actorUserId
	});

	return assertOptimisticUpdate(venue) as VenueDetailItem;
}

export async function deleteVenueBySlug(
	tenantId: string,
	actorMembership: TenantMembershipRecord,
	actorUserId: string,
	slug: string,
	lastKnownUpdatedAt: string
) {
	assertVenueManagementAccess(actorMembership);

	const venue = await deactivateVenueRecord(db, tenantId, normalizeSlug(slug), actorUserId, lastKnownUpdatedAt);

	return assertOptimisticUpdate(venue) as VenueDetailItem;
}