import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePlatformAdmin } from '../../middlewares/platform-admin.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { successResponse, paginatedResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import * as svc from './service.js';
import {
  createDirectoryArtist,
  updateDirectoryArtist,
  deleteDirectoryArtist,
  listDirectoryForAdmin,
  getDirectoryArtist,
  setArtistVerification,
} from '../artist/services/directoryService.js';
import {
  directoryArtistCreateSchema,
  directoryArtistUpdateSchema,
  directoryListSchema,
  artistVerificationSchema,
} from '../artist/validators/directoryValidator.js';
import { getPlatformSettings, updatePlatformSettings } from './settings.service.js';

// Convenience fee accepted as a percentage (0–100, up to 2 decimals) and stored
// as basis points so the app/backend share one integer source of truth.
const platformSettingsSchema = z.object({
  convenienceFeePercent: z.coerce.number().min(0).max(100),
});

const reviewQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'cancelled', 'completed', 'archived']).optional()
});
const idParamsSchema = z.object({ id: z.string().uuid() });
const rejectSchema = z.object({ reason: z.string().trim().max(1000).optional().nullable() });
const orgVerificationSchema = z.object({ status: z.enum(['verified', 'rejected', 'pending']) });
const applicationsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});

export const platformAdminRoutes = new Hono<AppEnv>();

// Cross-tenant: no tenantMiddleware. Platform-admin only.
platformAdminRoutes.use('*', authMiddleware);
platformAdminRoutes.use('*', requirePlatformAdmin);

// Global platform settings (convenience fee, …).
platformAdminRoutes.get('/settings', async (c) => {
  return successResponse(c, await getPlatformSettings(), 'Platform settings loaded');
});

platformAdminRoutes.put('/settings', validateBody(platformSettingsSchema), async (c) => {
  const user = c.get('user')!;
  const { convenienceFeePercent } = c.get('validatedBody') as z.infer<typeof platformSettingsSchema>;
  const convenienceFeeBps = Math.round(convenienceFeePercent * 100);
  return successResponse(c, await updatePlatformSettings({ convenienceFeeBps }, user.id), 'Platform settings updated');
});

// Events submitted for review (default: drafts).
platformAdminRoutes.get('/events/review', validateQuery(reviewQuerySchema), async (c) => {
  const query = c.get('validatedQuery') as z.infer<typeof reviewQuerySchema>;
  return successResponse(c, await svc.listEventsForReview(query.status ?? 'draft'), 'Events for review loaded');
});

platformAdminRoutes.post('/events/:id/approve', validateParams(idParamsSchema), async (c) => {
  const user = c.get('user')!;
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await svc.approveEvent(id, user.id), 'Event approved');
});

platformAdminRoutes.post('/events/:id/reject', validateParams(idParamsSchema), validateBody(rejectSchema), async (c) => {
  const user = c.get('user')!;
  const { id } = c.get('validatedParams') as { id: string };
  const { reason } = c.get('validatedBody') as z.infer<typeof rejectSchema>;
  return successResponse(c, await svc.rejectEvent(id, reason ?? null, user.id), 'Event rejected');
});

// Organizers — platform-wide directory + verification governance.
platformAdminRoutes.get('/organizers', async (c) => {
  return successResponse(c, await svc.listAllOrganizers(), 'Organizers loaded');
});

platformAdminRoutes.post(
  '/organizers/:id/verification',
  validateParams(idParamsSchema),
  validateBody(orgVerificationSchema),
  async (c) => {
    const { id } = c.get('validatedParams') as { id: string };
    const { status } = c.get('validatedBody') as z.infer<typeof orgVerificationSchema>;
    return successResponse(c, await svc.setOrganizerVerification(id, status), 'Organizer updated');
  }
);

// Organizer applications — the "become an organizer" approval queue.
platformAdminRoutes.get('/organizer-applications', validateQuery(applicationsQuerySchema), async (c) => {
  const query = c.get('validatedQuery') as z.infer<typeof applicationsQuerySchema>;
  return successResponse(c, await svc.listOrganizerApplications(query.status), 'Organizer applications loaded');
});

platformAdminRoutes.post(
  '/organizer-applications/:id/approve',
  validateParams(idParamsSchema),
  async (c) => {
    const { id } = c.get('validatedParams') as { id: string };
    return successResponse(c, await svc.approveOrganizerApplication(id), 'Organizer approved');
  }
);

platformAdminRoutes.post(
  '/organizer-applications/:id/reject',
  validateParams(idParamsSchema),
  validateBody(rejectSchema),
  async (c) => {
    const { id } = c.get('validatedParams') as { id: string };
    const { reason } = c.get('validatedBody') as z.infer<typeof rejectSchema>;
    return successResponse(c, await svc.rejectOrganizerApplication(id, reason ?? null), 'Organizer rejected');
  }
);

// All events across the platform (any status when `status` is omitted).
platformAdminRoutes.get('/events', validateQuery(reviewQuerySchema), async (c) => {
  const query = c.get('validatedQuery') as z.infer<typeof reviewQuerySchema>;
  return successResponse(c, await svc.listEventsForReview(query.status), 'Events loaded');
});

// Cross-tenant settlements (read-only for the platform console).
platformAdminRoutes.get('/settlements', async (c) => {
  return successResponse(c, await svc.listAllSettlements(), 'Settlements loaded');
});

// Platform-wide analytics overview.
platformAdminRoutes.get('/analytics', async (c) => {
  return successResponse(c, await svc.getPlatformAnalytics(), 'Analytics loaded');
});

// Cross-tenant payments overview (Razorpay-backed money view).
platformAdminRoutes.get('/payments', async (c) => {
  return successResponse(c, await svc.getPlatformPayments(), 'Payments loaded');
});

// Cross-tenant social content (read-only moderation views).
platformAdminRoutes.get('/stories', async (c) => {
  return successResponse(c, await svc.listAllStories(), 'Stories loaded');
});

platformAdminRoutes.get('/gallery', async (c) => {
  return successResponse(c, await svc.listAllGalleryPhotos(), 'Gallery loaded');
});

// Users & attendees — platform-wide directory.
platformAdminRoutes.get('/users', async (c) => {
  return successResponse(c, await svc.listAllUsers(), 'Users loaded');
});

// Artists — the platform-global directory superadmin curates for every organizer.
platformAdminRoutes.get('/artists', validateQuery(directoryListSchema), async (c) => {
  const query = c.get('validatedQuery') as z.infer<typeof directoryListSchema>;
  const { items, meta } = await listDirectoryForAdmin(query);
  return paginatedResponse(c, items, meta, 'Artists loaded');
});

platformAdminRoutes.get('/artists/:id', validateParams(idParamsSchema), async (c) => {
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await getDirectoryArtist(id), 'Artist loaded');
});

platformAdminRoutes.post('/artists', validateBody(directoryArtistCreateSchema), async (c) => {
  const user = c.get('user')!;
  const input = c.get('validatedBody') as z.infer<typeof directoryArtistCreateSchema>;
  const artist = await createDirectoryArtist(input, {
    tenantId: null,
    createdByUserId: user.id,
    source: 'platform',
  });
  return successResponse(c, artist, 'Artist created', 201);
});

platformAdminRoutes.patch(
  '/artists/:id',
  validateParams(idParamsSchema),
  validateBody(directoryArtistUpdateSchema),
  async (c) => {
    const { id } = c.get('validatedParams') as { id: string };
    const input = c.get('validatedBody') as z.infer<typeof directoryArtistUpdateSchema>;
    return successResponse(c, await updateDirectoryArtist(id, input), 'Artist updated');
  },
);

// Verification gate — approve / reject / re-queue an artist so event managers can use it.
platformAdminRoutes.post(
  '/artists/:id/verification',
  validateParams(idParamsSchema),
  validateBody(artistVerificationSchema),
  async (c) => {
    const { id } = c.get('validatedParams') as { id: string };
    const { status } = c.get('validatedBody') as z.infer<typeof artistVerificationSchema>;
    return successResponse(c, await setArtistVerification(id, status), 'Artist verification updated');
  },
);

platformAdminRoutes.delete('/artists/:id', validateParams(idParamsSchema), async (c) => {
  const { id } = c.get('validatedParams') as { id: string };
  return successResponse(c, await deleteDirectoryArtist(id), 'Artist removed');
});
