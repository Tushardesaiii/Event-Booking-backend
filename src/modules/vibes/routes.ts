// Consumer Vibes API — authenticated, NO tenant. Matchmaking among real
// attendees of an event (people with a confirmed booking who opted in).

import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  candidatesQuerySchema,
  eventIdParamSchema,
  matchesQuerySchema,
  roomParamSchema,
  sendMessageSchema,
  setAttendanceSchema,
  setModeSchema,
  swipeSchema,
  vibeProfileUpdateSchema,
} from './validation.js';
import {
  changeGroup,
  changePartner,
  getChatMessages,
  getMatches,
  getMyGroups,
  getParticipation,
  getPartnerCandidates,
  getVibeProfile,
  joinGroup,
  sendChatMessage,
  setAttendance,
  setMode,
  swipe,
  upsertVibeProfile,
} from './service.js';

export const vibesRoutes = new Hono<AppEnv>();

vibesRoutes.use('*', authMiddleware);

// --- Profile / onboarding --------------------------------------------------
vibesRoutes.get('/profile', async (c) => {
  const user = c.get('user')!;
  return successResponse(c, await getVibeProfile(user.id), 'Vibe profile');
});

vibesRoutes.patch('/profile', validateBody(vibeProfileUpdateSchema), async (c) => {
  const user = c.get('user')!;
  const input = c.get('validatedBody') as any;
  return successResponse(c, await upsertVibeProfile(user.id, input), 'Vibe profile updated');
});

// --- Per-event participation ----------------------------------------------
vibesRoutes.get('/events/:eventId/participation', validateParams(eventIdParamSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await getParticipation(user.id, eventId), 'Participation');
});

vibesRoutes.put('/events/:eventId/mode', validateParams(eventIdParamSchema), validateBody(setModeSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  const { mode } = c.get('validatedBody') as { mode: 'solo' | 'partner' | 'group' };
  return successResponse(c, await setMode(user.id, eventId, mode), 'Mode set');
});

vibesRoutes.put('/events/:eventId/attendance', validateParams(eventIdParamSchema), validateBody(setAttendanceSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  const { attendance } = c.get('validatedBody') as { attendance: 'going' | 'not_going' };
  return successResponse(c, await setAttendance(user.id, eventId, attendance), 'Attendance set');
});

// --- Partner ---------------------------------------------------------------
vibesRoutes.get('/events/:eventId/candidates', validateParams(eventIdParamSchema), validateQuery(candidatesQuerySchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  const { limit } = c.get('validatedQuery') as { limit: number };
  return successResponse(c, await getPartnerCandidates(user.id, eventId, limit), 'Candidates');
});

vibesRoutes.post('/events/:eventId/swipe', validateParams(eventIdParamSchema), validateBody(swipeSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  const { targetUserId, decision } = c.get('validatedBody') as { targetUserId: string; decision: 'accept' | 'reject' };
  return successResponse(c, await swipe(user.id, eventId, targetUserId, decision), 'Swipe recorded');
});

vibesRoutes.post('/events/:eventId/change-partner', validateParams(eventIdParamSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await changePartner(user.id, eventId), 'Partner deck re-rolled');
});

vibesRoutes.get('/matches', validateQuery(matchesQuerySchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedQuery') as { eventId?: string };
  return successResponse(c, await getMatches(user.id, eventId), 'Matches');
});

// --- Group -----------------------------------------------------------------
vibesRoutes.get('/groups', async (c) => {
  const user = c.get('user')!;
  return successResponse(c, await getMyGroups(user.id), 'My groups');
});

vibesRoutes.post('/events/:eventId/group/join', validateParams(eventIdParamSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await joinGroup(user.id, eventId), 'Joined group');
});

vibesRoutes.post('/events/:eventId/group/change', validateParams(eventIdParamSchema), async (c) => {
  const user = c.get('user')!;
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await changeGroup(user.id, eventId), 'Group changed');
});

// --- Chat (history + send; realtime delivery over the /vibes/ws socket) ----
vibesRoutes.get('/chat/:roomType/:roomId', validateParams(roomParamSchema), async (c) => {
  const user = c.get('user')!;
  const { roomType, roomId } = c.get('validatedParams') as { roomType: 'partner' | 'group'; roomId: string };
  return successResponse(c, await getChatMessages(user.id, roomType, roomId), 'Chat history');
});

vibesRoutes.post('/chat/:roomType/:roomId', validateParams(roomParamSchema), validateBody(sendMessageSchema), async (c) => {
  const user = c.get('user')!;
  const { roomType, roomId } = c.get('validatedParams') as { roomType: 'partner' | 'group'; roomId: string };
  const { body } = c.get('validatedBody') as { body: string };
  return successResponse(c, await sendChatMessage(user.id, roomType, roomId, body), 'Message sent');
});
