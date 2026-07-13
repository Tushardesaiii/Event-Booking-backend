import { z } from 'zod';

import { createSlug } from '../../lib/slug.js';
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

const optionalTrimmedString = z.string().trim().min(1).max(500).optional();
const optionalLongText = z.string().trim().max(2000).optional();

export const tenantRoleSchema = z.enum(['owner', 'admin', 'manager', 'staff', 'viewer']);

export const tenantListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  isActive: booleanQuerySchema
});

export const tenantMemberListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const tenantSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(120)
});

export const tenantMemberParamsSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  memberId: uuidSchema
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .transform((value) => (value ? createSlug(value) : undefined)),
  description: optionalLongText,
  logoAssetId: uuidSchema.optional(),
  coverAssetId: uuidSchema.optional(),
  website: z.string().trim().url().optional(),
  email: z.string().trim().email().optional(),
  phone: optionalTrimmedString,
  city: optionalTrimmedString,
  state: optionalTrimmedString,
  country: optionalTrimmedString
});

export const updateTenantSchema = createTenantSchema
  .omit({ name: true })
  .extend({
    name: z.string().trim().min(2).max(120).optional()
  })
  .partial()
  .extend(optimisticLockSchema.shape);

export const createTenantMemberSchema = z
  .object({
    userId: uuidSchema.optional(),
    email: z.string().trim().email().optional(),
    role: tenantRoleSchema
  })
  .superRefine((value, ctx) => {
    if (!value.userId && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either userId or email is required',
        path: ['userId']
      });
    }
  });

export const updateTenantMemberSchema = z.object({
  role: tenantRoleSchema,
  ...optimisticLockSchema.shape
});

export const deleteTenantSchema = z.object({
  confirmDelete: z.literal(true),
  ...optimisticLockSchema.shape
});

export type TenantListQueryInput = z.infer<typeof tenantListQuerySchema>;
export type TenantMemberListQueryInput = z.infer<typeof tenantMemberListQuerySchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type CreateTenantMemberInput = z.infer<typeof createTenantMemberSchema>;
export type UpdateTenantMemberInput = z.infer<typeof updateTenantMemberSchema>;
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;
