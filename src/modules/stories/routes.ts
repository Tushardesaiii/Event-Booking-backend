import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { storiesController } from './controller.js';
import {
  createStorySchema,
  storyReactionSchema,
  storyReplySchema,
  storyListQuerySchema,
  storyIdParamsSchema
} from './validation.js';

export const storiesRoutes = new Hono<AppEnv>();

storiesRoutes.use('*', authMiddleware);
storiesRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

storiesRoutes.post('/', validateBody(createStorySchema), storiesController.create);
storiesRoutes.get('/', validateQuery(storyListQuerySchema), storiesController.list);

storiesRoutes.get('/:id', validateParams(storyIdParamsSchema), storiesController.get);
storiesRoutes.delete('/:id', validateParams(storyIdParamsSchema), storiesController.delete);

storiesRoutes.post('/:id/view', validateParams(storyIdParamsSchema), storiesController.view);
storiesRoutes.post('/:id/react', validateParams(storyIdParamsSchema), validateBody(storyReactionSchema), storiesController.react);
storiesRoutes.post('/:id/reply', validateParams(storyIdParamsSchema), validateBody(storyReplySchema), storiesController.reply);

storiesRoutes.post('/cleanup/run', storiesController.cleanup);
