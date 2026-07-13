import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { searchRateLimit } from '../../middlewares/rate-limit.middleware.js';

import * as artistController from './controllers/artistController.js';
import * as followController from './controllers/followController.js';
import * as eventArtistController from './controllers/eventArtistController.js';
import * as storyController from './controllers/storyController.js';
import * as discoveryController from './controllers/discoveryController.js';
import * as trendingController from './controllers/trendingController.js';
import * as recommendationController from './controllers/recommendationController.js';
import * as verificationController from './controllers/verificationController.js';
import * as alertController from './controllers/alertController.js';
import * as analyticsController from './controllers/analyticsController.js';
import * as directoryController from './controllers/directoryController.js';

export const artistRoutes = new Hono<AppEnv>();

artistRoutes.use('*', authMiddleware);
artistRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Platform-global directory (search + organizer contribution). Declared before
// the tenant-scoped `/:slug` routes so "directory" isn't swallowed as a slug.
artistRoutes.get('/directory', searchRateLimit, directoryController.searchArtistDirectory);
artistRoutes.post('/directory', directoryController.contributeArtist);

// Discovery, trending, recommendations, feed, alerts
artistRoutes.get('/discover', searchRateLimit, discoveryController.discoverArtists);
artistRoutes.get('/trending', searchRateLimit, trendingController.getTrendingArtists);
artistRoutes.get('/recommendations', searchRateLimit, recommendationController.getRecommendedArtists);
artistRoutes.get('/stories/feed', storyController.getStoriesFeed);
artistRoutes.get('/alerts/me', alertController.listAlertsForUser);
artistRoutes.get('/me/following', followController.getFollowing);

// Event association queries
artistRoutes.get('/events/:eventSlug/artists', eventArtistController.getArtistsForEvent);
artistRoutes.get('/artists/:artistSlug/events', eventArtistController.getEventsForArtist);

// CRUD for artists
artistRoutes.post('/', requirePermission(['tenant.manage']), artistController.createArtist);
artistRoutes.get('/', searchRateLimit, artistController.listArtists);
artistRoutes.get('/:slug', artistController.getArtist);
artistRoutes.patch('/:slug', requirePermission(['tenant.manage']), artistController.updateArtist);
artistRoutes.delete('/:slug', requirePermission(['tenant.manage']), artistController.deleteArtist);

// Follow
artistRoutes.post('/:slug/follow', followController.followArtist);
artistRoutes.delete('/:slug/follow', followController.unfollowArtist);
artistRoutes.get('/:slug/followers', followController.getFollowers);

// Event association management
artistRoutes.post('/:artistSlug/events/:eventSlug', requirePermission(['tenant.manage']), eventArtistController.addArtistToEvent);
artistRoutes.delete('/:artistSlug/events/:eventSlug', requirePermission(['tenant.manage']), eventArtistController.removeArtistFromEvent);

// Stories
artistRoutes.post('/:slug/stories', requirePermission(['tenant.manage']), storyController.createStory);
artistRoutes.get('/:slug/stories', storyController.listStories);
artistRoutes.delete('/:slug/stories/:storyId', requirePermission(['tenant.manage']), storyController.deleteStory);
artistRoutes.post('/stories/:storyId/view', storyController.recordStoryView);
artistRoutes.post('/stories/:storyId/react', storyController.recordStoryReaction);

// Verification
artistRoutes.post('/:slug/verify', verificationController.requestVerification);
artistRoutes.post('/:slug/verify/approve', requirePermission(['tenant.manage']), verificationController.approveVerification);
artistRoutes.post('/:slug/verify/reject', requirePermission(['tenant.manage']), verificationController.rejectVerification);
artistRoutes.get('/:slug/verify', verificationController.getVerificationStatus);

// Alerts
artistRoutes.post('/:slug/alerts', alertController.createOrUpdateAlert);
artistRoutes.delete('/:slug/alerts', alertController.deleteAlert);

// Analytics
artistRoutes.get('/:slug/analytics', requirePermission(['tenant.manage']), analyticsController.getArtistDashboard);
