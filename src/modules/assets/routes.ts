import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { uploadRateLimit } from '../../middlewares/rate-limit.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { uploadImageAsset } from './service.js';

const uploadAssetSchema = z.object({
  // Accepts a data-URI (data:image/...;base64,...) or a raw base64 string.
  image: z.string().min(1, 'image is required'),
  role: z.enum(['banner', 'thumbnail', 'gallery', 'poster', 'cover']).optional(),
  fileName: z.string().max(255).optional(),
});

export type UploadAssetSchema = z.infer<typeof uploadAssetSchema>;

export const assetsRoutes = new Hono<AppEnv>();

// Tenant-scoped image upload. The image is optimized server-side (sharp) and
// stored in R2; the returned asset id is used for event banner/thumbnail.
assetsRoutes.post(
  '/upload',
  authMiddleware,
  tenantMiddleware({ routeParamNames: [] }),
  uploadRateLimit,
  validateBody(uploadAssetSchema),
  async (c) => {
    const input = c.get('validatedBody') as UploadAssetSchema;
    const tenant = c.get('tenant');
    const user = c.get('user');
    const result = await uploadImageAsset(tenant?.id ?? null, user?.id, input);
    return successResponse(c, result, 'Image uploaded', 201);
  },
);
