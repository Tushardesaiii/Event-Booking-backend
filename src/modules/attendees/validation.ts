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
const isoDateTimeSchema = z.string().datetime({ offset: true });
const attendeeStatusSchema = z.enum(['pending', 'confirmed', 'cancelled', 'checked_in', 'no_show']);
const attendeeGenderSchema = z.enum(['male', 'female', 'non_binary', 'other', 'prefer_not_to_say']);

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^[+0-9()\-\s.]+$/, 'phone must contain only digits and common separators')
  .refine((value) => value.replace(/\D/g, '').length >= 7, {
    message: 'phone must contain at least 7 digits'
  });

function hasAnyDefinedField(value: Record<string, unknown>) {
  return Object.values(value).some((entry) => entry !== undefined);
}

function validateCheckInState(value: { status?: string; checkedInAt?: string | null; checkedInByUserId?: string | null }, ctx: z.RefinementCtx) {
  const hasCheckedInAt = value.checkedInAt !== undefined && value.checkedInAt !== null;
  const hasCheckedInByUserId = value.checkedInByUserId !== undefined && value.checkedInByUserId !== null;

  if (value.status === 'checked_in') {
    if (!hasCheckedInAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkedInAt'],
        message: 'checkedInAt is required when status is checked_in'
      });
    }

    if (!hasCheckedInByUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkedInByUserId'],
        message: 'checkedInByUserId is required when status is checked_in'
      });
    }
  }

  if ((hasCheckedInAt || hasCheckedInByUserId) && value.status !== 'checked_in') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'status must be checked_in when check-in metadata is provided'
    });
  }

  if (hasCheckedInAt !== hasCheckedInByUserId) {
    if (!hasCheckedInAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkedInAt'],
        message: 'checkedInAt and checkedInByUserId must be provided together'
      });
    }

    if (!hasCheckedInByUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkedInByUserId'],
        message: 'checkedInAt and checkedInByUserId must be provided together'
      });
    }
  }
}

export const attendeeIdParamsSchema = z.object({
  id: uuidSchema
});

export const attendeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  eventId: uuidSchema.optional(),
  ticketTypeId: uuidSchema.optional(),
  status: attendeeStatusSchema.optional(),
  checkedIn: booleanQuerySchema,
  city: z.string().trim().min(1).max(120).optional(),
  sortBy: z.enum(['createdAt', 'checkedInAt', 'fullName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

const baseAttendeeSchema = z.object({
  eventId: uuidSchema,
  ticketTypeId: uuidSchema,
  bookingOrderId: uuidSchema.nullable().optional(),
  fullName: z.string().trim().min(2).max(180),
  email: z.string().trim().email(),
  phone: phoneSchema,
  gender: attendeeGenderSchema.nullable().optional(),
  dateOfBirth: z.string().date().nullable().optional(),
  city: nullableText(120),
  state: nullableText(120),
  country: nullableText(120),
  emergencyContactName: nullableText(180),
  emergencyContactPhone: phoneSchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  checkedInAt: isoDateTimeSchema.nullable().optional(),
  checkedInByUserId: uuidSchema.nullable().optional(),
  status: attendeeStatusSchema.default('pending')
});

export const createAttendeeSchema = baseAttendeeSchema.superRefine((value, ctx) => {
  validateCheckInState(value, ctx);
});

export const updateAttendeeSchema = z
  .object({
    eventId: uuidSchema.optional(),
    ticketTypeId: uuidSchema.optional(),
    bookingOrderId: uuidSchema.nullable().optional(),
    fullName: z.string().trim().min(2).max(180).optional(),
    email: z.string().trim().email().optional(),
    phone: phoneSchema.optional(),
    gender: attendeeGenderSchema.nullable().optional(),
    dateOfBirth: z.string().date().nullable().optional(),
    city: nullableText(120),
    state: nullableText(120),
    country: nullableText(120),
    emergencyContactName: nullableText(180),
    emergencyContactPhone: phoneSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    checkedInAt: isoDateTimeSchema.nullable().optional(),
    checkedInByUserId: uuidSchema.nullable().optional(),
    status: attendeeStatusSchema.optional()
  })
  .extend(optimisticLockSchema.shape)
  .superRefine((value, ctx) => {
    validateCheckInState(value, ctx);
  })
  .refine(hasAnyDefinedField, {
    message: 'At least one field is required'
  });

export const attendeeCheckInSchema = optimisticLockSchema;
export const attendeeRevertCheckInSchema = optimisticLockSchema;

export type AttendeeIdParamsInput = z.infer<typeof attendeeIdParamsSchema>;
export type AttendeeListQueryInput = z.infer<typeof attendeeListQuerySchema>;
export type CreateAttendeeInput = z.infer<typeof createAttendeeSchema>;
export type UpdateAttendeeInput = z.infer<typeof updateAttendeeSchema>;