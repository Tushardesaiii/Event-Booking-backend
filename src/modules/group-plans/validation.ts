import { z } from 'zod';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

export const groupPlanIdParamsSchema = z.object({
  id: uuidSchema
});

export const groupPlanInviteParamsSchema = z.object({
  inviteId: uuidSchema
});

export const groupPlanListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(120).optional()
});

export const createGroupPlanSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(5000).optional(),
  eventId: uuidSchema.optional()
});

export const updateGroupPlanSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    eventId: uuidSchema.nullable().optional(),
    isArchived: z.boolean().optional()
  })
  .extend(optimisticLockSchema.shape);

export const inviteMemberSchema = z.object({
  inviteeUserId: uuidSchema
});

export type GroupPlanIdParamsInput = z.infer<typeof groupPlanIdParamsSchema>;
export type GroupPlanInviteParamsInput = z.infer<typeof groupPlanInviteParamsSchema>;
export type GroupPlanListQueryInput = z.infer<typeof groupPlanListQuerySchema>;
export type CreateGroupPlanInput = z.infer<typeof createGroupPlanSchema>;
export type UpdateGroupPlanInput = z.infer<typeof updateGroupPlanSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
