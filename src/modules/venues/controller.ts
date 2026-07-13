import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { createVenue, deleteVenueBySlug, getVenueBySlug, listVenues, updateVenueBySlug } from './service.js';
import type { CreateVenueDTO, UpdateVenueDTO, VenueListQuery, VenueSlugParams } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
	const tenant = c.get('tenant');
	const membership = c.get('tenantMembership');
	const user = c.get('user');

	if (!tenant || !membership || !user) {
		throw forbidden('Tenant context is required');
	}

	return { tenant, membership, user };
}

export const venuesController = {
	async create(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const input = c.get('validatedBody') as CreateVenueDTO;
		const venue = await createVenue(tenant.id, membership, user.id, input);

		return successResponse(c, venue, 'Venue created', 201);
	},

	async list(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const input = c.get('validatedQuery') as VenueListQuery;
		const result = await listVenues(tenant.id, membership, input);

		return paginatedResponse(c, result.items, result.meta, 'Venues retrieved');
	},

	async getBySlug(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as VenueSlugParams;
		const venue = await getVenueBySlug(tenant.id, membership, slug);

		return successResponse(c, venue, 'Venue retrieved');
	},

	async update(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as VenueSlugParams;
		const input = c.get('validatedBody') as UpdateVenueDTO;
		const venue = await updateVenueBySlug(tenant.id, membership, user.id, slug, input);

		return successResponse(c, venue, 'Venue updated');
	},

	async delete(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as VenueSlugParams;
		const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
		const venue = await deleteVenueBySlug(tenant.id, membership, user.id, slug, lastKnownUpdatedAt);

		return successResponse(c, venue, 'Venue deleted');
	}
};