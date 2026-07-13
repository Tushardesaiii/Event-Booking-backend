import { z } from 'zod';

export const vibeProfileUpdateSchema = z.object({
  tags: z.record(z.string(), z.array(z.string())).optional(),
  onboarded: z.boolean().optional(),
  consented: z.boolean().optional(),
  // Optional social handles. `null` explicitly unlinks; omit to leave unchanged.
  instagram: z.string().max(64).nullish(),
  snapchat: z.string().max(64).nullish(),
});

export const eventIdParamSchema = z.object({
  eventId: z.string().uuid(),
});

export const setModeSchema = z.object({
  mode: z.enum(['solo', 'partner', 'group']),
});

export const setAttendanceSchema = z.object({
  attendance: z.enum(['going', 'not_going']),
});

export const swipeSchema = z.object({
  targetUserId: z.string().uuid(),
  decision: z.enum(['accept', 'reject']),
});

export const candidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const roomParamSchema = z.object({
  roomType: z.enum(['partner', 'group']),
  roomId: z.string().uuid(),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(2000),
});

export const matchesQuerySchema = z.object({
  eventId: z.string().uuid().optional(),
});

export type VibeProfileUpdateInput = z.infer<typeof vibeProfileUpdateSchema>;
export type SetModeInput = z.infer<typeof setModeSchema>;
export type SetAttendanceInput = z.infer<typeof setAttendanceSchema>;
export type SwipeInput = z.infer<typeof swipeSchema>;
