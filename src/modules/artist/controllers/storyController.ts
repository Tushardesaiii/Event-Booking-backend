// src/modules/artist/controllers/storyController.ts
import type { Context } from 'hono';
import { StoryCreateSchema } from '../validators/storyCreateValidator.js';
import { StoryViewSchema, StoryReactionSchema } from '../validators/storyInteractionValidator.js';
import { storyService } from '../services/storyService.js';
import { artistService } from '../services/artistService.js';

export const createStory = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({}));
  const payload = StoryCreateSchema.parse({ tenantId, artistSlug: slug, ...body });

  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const story = await storyService.createStory(tenantId, artist.id, {
    mediaUrl: payload.mediaUrl,
    caption: payload.caption,
    type: payload.type
  });
  return c.json(story, 201);
};

export const listStories = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;
  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const stories = await storyService.getStories(tenantId, artist.id);
  return c.json(stories);
};

export const deleteStory = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const storyId = c.req.param('storyId') as string;
  await storyService.deleteStory(tenantId, storyId);
  return c.json({ success: true }, 200);
};

export const getStoriesFeed = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const { limit, offset } = c.req.query();
  const feed = await storyService.getFeed(tenantId, Number(limit) || 20, Number(offset) || 0);
  return c.json(feed);
};

export const recordStoryView = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const user = c.get('user');
  const userId = user?.id as string;
  const storyId = c.req.param('storyId');
  const payload = StoryViewSchema.parse({ tenantId, storyId, viewerUserId: userId });

  await storyService.recordView(tenantId, payload.storyId, payload.viewerUserId);
  return c.json({ success: true }, 201);
};

export const recordStoryReaction = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const user = c.get('user');
  const userId = user?.id as string;
  const storyId = c.req.param('storyId');
  const body = await c.req.json().catch(() => ({}));
  const payload = StoryReactionSchema.parse({ tenantId, storyId, userId, reactionType: body.reactionType });

  await storyService.recordReaction(tenantId, payload.storyId, payload.userId, payload.reactionType);
  return c.json({ success: true }, 201);
};
