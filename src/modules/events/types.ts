import type { InferSelectModel } from 'drizzle-orm';

import type { categories, eventSeries, events, tags } from '../../db/schema/index.js';
import type {
	CreateEventCategoryInput,
	CreateEventInput,
	CreateEventSeriesInput,
	CreateEventTagInput,
	EventListQueryInput,
	EventSeriesSlugParamsInput,
	EventSlugParamsInput,
	ListEventCategoriesQueryInput,
	ListEventSeriesQueryInput,
	ListEventTagsQueryInput,
	UpdateEventInput
} from './validation.js';

export type EventRecord = InferSelectModel<typeof events>;
export type EventCategoryRecord = InferSelectModel<typeof categories>;
export type EventTagRecord = InferSelectModel<typeof tags>;
export type EventSeriesRecord = InferSelectModel<typeof eventSeries>;

export interface EventTagListItem {
	id: string;
	tenantId: string;
	name: string;
	slug: string;
}

export interface EventListItem extends EventRecord {
	venueCity: string | null;
	tags: EventTagListItem[];
}

export interface EventDetailItem extends EventRecord {
	venueCity: string | null;
	tags: EventTagListItem[];
}

export type EventListQuery = EventListQueryInput;
export type EventSlugParams = EventSlugParamsInput;
export type EventSeriesSlugParams = EventSeriesSlugParamsInput;
export type CreateEventDTO = CreateEventInput;
export type UpdateEventDTO = UpdateEventInput;
export type CreateEventCategoryDTO = CreateEventCategoryInput;
export type ListEventCategoriesQuery = ListEventCategoriesQueryInput;
export type CreateEventTagDTO = CreateEventTagInput;
export type ListEventTagsQuery = ListEventTagsQueryInput;
export type CreateEventSeriesDTO = CreateEventSeriesInput;
export type ListEventSeriesQuery = ListEventSeriesQueryInput;