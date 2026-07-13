import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import { aiChatRateLimit } from '../../middlewares/rate-limit.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { aiChatController } from './controller.js';
import { aiChatRequestSchema } from './validation.js';

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use('*', authMiddleware);

aiRoutes.post('/chat', aiChatRateLimit, validateBody(aiChatRequestSchema), aiChatController.chat);
