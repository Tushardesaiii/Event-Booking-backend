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

const ticketStatusSchema = z.enum(['draft', 'active', 'paused', 'sold_out', 'archived']);
const ticketVisibilitySchema = z.enum(['public', 'hidden', 'invite_only']);
const taxBehaviorSchema = z.enum(['inclusive', 'exclusive']);
const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code');
const isoDateTimeSchema = z.string().datetime({ offset: true });

function hasAnyDefinedField(value: Record<string, unknown>) {
  return Object.values(value).some((entry) => entry !== undefined);
}

export const ticketTypeSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(160)
});

export const ticketTypeListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    eventId: uuidSchema.optional(),
    status: ticketStatusSchema.optional(),
    visibility: ticketVisibilitySchema.optional(),
    isRefundable: booleanQuerySchema,
    isTransferable: booleanQuerySchema,
    sortBy: z.enum(['createdAt', 'price', 'saleStartDate']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
  .refine(
    (value) => {
      if (!value.search) {
        return true;
      }

      return value.search.trim().length > 0;
    },
    {
      message: 'search cannot be empty',
      path: ['search']
    }
  );

export const createTicketTypeSchema = z
  .object({
    eventId: uuidSchema,
    name: z.string().trim().min(2).max(160),
    slug: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(5000).optional(),
    price: z.coerce.number().min(0),
    currency: currencySchema.default('INR'),
    taxBehavior: taxBehaviorSchema.default('exclusive'),
    totalQuantity: z.coerce.number().int().positive(),
    soldQuantity: z.coerce.number().int().min(0).default(0),
    reservedQuantity: z.coerce.number().int().min(0).default(0),
    minPerOrder: z.coerce.number().int().positive().default(1),
    maxPerOrder: z.coerce.number().int().positive().default(10),
    saleStartDate: isoDateTimeSchema.optional(),
    saleEndDate: isoDateTimeSchema.optional(),
    visibility: ticketVisibilitySchema.default('public'),
    status: ticketStatusSchema.default('draft'),
    isTransferable: z.boolean().default(false),
    isRefundable: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.saleStartDate && value.saleEndDate) {
      const start = new Date(value.saleStartDate);
      const end = new Date(value.saleEndDate);

      if (!(end.getTime() > start.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['saleEndDate'],
          message: 'saleEndDate must be after saleStartDate'
        });
      }
    }

    if (value.minPerOrder > value.maxPerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPerOrder'],
        message: 'maxPerOrder must be greater than or equal to minPerOrder'
      });
    }

    if (value.soldQuantity > value.totalQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['soldQuantity'],
        message: 'soldQuantity must be less than or equal to totalQuantity'
      });
    }

    if (value.reservedQuantity > value.totalQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reservedQuantity'],
        message: 'reservedQuantity must be less than or equal to totalQuantity'
      });
    }
  });

export const updateTicketTypeSchema = z
  .object({
    eventId: uuidSchema.optional(),
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    price: z.coerce.number().min(0).optional(),
    currency: currencySchema.optional(),
    taxBehavior: taxBehaviorSchema.optional(),
    totalQuantity: z.coerce.number().int().positive().optional(),
    soldQuantity: z.coerce.number().int().min(0).optional(),
    reservedQuantity: z.coerce.number().int().min(0).optional(),
    minPerOrder: z.coerce.number().int().positive().optional(),
    maxPerOrder: z.coerce.number().int().positive().optional(),
    saleStartDate: isoDateTimeSchema.nullable().optional(),
    saleEndDate: isoDateTimeSchema.nullable().optional(),
    visibility: ticketVisibilitySchema.optional(),
    status: ticketStatusSchema.optional(),
    isTransferable: z.boolean().optional(),
    isRefundable: z.boolean().optional(),
    slug: z.string().trim().min(2).max(160).optional()
  })
  .extend(optimisticLockSchema.shape)
  .superRefine((value, ctx) => {
    if (value.saleStartDate && value.saleEndDate) {
      const start = new Date(value.saleStartDate);
      const end = new Date(value.saleEndDate);

      if (!(end.getTime() > start.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['saleEndDate'],
          message: 'saleEndDate must be after saleStartDate'
        });
      }
    }

    if (value.minPerOrder !== undefined && value.maxPerOrder !== undefined && value.minPerOrder > value.maxPerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPerOrder'],
        message: 'maxPerOrder must be greater than or equal to minPerOrder'
      });
    }

    if (value.totalQuantity !== undefined && value.soldQuantity !== undefined && value.soldQuantity > value.totalQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['soldQuantity'],
        message: 'soldQuantity must be less than or equal to totalQuantity'
      });
    }

    if (value.totalQuantity !== undefined && value.reservedQuantity !== undefined && value.reservedQuantity > value.totalQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reservedQuantity'],
        message: 'reservedQuantity must be less than or equal to totalQuantity'
      });
    }
  })
  .refine(hasAnyDefinedField, {
    message: 'At least one field is required'
  });

export type TicketTypeSlugParamsInput = z.infer<typeof ticketTypeSlugParamsSchema>;
export type TicketTypeListQueryInput = z.infer<typeof ticketTypeListQuerySchema>;
export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;
export type UpdateTicketTypeInput = z.infer<typeof updateTicketTypeSchema>;
