// src/modules/artist/controllers/followController.ts
import type { Context } from 'hono';
import { FollowRequestSchema } from '../validators/followValidator.js';
import { followService } from '../services/followService.js';
import { artistService } from '../services/artistService.js';

export const followArtist = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug');
  const payload = FollowRequestSchema.parse({ tenantId, artistSlug: slug });
  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);
  const user = c.get('user');
  const userId = user?.id as string;
  await followService.follow(tenantId, artist.id, userId);
  return c.json({ success: true }, 200);
};

export const unfollowArtist = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug');
  const payload = FollowRequestSchema.parse({ tenantId, artistSlug: slug });
  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);
  const user = c.get('user');
  const userId = user?.id as string;
  await followService.unfollow(tenantId, artist.id, userId);
  return c.json({ success: true }, 200);
};

export const getFollowers = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;
  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);
  const { limit, offset } = c.req.query();
  const followers = await followService.getFollowers(tenantId, artist.id, Number(limit) || 20, Number(offset) || 0);
  return c.json(followers);
};

export const getFollowing = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const user = c.get('user');
  const userId = user?.id as string;
  const { limit, offset } = c.req.query();
  const following = await followService.getFollowing(tenantId, userId, Number(limit) || 20, Number(offset) || 0);
  return c.json(following);
};
