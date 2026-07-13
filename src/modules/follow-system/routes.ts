import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { followsController } from './controller.js';
import { followParamsSchema, followQuerySchema } from './validation.js';

export const followsRoutes = new Hono<AppEnv>();

followsRoutes.use('/users/:id/follow', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
followsRoutes.use('/users/:id/followers', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
followsRoutes.use('/users/:id/following', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
followsRoutes.use('/organizers/:id/follow', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
followsRoutes.use('/artists/:id/follow', authMiddleware, tenantMiddleware({ routeParamNames: [] }));

followsRoutes.post('/users/:id/follow', validateParams(followParamsSchema), followsController.followUser);
followsRoutes.delete('/users/:id/follow', validateParams(followParamsSchema), followsController.unfollowUser);

followsRoutes.post('/organizers/:id/follow', validateParams(followParamsSchema), followsController.followOrganizer);
followsRoutes.delete('/organizers/:id/follow', validateParams(followParamsSchema), followsController.unfollowOrganizer);

followsRoutes.post('/artists/:id/follow', validateParams(followParamsSchema), followsController.followArtist);
followsRoutes.delete('/artists/:id/follow', validateParams(followParamsSchema), followsController.unfollowArtist);

followsRoutes.get('/users/:id/followers', validateParams(followParamsSchema), validateQuery(followQuerySchema), followsController.getFollowers);
followsRoutes.get('/users/:id/following', validateParams(followParamsSchema), validateQuery(followQuerySchema), followsController.getFollowing);
