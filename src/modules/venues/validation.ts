import { z } from 'zod';

import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

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

const nullableText = (max = 255) => z.string().trim().min(1).max(max).nullable().optional();
const nullableLongText = z.string().trim().max(5000).nullable().optional();
const coordinateSchema = z.coerce.number().finite().nullable().optional();
const latitudeSchema = z.coerce.number().finite().min(-90).max(90).nullable().optional();
const longitudeSchema = z.coerce.number().finite().min(-180).max(180).nullable().optional();
const capacitySchema = z.coerce.number().int().positive().nullable().optional();

function hasAnyDefinedField(value: Record<string, unknown>) {
	return Object.values(value).some((entry) => entry !== undefined);
}

export const venueSlugParamsSchema = z.object({
	slug: z.string().trim().min(1).max(120)
});

export const venueListQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().max(100).optional(),
	search: z.string().trim().min(1).max(120).optional(),
	city: z.string().trim().min(1).max(100).optional(),
	isActive: booleanQuerySchema,
	sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'city', 'capacity', 'isActive', 'isVerified']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const createVenueSchema = z.object({
	name: z.string().trim().min(2).max(150),
	description: z.string().trim().max(5000).optional(),
	addressLine1: z.string().trim().min(2).max(255),
	addressLine2: nullableText(255),
	landmark: nullableText(255),
	city: z.string().trim().min(2).max(100),
	state: z.string().trim().min(2).max(100),
	country: z.string().trim().min(2).max(100),
	postalCode: nullableText(20),
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	capacity: capacitySchema,
	contactEmail: z.string().trim().email().nullable().optional(),
	contactPhone: z.string().trim().max(32).nullable().optional(),
	website: z.string().trim().url().nullable().optional(),
	coverAssetId: uuidSchema.nullable().optional(),
	isActive: z.boolean().optional().default(true),
	isVerified: z.boolean().optional().default(false)
});

export const updateVenueSchema = z
	.object({
		name: z.string().trim().min(2).max(150).optional(),
		description: nullableLongText,
		addressLine1: z.string().trim().min(2).max(255).optional(),
		addressLine2: nullableText(255),
		landmark: nullableText(255),
		city: z.string().trim().min(2).max(100).optional(),
		state: z.string().trim().min(2).max(100).optional(),
		country: z.string().trim().min(2).max(100).optional(),
		postalCode: nullableText(20),
		latitude: coordinateSchema,
		longitude: coordinateSchema,
		capacity: capacitySchema,
		contactEmail: z.string().trim().email().nullable().optional(),
		contactPhone: z.string().trim().max(32).nullable().optional(),
		website: z.string().trim().url().nullable().optional(),
		coverAssetId: uuidSchema.nullable().optional(),
		isActive: z.boolean().optional(),
		isVerified: z.boolean().optional()
	})
	.extend(optimisticLockSchema.shape)
	.refine(hasAnyDefinedField, {
		message: 'At least one field is required'
	});

export type VenueSlugParamsInput = z.infer<typeof venueSlugParamsSchema>;
export type VenueListQueryInput = z.infer<typeof venueListQuerySchema>;
export type CreateVenueInput = z.infer<typeof createVenueSchema>;
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;