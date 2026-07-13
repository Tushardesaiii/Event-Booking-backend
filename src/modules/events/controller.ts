import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
	createEvent,
	createEventCategory,
	createEventSeries,
	createEventTag,
	deleteEventBySlug,
	getEventBySlug,
	getEventSeriesBySlug,
	listEventCategories,
	listEvents,
	listEventSeries,
	listEventTags,
	updateEventBySlug
} from './service.js';
import type {
	CreateEventCategoryDTO,
	CreateEventDTO,
	CreateEventSeriesDTO,
	CreateEventTagDTO,
	EventListQuery,
	EventSeriesSlugParams,
	EventSlugParams,
	ListEventCategoriesQuery,
	ListEventSeriesQuery,
	ListEventTagsQuery,
	UpdateEventDTO
} from './types.js';

function getTenantContext(c: Context<AppEnv>) {
	const tenant = c.get('tenant');
	const membership = c.get('tenantMembership');
	const user = c.get('user');

	if (!tenant || !membership || !user) {
		throw forbidden('Tenant context is required');
	}

	return { tenant, membership, user };
}

export const eventsController = {
	async create(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const input = c.get('validatedBody') as CreateEventDTO;
		const event = await createEvent(tenant.id, membership, user.id, input);

		return successResponse(c, event, 'Event created', 201);
	},

	async list(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const input = c.get('validatedQuery') as EventListQuery;
		const result = await listEvents(tenant.id, membership, input);

		return paginatedResponse(c, result.items, result.meta, 'Events retrieved');
	},

	async getBySlug(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as EventSlugParams;
		const event = await getEventBySlug(tenant.id, membership, slug);

		return successResponse(c, event, 'Event retrieved');
	},

	async update(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as EventSlugParams;
		const input = c.get('validatedBody') as UpdateEventDTO;
		const event = await updateEventBySlug(tenant.id, membership, user.id, slug, input);

		return successResponse(c, event, 'Event updated');
	},

	async delete(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as EventSlugParams;
		const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
		const event = await deleteEventBySlug(tenant.id, membership, user.id, slug, lastKnownUpdatedAt);

		return successResponse(c, event, 'Event deleted');
	}
};

export const eventCategoriesController = {
	async create(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const input = c.get('validatedBody') as CreateEventCategoryDTO;
		const category = await createEventCategory(tenant.id, membership, user.id, input);

		return successResponse(c, category, 'Event category created', 201);
	},

	async list(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const input = c.get('validatedQuery') as ListEventCategoriesQuery;
		const result = await listEventCategories(tenant.id, membership, input);

		return paginatedResponse(c, result.items, result.meta, 'Event categories retrieved');
	}
};

export const eventTagsController = {
	async create(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const input = c.get('validatedBody') as CreateEventTagDTO;
		const tag = await createEventTag(tenant.id, membership, user.id, input);

		return successResponse(c, tag, 'Event tag created', 201);
	},

	async list(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const input = c.get('validatedQuery') as ListEventTagsQuery;
		const result = await listEventTags(tenant.id, membership, input);

		return paginatedResponse(c, result.items, result.meta, 'Event tags retrieved');
	}
};

export const eventSeriesController = {
	async create(c: Context<AppEnv>) {
		const { tenant, membership, user } = getTenantContext(c);
		const input = c.get('validatedBody') as CreateEventSeriesDTO;
		const series = await createEventSeries(tenant.id, membership, user.id, input);

		return successResponse(c, series, 'Event series created', 201);
	},

	async list(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const input = c.get('validatedQuery') as ListEventSeriesQuery;
		const result = await listEventSeries(tenant.id, membership, input);

		return paginatedResponse(c, result.items, result.meta, 'Event series retrieved');
	},

	async getBySlug(c: Context<AppEnv>) {
		const { tenant, membership } = getTenantContext(c);
		const { slug } = c.get('validatedParams') as EventSeriesSlugParams;
		const series = await getEventSeriesBySlug(tenant.id, membership, slug);

		return successResponse(c, series, 'Event series retrieved');
	}
};