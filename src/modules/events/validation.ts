import { z } from 'zod';

import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

const nullableText = (max = 255) => z.string().trim().min(1).max(max).nullable().optional();

const booleanQuerySchema = z.preprocess((value) => {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		if (/^(true|1)$/i.test(value)) {
			return true;
		}

		if (/^(false|0)$/i.test(value)) {
			return false;
		}
	}

	return value;
}, z.boolean().optional());

const stringListQuerySchema = z.preprocess((value) => {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const rawValues = Array.isArray(value) ? value : [value];
	const parsedValues = rawValues.flatMap((entry) => {
		if (typeof entry !== 'string') {
			return [];
		}

		return entry
			.split(',')
			.map((slug) => slug.trim())
			.filter((slug) => slug.length > 0);
	});

	return [...new Set(parsedValues)];
}, z.array(z.string().trim().min(1).max(160)).max(50).optional());

const isoDateTimeSchema = z.string().datetime({ offset: true });
const isoDateSchema = z.string().date();

// One bookable occurrence of an event: a specific start/end datetime.
const eventDateSchema = z
	.object({
		startDateTime: isoDateTimeSchema,
		endDateTime: isoDateTimeSchema
	})
	.superRefine((value, ctx) => {
		if (!(new Date(value.endDateTime).getTime() > new Date(value.startDateTime).getTime())) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['endDateTime'],
				message: 'endDateTime must be after startDateTime'
			});
		}
	});

const eventStatusSchema = z.enum(['draft', 'published', 'cancelled', 'completed', 'archived']);
const eventVisibilitySchema = z.enum(['public', 'private', 'unlisted']);

const timezoneSchema = z.string().trim().min(2).max(80);

function hasAnyDefinedField(value: Record<string, unknown>) {
	return Object.values(value).some((entry) => entry !== undefined);
}

export const eventSlugParamsSchema = z.object({
	slug: z.string().trim().min(1).max(160)
});

export const eventSeriesSlugParamsSchema = z.object({
	slug: z.string().trim().min(1).max(160)
});

export const eventListQuerySchema = z
	.object({
		page: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().positive().max(100).optional(),
		search: z.string().trim().min(1).max(200).optional(),
		status: eventStatusSchema.optional(),
		visibility: eventVisibilitySchema.optional(),
		venueId: uuidSchema.optional(),
		categoryId: uuidSchema.optional(),
		tagId: uuidSchema.optional(),
		category: stringListQuerySchema,
		categories: stringListQuerySchema,
		tag: stringListQuerySchema,
		tags: stringListQuerySchema,
		city: z.string().trim().min(1).max(100).optional(),
		startDate: isoDateSchema.optional(),
		endDate: isoDateSchema.optional(),
		isFeatured: booleanQuerySchema,
		featuredFirst: booleanQuerySchema,
		upcoming: booleanQuerySchema,
		live: booleanQuerySchema,
		past: booleanQuerySchema,
		sortBy: z
			.enum(['createdAt', 'updatedAt', 'startDateTime', 'endDateTime', 'publishedAt', 'title', 'popularity'])
			.default('startDateTime'),
		sortOrder: z.enum(['asc', 'desc']).default('asc')
	})
	.superRefine((value, ctx) => {
		const windows = [value.upcoming, value.live, value.past].filter((flag) => flag === true).length;

		if (windows > 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['upcoming'],
				message: 'Only one of upcoming, live, or past can be set at a time'
			});
		}
	})
	.refine(
		(value) => {
			if (!value.startDate || !value.endDate) {
				return true;
			}

			return new Date(`${value.endDate}T00:00:00.000Z`).getTime() >= new Date(`${value.startDate}T00:00:00.000Z`).getTime();
		},
		{
			message: 'endDate must be greater than or equal to startDate',
			path: ['endDate']
		}
	);

const baseCreateEventSchema = z.object({
	venueId: uuidSchema.nullable().optional(),
	categoryId: uuidSchema.nullable().optional(),
	eventSeriesId: uuidSchema.nullable().optional(),
	title: z.string().trim().min(3).max(180),
	slug: z.string().trim().min(3).max(180).optional(),
	shortDescription: z.string().trim().min(1).max(500).optional(),
	description: z.string().trim().max(10000).optional(),
	startDateTime: isoDateTimeSchema,
	endDateTime: isoDateTimeSchema,
	// Concrete, bookable occurrences. When provided, each is a distinct date the
	// buyer can pick; startDateTime/endDateTime above stay the overall span.
	dates: z.array(eventDateSchema).min(1).max(50).optional(),
	timezone: timezoneSchema,
	bannerAssetId: uuidSchema.nullable().optional(),
	thumbnailAssetId: uuidSchema.nullable().optional(),
	maxCapacity: z.coerce.number().int().positive().nullable().optional(),
	status: eventStatusSchema.default('draft'),
	visibility: eventVisibilitySchema.default('public'),
	publishedAt: isoDateTimeSchema.optional(),
	isFeatured: z.boolean().default(false),
	metaTitle: nullableText(160),
	metaDescription: nullableText(300),
	termsAndConditions: z.string().trim().max(10000).nullable().optional(),
	cancellationPolicy: z.string().trim().max(10000).nullable().optional(),
	faq: z
		.array(
			z.object({
				question: z.string().trim().min(1).max(300),
				answer: z.string().trim().min(1).max(2000)
			})
		)
		.max(50)
		.nullable()
		.optional(),
	tagIds: z.array(uuidSchema).max(50).optional(),
	artistIds: z.array(uuidSchema).max(50).optional()
});

export const createEventSchema = baseCreateEventSchema.superRefine((value, ctx) => {
	const start = new Date(value.startDateTime);
	const end = new Date(value.endDateTime);

	if (!(end.getTime() > start.getTime())) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['endDateTime'],
			message: 'endDateTime must be after startDateTime'
		});
	}

	if (value.status === 'published' && value.publishedAt === undefined) {
		return;
	}

	if (value.status !== 'published' && value.publishedAt !== undefined) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['publishedAt'],
			message: 'publishedAt can only be provided when status is published'
		});
	}
});

export const updateEventSchema = z
	.object({
		venueId: uuidSchema.nullable().optional(),
		categoryId: uuidSchema.nullable().optional(),
		eventSeriesId: uuidSchema.nullable().optional(),
		title: z.string().trim().min(3).max(180).optional(),
		shortDescription: z.string().trim().min(1).max(500).nullable().optional(),
		description: z.string().trim().max(10000).nullable().optional(),
		startDateTime: isoDateTimeSchema.optional(),
		endDateTime: isoDateTimeSchema.optional(),
		dates: z.array(eventDateSchema).min(1).max(50).optional(),
		timezone: timezoneSchema.optional(),
		bannerAssetId: uuidSchema.nullable().optional(),
		thumbnailAssetId: uuidSchema.nullable().optional(),
		maxCapacity: z.coerce.number().int().positive().nullable().optional(),
		status: eventStatusSchema.optional(),
		visibility: eventVisibilitySchema.optional(),
		publishedAt: isoDateTimeSchema.nullable().optional(),
		isFeatured: z.boolean().optional(),
		metaTitle: nullableText(160),
		metaDescription: nullableText(300),
		termsAndConditions: z.string().trim().max(10000).nullable().optional(),
		cancellationPolicy: z.string().trim().max(10000).nullable().optional(),
		faq: z
			.array(
				z.object({
					question: z.string().trim().min(1).max(300),
					answer: z.string().trim().min(1).max(2000)
				})
			)
			.max(50)
			.nullable()
			.optional(),
		tagIds: z.array(uuidSchema).max(50).optional(),
		artistIds: z.array(uuidSchema).max(50).optional()
	})
	.extend(optimisticLockSchema.shape)
	.superRefine((value, ctx) => {
		if (value.startDateTime && value.endDateTime) {
			const start = new Date(value.startDateTime);
			const end = new Date(value.endDateTime);

			if (!(end.getTime() > start.getTime())) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['endDateTime'],
					message: 'endDateTime must be after startDateTime'
				});
			}
		}
	})
	.refine(hasAnyDefinedField, {
		message: 'At least one field is required'
	});

export const createEventCategorySchema = z.object({
	name: z.string().trim().min(2).max(120),
	slug: z.string().trim().min(2).max(160).optional(),
	description: z.string().trim().max(500).optional()
});

export const listEventCategoriesQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().max(100).optional(),
	search: z.string().trim().min(1).max(120).optional()
});

export const createEventTagSchema = z.object({
	name: z.string().trim().min(2).max(120),
	slug: z.string().trim().min(2).max(160).optional(),
	description: z.string().trim().max(500).optional()
});

export const listEventTagsQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().max(100).optional(),
	search: z.string().trim().min(1).max(120).optional()
});

export const createEventSeriesSchema = z
	.object({
		title: z.string().trim().min(2).max(180),
		slug: z.string().trim().min(2).max(180).optional(),
		description: z.string().trim().max(5000).optional(),
		timezone: timezoneSchema,
		startDateTime: isoDateTimeSchema.optional(),
		endDateTime: isoDateTimeSchema.optional(),
		isActive: z.boolean().optional().default(true)
	})
	.superRefine((value, ctx) => {
		if (value.startDateTime && value.endDateTime) {
			const start = new Date(value.startDateTime);
			const end = new Date(value.endDateTime);

			if (!(end.getTime() > start.getTime())) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['endDateTime'],
					message: 'endDateTime must be after startDateTime'
				});
			}
		}
	});

export const listEventSeriesQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().max(100).optional(),
	search: z.string().trim().min(1).max(180).optional(),
	isActive: booleanQuerySchema
});

export type EventSlugParamsInput = z.infer<typeof eventSlugParamsSchema>;
export type EventSeriesSlugParamsInput = z.infer<typeof eventSeriesSlugParamsSchema>;
export type EventListQueryInput = z.infer<typeof eventListQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type CreateEventCategoryInput = z.infer<typeof createEventCategorySchema>;
export type ListEventCategoriesQueryInput = z.infer<typeof listEventCategoriesQuerySchema>;
export type CreateEventTagInput = z.infer<typeof createEventTagSchema>;
export type ListEventTagsQueryInput = z.infer<typeof listEventTagsQuerySchema>;
export type CreateEventSeriesInput = z.infer<typeof createEventSeriesSchema>;
export type ListEventSeriesQueryInput = z.infer<typeof listEventSeriesQuerySchema>;