import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { groupChatController } from './controller.js';
import {
  createChatRoomSchema,
  sendMessageSchema,
  editMessageSchema,
  reactMessageSchema,
  messageListQuerySchema,
  chatRoomIdParamsSchema,
  chatMessageIdParamsSchema
} from './validation.js';

export const groupChatRoutes = new Hono<AppEnv>();

groupChatRoutes.use('*', authMiddleware);
groupChatRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

groupChatRoutes.post('/rooms', validateBody(createChatRoomSchema), groupChatController.createRoom);
groupChatRoutes.get('/rooms/:id', validateParams(chatRoomIdParamsSchema), groupChatController.getRoom);

groupChatRoutes.post(
  '/rooms/:id/messages',
  validateParams(chatRoomIdParamsSchema),
  validateBody(sendMessageSchema),
  groupChatController.sendMessage
);

groupChatRoutes.get(
  '/rooms/:id/messages',
  validateParams(chatRoomIdParamsSchema),
  validateQuery(messageListQuerySchema),
  groupChatController.getMessages
);

groupChatRoutes.patch(
  '/messages/:id',
  validateParams(chatMessageIdParamsSchema),
  validateBody(editMessageSchema),
  groupChatController.editMessage
);

groupChatRoutes.delete(
  '/messages/:id',
  validateParams(chatMessageIdParamsSchema),
  groupChatController.deleteMessage
);

groupChatRoutes.post(
  '/messages/:id/reactions',
  validateParams(chatMessageIdParamsSchema),
  validateBody(reactMessageSchema),
  groupChatController.reactToMessage
);

groupChatRoutes.delete(
  '/messages/:id/reactions',
  validateParams(chatMessageIdParamsSchema),
  validateBody(reactMessageSchema),
  groupChatController.removeReaction
);
