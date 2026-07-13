// src/modules/profile/controllers/profileController.ts
import type { Context } from 'hono';
import {
  ProfileCreateSchema,
  ProfileUpdateSchema,
  PreferencesUpdateSchema,
  TrustedContactSchema,
  BuddyPreferencesSchema,
  ReviewSchema,
  VerificationRequestSchema
} from '../validators/profileValidator.js';
import { profileService } from '../services/profileService.js';
import { activityService } from '../services/activityService.js';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/client.js';
import { assets } from '../../../db/schema/assets.js';
import { profileFollowers, profiles, profileInterests } from '../../../db/schema/profile.js';
import { eq, and, gt, sql, count, isNull } from 'drizzle-orm';
import { stories } from '../../stories/schema.js';
import { forbidden, notFound, unauthorized } from '../../../lib/errors.js';

function getContext(c: Context) {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id;
  const user = c.get('user');
  const userId = user?.id;
  if (!tenantId || !userId) {
    throw unauthorized('Tenant and user context are required');
  }
  return { tenantId, userId };
}

export const createProfile = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = ProfileCreateSchema.parse(body);
  const profile = await profileService.createProfile(tenantId, userId, payload);
  return c.json(profile, 201);
};

export const getProfile = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const profile = await profileService.getProfile(tenantId, userId);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  return c.json(profile);
};

export const updateProfile = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = ProfileUpdateSchema.parse(body);
  const version = Number(body.version ?? 0);
  const profile = await profileService.updateProfile(tenantId, userId, payload, version);
  return c.json(profile);
};

export const getPublicProfile = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const targetUsername = c.req.param('username') as string;
  const targetProfile = await profileService.getProfileByUsername(tenantId, targetUsername);
  if (!targetProfile) return c.json({ error: 'Profile not found' }, 404);

  // Check privacy
  if (targetProfile.userId !== userId) {
    if (targetProfile.profileVisibility === 'private') {
      return c.json({ error: 'Profile is private' }, 403);
    }
    if (targetProfile.profileVisibility === 'followers_only') {
      const viewerProfile = await profileService.getProfile(tenantId, userId);
      if (!viewerProfile) return c.json({ error: 'Profile not found' }, 404);
      // Check if follower
      const follower = await db
        .select()
        .from(profileFollowers)
        .where(and(
          eq(profileFollowers.tenantId, tenantId),
          eq(profileFollowers.followerProfileId, viewerProfile.id),
          eq(profileFollowers.followingProfileId, targetProfile.id)
        ))
        .limit(1);
      if (follower.length === 0) {
        return c.json({ error: 'Profile is only visible to followers' }, 403);
      }
    }
  }

  // Fetch full details
  const completion = await profileService.calculateCompletion(tenantId, targetProfile.id);
  const followers = await profileService.getFollowers(tenantId, targetUsername);
  const following = await profileService.getFollowing(tenantId, targetUsername);
  
  // Derived story counts
  const [storiesStats] = await db
    .select({
      total: count(),
      active: count(sql`case when expires_at > now() then 1 else null end`)
    })
    .from(stories)
    .where(and(
      eq(stories.tenantId, tenantId),
      eq(stories.ownerType, 'user'),
      eq(stories.ownerId, targetProfile.userId),
      isNull(stories.deletedAt)
    ));
  const storyCountVal = Number(storiesStats?.total ?? 0);
  const activeStoryCountVal = Number(storiesStats?.active ?? 0);

  const badgeList = await profileService.getAnalytics(tenantId, targetProfile.userId);

  return c.json({
    profile: targetProfile,
    completionPercentage: completion,
    followersCount: followers.length,
    followingCount: following.length,
    badgeCount: badgeList.badgeCount,
    storyCount: storyCountVal,
    activeStoryCount: activeStoryCountVal
  });
};

export const followUser = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const targetUsername = c.req.param('username') as string;
  await profileService.followUser(tenantId, userId, targetUsername);
  return c.json({ success: true }, 200);
};

export const unfollowUser = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const targetUsername = c.req.param('username') as string;
  await profileService.unfollowUser(tenantId, userId, targetUsername);
  return c.json({ success: true }, 200);
};

export const getFollowers = async (c: Context) => {
  const { tenantId } = getContext(c);
  const username = c.req.param('username') as string;
  const followers = await profileService.getFollowers(tenantId, username);
  return c.json(followers);
};

export const getFollowing = async (c: Context) => {
  const { tenantId } = getContext(c);
  const username = c.req.param('username') as string;
  const following = await profileService.getFollowing(tenantId, username);
  return c.json(following);
};

export const getPreferences = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const prefs = await profileService.getPreferences(tenantId, userId);
  return c.json(prefs);
};

export const updatePreferences = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = PreferencesUpdateSchema.parse(body);
  const updated = await profileService.updatePreferences(tenantId, userId, payload);
  return c.json(updated);
};

export const getBuddyPreferences = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const prefs = await profileService.getBuddyPreferences(tenantId, userId);
  return c.json(prefs);
};

export const updateBuddyPreferences = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = BuddyPreferencesSchema.parse(body);
  const updated = await profileService.updateBuddyPreferences(tenantId, userId, payload);
  return c.json(updated);
};

export const getInterests = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const interests = await profileService.getInterests(tenantId, userId);
  return c.json(interests);
};

export const addInterest = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const row = await profileService.addInterest(tenantId, userId, body.interest);
  return c.json(row, 201);
};

export const deleteInterest = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const id = c.req.param('id') as string;
  await profileService.deleteInterest(tenantId, userId, id);
  return c.json({ success: true }, 200);
};

export const getSocialLinks = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const links = await profileService.getSocialLinks(tenantId, userId);
  return c.json(links);
};

export const addSocialLink = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const link = await profileService.addSocialLink(tenantId, userId, body.platform, body.url);
  return c.json(link, 201);
};

export const updateSocialLink = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const linkId = c.req.param('id') as string;
  const body = await c.req.json().catch(() => ({}));
  const link = await profileService.updateSocialLink(tenantId, userId, linkId, body.url);
  return c.json(link);
};

export const deleteSocialLink = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const linkId = c.req.param('id') as string;
  await profileService.deleteSocialLink(tenantId, userId, linkId);
  return c.json({ success: true }, 200);
};

export const getSavedEvents = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const eventsList = await profileService.getSavedEvents(tenantId, userId);
  return c.json(eventsList);
};

export const addSavedEvent = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  await profileService.addSavedEvent(tenantId, userId, body.eventId);
  return c.json({ success: true }, 201);
};

export const removeSavedEvent = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const eventId = c.req.param('eventId') as string;
  await profileService.removeSavedEvent(tenantId, userId, eventId);
  return c.json({ success: true }, 200);
};

export const createOrUpdateReview = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = ReviewSchema.parse(body);
  const review = await profileService.createOrUpdateReview(tenantId, userId, payload.targetType, payload.targetId, payload.rating, payload.reviewText ?? undefined);
  return c.json(review, 201);
};

export const deleteReview = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const id = c.req.param('id') as string;
  await profileService.deleteReview(tenantId, userId, id);
  return c.json({ success: true }, 200);
};

export const getActivity = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const profile = await profileService.getProfile(tenantId, userId);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);

  const { limit, cursor } = c.req.query();
  const activities = await activityService.getActivities(tenantId, profile.id, Number(limit) || 20, cursor);
  return c.json(activities);
};

export const getPublicActivity = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const username = c.req.param('username') as string;
  const targetProfile = await profileService.getProfileByUsername(tenantId, username);
  if (!targetProfile) return c.json({ error: 'Profile not found' }, 404);

  // Check privacy restriction
  if (targetProfile.userId !== userId) {
    if (targetProfile.profileVisibility === 'private') {
      return c.json({ error: 'Activity is private' }, 403);
    }
    if (targetProfile.profileVisibility === 'followers_only') {
      const viewerProfile = await profileService.getProfile(tenantId, userId);
      if (!viewerProfile) return c.json({ error: 'Profile not found' }, 404);
      // Check if follower
      const follower = await db
        .select()
        .from(profileFollowers)
        .where(and(
          eq(profileFollowers.tenantId, tenantId),
          eq(profileFollowers.followerProfileId, viewerProfile.id),
          eq(profileFollowers.followingProfileId, targetProfile.id)
        ))
        .limit(1);
      if (follower.length === 0) {
        return c.json({ error: 'Activity is only visible to followers' }, 403);
      }
    }
  }

  const { limit, cursor } = c.req.query();
  const activities = await activityService.getActivities(tenantId, targetProfile.id, Number(limit) || 20, cursor);
  return c.json(activities);
};

export const requestVerification = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = VerificationRequestSchema.parse(body);
  const req = await profileService.requestVerification(tenantId, userId, payload.verificationType);
  return c.json(req, 201);
};

export const getAnalytics = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const stats = await profileService.getAnalytics(tenantId, userId);
  return c.json(stats);
};

export const searchProfiles = async (c: Context) => {
  const { tenantId } = getContext(c);
  const query = c.req.query();
  const results = await profileService.searchProfiles(tenantId, query);
  return c.json(results);
};

// Phase 5: Avatar & Cover Uploads (Cloudflare R2 Integration)
export const uploadAvatar = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const profile = await profileService.getProfile(tenantId, userId);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);

  const body = (await c.req.parseBody().catch(() => ({}))) as any;
  const file = body.file;
  if (!file) return c.json({ error: 'File is required' }, 400);

  try {
    const { storageService } = await import('../../../lib/storage.js');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const objectKey = await storageService.uploadSystemAsset(
      tenantId,
      profile.id,
      'users',
      file.name || 'avatar.png',
      buffer,
      file.type || 'image/png'
    );

    const downloadUrl = await storageService.getPrivateAssetUrl(objectKey, tenantId, userId);

    await db
      .update(profiles)
      .set({ avatarUrl: downloadUrl, updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));

    return c.json({ avatarUrl: downloadUrl }, 201);
  } catch (err: any) {
    logger.error('[ProfileController] Failed to upload avatar to R2', { error: err.message });
    return c.json({ error: err.message || 'Failed to upload avatar' }, err.status || 500);
  }
};

export const uploadCover = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const profile = await profileService.getProfile(tenantId, userId);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);

  const body = (await c.req.parseBody().catch(() => ({}))) as any;
  const file = body.file;
  if (!file) return c.json({ error: 'File is required' }, 400);

  try {
    const { storageService } = await import('../../../lib/storage.js');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const objectKey = await storageService.uploadSystemAsset(
      tenantId,
      profile.id,
      'users',
      file.name || 'cover.png',
      buffer,
      file.type || 'image/png'
    );

    const downloadUrl = await storageService.getPrivateAssetUrl(objectKey, tenantId, userId);

    await db
      .update(profiles)
      .set({ coverImageUrl: downloadUrl, updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));

    return c.json({ coverImageUrl: downloadUrl }, 201);
  } catch (err: any) {
    logger.error('[ProfileController] Failed to upload cover image to R2', { error: err.message });
    return c.json({ error: err.message || 'Failed to upload cover' }, err.status || 500);
  }
};

// Trusted contacts routes
export const getTrustedContacts = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const contacts = await profileService.getTrustedContacts(tenantId, userId);
  return c.json(contacts);
};

export const addTrustedContact = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const body = await c.req.json().catch(() => ({}));
  const payload = TrustedContactSchema.parse(body);
  const contact = await profileService.addTrustedContact(tenantId, userId, payload);
  return c.json(contact, 201);
};

export const updateTrustedContact = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const contactId = c.req.param('id') as string;
  const body = await c.req.json().catch(() => ({}));
  const payload = TrustedContactSchema.partial().parse(body);
  const contact = await profileService.updateTrustedContact(tenantId, userId, contactId, payload);
  return c.json(contact);
};

export const deleteTrustedContact = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const contactId = c.req.param('id') as string;
  await profileService.deleteTrustedContact(tenantId, userId, contactId);
  return c.json({ success: true }, 200);
};

// Public Stories integration
export const getPublicStories = async (c: Context) => {
  const { tenantId, userId } = getContext(c);
  const username = c.req.param('username') as string;
  const targetProfile = await profileService.getProfileByUsername(tenantId, username);
  if (!targetProfile) return c.json({ error: 'Profile not found' }, 404);

  // Check privacy
  if (targetProfile.userId !== userId) {
    if (targetProfile.profileVisibility === 'private') {
      return c.json({ error: 'Stories are private' }, 403);
    }
    if (targetProfile.profileVisibility === 'followers_only') {
      const viewerProfile = await profileService.getProfile(tenantId, userId);
      if (!viewerProfile) return c.json({ error: 'Profile not found' }, 404);
      const follower = await db
        .select()
        .from(profileFollowers)
        .where(and(
          eq(profileFollowers.tenantId, tenantId),
          eq(profileFollowers.followerProfileId, viewerProfile.id),
          eq(profileFollowers.followingProfileId, targetProfile.id)
        ))
        .limit(1);
      if (follower.length === 0) {
        return c.json({ error: 'Stories are only visible to followers' }, 403);
      }
    }
  }

  // Fetch target user's stories from existing general stories/artist stories
  const list = await db
    .select()
    .from(stories)
    .where(and(
      eq(stories.tenantId, tenantId),
      eq(stories.ownerType, 'user'),
      eq(stories.ownerId, targetProfile.userId),
      isNull(stories.deletedAt),
      gt(stories.expiresAt, new Date())
    ));
  return c.json(list);
};
