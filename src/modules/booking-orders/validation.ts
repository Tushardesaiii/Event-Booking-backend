import { z } from 'zod';

import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code');

const bookingOrderStatusSchema = z.enum([
  'draft',
  'pending',
  'confirmed',
  'paid',
  'completed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded'
]);

const bookingOrderCreateStatusSchema = z.enum(['draft', 'pending', 'confirmed']);
const bookingOrderSourceSchema = z.enum(['web', 'admin', 'mobile', 'walk_in', 'kiosk', 'partner']);
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

const recordSchema = z.record(z.string(), z.unknown());

function hasAnyDefinedField(value: Record<string, unknown>) {
  return Object.values(value).some((entry) => entry !== undefined);
}

function validateRange(value: { createdFrom?: string; createdTo?: string }, ctx: z.RefinementCtx) {
  if (value.createdFrom && value.createdTo) {
    const start = new Date(value.createdFrom);
    const end = new Date(value.createdTo);

    if (end.getTime() < start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['createdTo'],
        message: 'createdTo must be greater than or equal to createdFrom'
      });
    }
  }
}

export const bookingOrderNumberParamsSchema = z.object({
  orderNumber: z.string().trim().min(1).max(64)
});

export const bookingOrderListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    status: bookingOrderStatusSchema.optional(),
    eventId: uuidSchema.optional(),
    purchaserUserId: uuidSchema.optional(),
    source: bookingOrderSourceSchema.optional(),
    orderNumber: z.string().trim().min(1).max(64).optional(),
    attendeeEmail: z.string().trim().email().optional(),
    attendeePhone: phoneSchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'confirmedAt', 'totalAmount', 'orderNumber']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
  .superRefine(validateRange);

const bookingOrderItemSchema = z.object({
  ticketTypeId: uuidSchema,
  quantity: z.coerce.number().int().positive().max(100000),
  metadata: recordSchema.optional()
});

export const createBookingOrderSchema = z
  .object({
    eventId: uuidSchema,
    // The specific event date this order is for (optional; validated against the event).
    eventDateId: uuidSchema.nullable().optional(),
    purchaserUserId: uuidSchema,
    status: bookingOrderCreateStatusSchema.default('pending'),
    source: bookingOrderSourceSchema.default('web'),
    discountAmount: z.coerce.number().min(0).default(0),
    expiresAt: isoDateTimeSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    metadata: recordSchema.optional(),
    items: z.array(bookingOrderItemSchema).min(1).max(100)
  })
  .superRefine((value, ctx) => {
    const seenTicketTypeIds = new Set<string>();

    for (const item of value.items) {
      if (seenTicketTypeIds.has(item.ticketTypeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: 'Each ticketTypeId can appear only once in items'
        });

        break;
      }

      seenTicketTypeIds.add(item.ticketTypeId);
    }
  });

export const updateBookingOrderSchema = z
  .object({
    status: bookingOrderStatusSchema.optional(),
    source: bookingOrderSourceSchema.optional(),
    discountAmount: z.coerce.number().min(0).optional(),
    expiresAt: isoDateTimeSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    metadata: recordSchema.optional(),
    cancellationReason: z.string().trim().min(1).max(5000).nullable().optional()
  })
  .extend(optimisticLockSchema.shape)
  .superRefine((value, ctx) => {
    if (!hasAnyDefinedField(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'At least one field is required'
      });
    }

    if (value.status === 'cancelled' && value.cancellationReason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cancellationReason'],
        message: 'cancellationReason is required when cancelling an order'
      });
    }
  });

const attendeeDraftSchema = z.object({
  fullName: z.string().trim().min(2).max(180),
  email: z.string().trim().email(),
  phone: phoneSchema,
  gender: attendeeGenderSchema.nullable().optional(),
  dateOfBirth: z.string().date().nullable().optional(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  state: z.string().trim().min(1).max(120).nullable().optional(),
  country: z.string().trim().min(1).max(120).nullable().optional(),
  emergencyContactName: z.string().trim().min(1).max(180).nullable().optional(),
  emergencyContactPhone: phoneSchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: attendeeStatusSchema.default('confirmed')
});

const assignmentSchema = z
  .object({
    bookingOrderItemId: uuidSchema,
    attendeeId: uuidSchema.optional(),
    attendee: attendeeDraftSchema.optional()
  })
  .superRefine((value, ctx) => {
    const hasAttendeeId = value.attendeeId !== undefined;
    const hasAttendee = value.attendee !== undefined;

    if (hasAttendeeId === hasAttendee) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attendeeId'],
        message: 'Provide either attendeeId or attendee, but not both'
      });
    }
  });

export const assignBookingOrderAttendeesSchema = z.object({
  assignments: z.array(assignmentSchema).min(1).max(100)
});

export const bookingOrderAttendeesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  attendeeEmail: z.string().trim().email().optional(),
  attendeePhone: phoneSchema.optional(),
  sortBy: z.enum(['assignedAt', 'createdAt', 'fullName']).default('assignedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
});

export type BookingOrderNumberParamsInput = z.infer<typeof bookingOrderNumberParamsSchema>;
export type BookingOrderListQueryInput = z.infer<typeof bookingOrderListQuerySchema>;
export type CreateBookingOrderInput = z.infer<typeof createBookingOrderSchema>;
export type UpdateBookingOrderInput = z.infer<typeof updateBookingOrderSchema>;
export type AssignBookingOrderAttendeesInput = z.infer<typeof assignBookingOrderAttendeesSchema>;
export type BookingOrderAttendeesQueryInput = z.infer<typeof bookingOrderAttendeesQuerySchema>;