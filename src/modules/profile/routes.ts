// src/modules/profile/routes.ts
import { Hono } from 'hono';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import type { AppEnv } from '../../types/context.js';
import * as profileController from './controllers/profileController.js';

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.use('*', authMiddleware);
profileRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

// Global search
profileRoutes.get('/search', profileController.searchProfiles);

// Current User profile routes
profileRoutes.post('/', profileController.createProfile);
profileRoutes.get('/me', profileController.getProfile);
profileRoutes.patch('/me', profileController.updateProfile);
profileRoutes.get('/me/analytics', profileController.getAnalytics);
profileRoutes.get('/me/activity', profileController.getActivity);

// Preferences routes
profileRoutes.get('/me/preferences', profileController.getPreferences);
profileRoutes.patch('/me/preferences', profileController.updatePreferences);

// Buddy Preferences routes
profileRoutes.get('/me/buddy-preferences', profileController.getBuddyPreferences);
profileRoutes.patch('/me/buddy-preferences', profileController.updateBuddyPreferences);

// Uploads
profileRoutes.post('/me/avatar', profileController.uploadAvatar);
profileRoutes.post('/me/cover', profileController.uploadCover);

// Interests
profileRoutes.get('/me/interests', profileController.getInterests);
profileRoutes.post('/me/interests', profileController.addInterest);
profileRoutes.delete('/me/interests/:id', profileController.deleteInterest);

// Social Links
profileRoutes.get('/me/social-links', profileController.getSocialLinks);
profileRoutes.post('/me/social-links', profileController.addSocialLink);
profileRoutes.patch('/me/social-links/:id', profileController.updateSocialLink);
profileRoutes.delete('/me/social-links/:id', profileController.deleteSocialLink);

// Saved Events (Wishlist)
profileRoutes.get('/me/saved-events', profileController.getSavedEvents);
profileRoutes.post('/me/saved-events', profileController.addSavedEvent);
profileRoutes.delete('/me/saved-events/:eventId', profileController.removeSavedEvent);

// Trusted Contacts
profileRoutes.get('/me/trusted-contacts', profileController.getTrustedContacts);
profileRoutes.post('/me/trusted-contacts', profileController.addTrustedContact);
profileRoutes.patch('/me/trusted-contacts/:id', profileController.updateTrustedContact);
profileRoutes.delete('/me/trusted-contacts/:id', profileController.deleteTrustedContact);

// Reviews
profileRoutes.post('/reviews', profileController.createOrUpdateReview);
profileRoutes.delete('/reviews/:id', profileController.deleteReview);

// Verification Requests
profileRoutes.post('/me/verify', profileController.requestVerification);

// Public profiles (by username)
profileRoutes.get('/:username', profileController.getPublicProfile);
profileRoutes.post('/:username/follow', profileController.followUser);
profileRoutes.delete('/:username/follow', profileController.unfollowUser);
profileRoutes.get('/:username/followers', profileController.getFollowers);
profileRoutes.get('/:username/following', profileController.getFollowing);
profileRoutes.get('/:username/activity', profileController.getPublicActivity);
profileRoutes.get('/:username/stories', profileController.getPublicStories);
