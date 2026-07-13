import { z } from 'zod';

import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();
const recordSchema = z.record(z.string(), z.unknown());

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

const issuedTicketStatusSchema = z.enum(['issued', 'checked_in', 'cancelled', 'transferred', 'refunded', 'invalidated']);
const issuedTicketValidationOutcomeSchema = z.enum([
  'valid',
  'already_checked_in',
  'cancelled',
  'invalidated',
  'refunded',
  'deleted',
  'tenant_mismatch',
  'stale_ticket',
  'invalid_qr',
  'unauthorized_scanner'
]);

const scanSourceSchema = z.string().trim().min(1).max(32).optional();

function hasAnyDefinedField(value: Record<string, unknown>) {
  return Object.values(value).some((entry) => entry !== undefined);
}

export const issuedTicketNumberParamsSchema = z.object({
  ticketNumber: z.string().trim().min(1).max(64)
});

export const issuedTicketListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  eventId: uuidSchema.optional(),
  attendeeId: uuidSchema.optional(),
  bookingOrderId: uuidSchema.optional(),
  bookingOrderItemId: uuidSchema.optional(),
  ticketTypeId: uuidSchema.optional(),
  ticketNumber: z.string().trim().min(1).max(64).optional(),
  status: issuedTicketStatusSchema.optional(),
  checkedIn: booleanQuerySchema,
  sortBy: z.enum(['createdAt', 'issuedAt', 'checkedInAt', 'ticketNumber', 'status']).default('issuedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const issuedTicketValidateSchema = z
  .object({
    ticketNumber: z.string().trim().min(1).max(64).optional(),
    qrCodeToken: z.string().trim().min(8).max(256).optional(),
    scannerDeviceId: z.string().trim().min(1).max(128).optional(),
    scannerGate: z.string().trim().min(1).max(128).optional(),
    scannerOperatorUserId: uuidSchema.optional(),
    source: scanSourceSchema,
    lastKnownUpdatedAt: z.string().datetime().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.ticketNumber && !value.qrCodeToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'ticketNumber or qrCodeToken is required'
      });
    }

    if (value.ticketNumber && value.qrCodeToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'Provide only ticketNumber or qrCodeToken'
      });
    }
  });

export const updateIssuedTicketSchema = z
  .object({
    status: issuedTicketStatusSchema.optional(),
    attendeeId: uuidSchema.nullable().optional(),
    metadata: recordSchema.optional()
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

    if (value.status === 'transferred' && value.attendeeId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attendeeId'],
        message: 'attendeeId is required when transferring a ticket'
      });
    }
  });

export const checkInIssuedTicketSchema = z
  .object({
    scannerDeviceId: z.string().trim().min(1).max(128).optional(),
    scannerGate: z.string().trim().min(1).max(128).optional(),
    scannerOperatorUserId: uuidSchema.optional(),
    source: scanSourceSchema
  })
  .extend(optimisticLockSchema.shape);

export type IssuedTicketNumberParamsInput = z.infer<typeof issuedTicketNumberParamsSchema>;
export type IssuedTicketListQueryInput = z.infer<typeof issuedTicketListQuerySchema>;
export type IssuedTicketValidateInput = z.infer<typeof issuedTicketValidateSchema>;
export type UpdateIssuedTicketInput = z.infer<typeof updateIssuedTicketSchema>;
export type CheckInIssuedTicketInput = z.infer<typeof checkInIssuedTicketSchema>;
export type IssuedTicketStatusInput = z.infer<typeof issuedTicketStatusSchema>;
export type IssuedTicketValidationOutcomeInput = z.infer<typeof issuedTicketValidationOutcomeSchema>;
