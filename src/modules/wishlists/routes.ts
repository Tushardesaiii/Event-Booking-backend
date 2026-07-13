import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { wishlistsController } from './controller.js';
import { wishlistEventParamsSchema, wishlistListQuerySchema } from './validation.js';

export const wishlistsRoutes = new Hono<AppEnv>();

wishlistsRoutes.use('/wishlists', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
wishlistsRoutes.use('/wishlists/*', authMiddleware, tenantMiddleware({ routeParamNames: [] }));
wishlistsRoutes.use('/users/me/wishlist', authMiddleware, tenantMiddleware({ routeParamNames: [] }));

wishlistsRoutes.post('/wishlists/events/:eventId', validateParams(wishlistEventParamsSchema), wishlistsController.add);
wishlistsRoutes.delete('/wishlists/events/:eventId', validateParams(wishlistEventParamsSchema), wishlistsController.delete);
wishlistsRoutes.get('/wishlists', wishlistsController.list);
wishlistsRoutes.get('/users/me/wishlist', validateQuery(wishlistListQuerySchema), wishlistsController.getMyWishlist);
