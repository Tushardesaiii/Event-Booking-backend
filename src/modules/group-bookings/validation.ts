import { z } from 'zod';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import { assignBookingOrderAttendeesSchema } from '../booking-orders/validation.js';

const uuidSchema = z.string().uuid();

export const groupBookingIdParamsSchema = z.object({
  id: uuidSchema
});

export const groupBookingMemberParamsSchema = z.object({
  id: uuidSchema,
  memberId: uuidSchema
});

export const groupBookingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled', 'expired']).optional(),
  eventId: uuidSchema.optional()
});

const ticketSelectionSchema = z.object({
  ticketTypeId: uuidSchema,
  quantity: z.coerce.number().int().positive().max(1000)
});

export const createGroupBookingSchema = z.object({
  eventId: uuidSchema,
  ticketSelections: z.array(ticketSelectionSchema).min(1).max(50),
  title: z.string().trim().min(2).max(180).optional()
});

export const inviteMemberSchema = z.object({
  userId: uuidSchema
});

const memberShareSchema = z.object({
  userId: uuidSchema,
  amount: z.coerce.number().positive()
});

export const updateShareSchema = z
  .object({
    shares: z.array(memberShareSchema).min(1).max(100)
  })
  .extend(optimisticLockSchema.shape);

export const recordContributionSchema = z.object({
  amount: z.coerce.number().positive()
}).extend(optimisticLockSchema.shape);

export const groupBookingCancelSchema = z.object({}).extend(optimisticLockSchema.shape);

export const groupBookingAssignAttendeesSchema = assignBookingOrderAttendeesSchema.extend(optimisticLockSchema.shape);

export const groupBookingActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export type GroupBookingIdParamsInput = z.infer<typeof groupBookingIdParamsSchema>;
export type GroupBookingMemberParamsInput = z.infer<typeof groupBookingMemberParamsSchema>;
export type GroupBookingListQueryInput = z.infer<typeof groupBookingListQuerySchema>;
export type CreateGroupBookingInput = z.infer<typeof createGroupBookingSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateShareInput = z.infer<typeof updateShareSchema>;
export type RecordContributionInput = z.infer<typeof recordContributionSchema>;
export type GroupBookingCancelInput = z.infer<typeof groupBookingCancelSchema>;
export type GroupBookingActivityQueryInput = z.infer<typeof groupBookingActivityQuerySchema>;
export type GroupBookingAssignAttendeesInput = z.infer<typeof groupBookingAssignAttendeesSchema>;
