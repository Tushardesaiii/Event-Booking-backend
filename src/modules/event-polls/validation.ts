import { z } from 'zod';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

export const pollIdParamsSchema = z.object({
  id: uuidSchema
});

export const createPollSchema = z.object({
  groupPlanId: uuidSchema,
  question: z.string().trim().min(2).max(1000),
  isAnonymous: z.boolean().optional().default(false),
  isPublic: z.boolean().optional().default(true),
  allowMultipleChoices: z.boolean().optional().default(false),
  options: z
    .array(
      z.object({
        optionText: z.string().trim().min(1).max(500),
        eventId: uuidSchema.optional(),
        dateOption: z.string().datetime().optional()
      })
    )
    .min(2)
});

export const updatePollSchema = z
  .object({
    question: z.string().trim().min(2).max(1000).optional(),
    isClosed: z.boolean().optional()
  })
  .extend(optimisticLockSchema.shape);

export const votePollSchema = z.object({
  optionIds: z.array(uuidSchema).min(1)
});

export type PollIdParamsInput = z.infer<typeof pollIdParamsSchema>;
export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;
export type VotePollInput = z.infer<typeof votePollSchema>;
