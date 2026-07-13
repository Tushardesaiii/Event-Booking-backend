// src/modules/artist/controllers/artistController.ts
import type { Context } from 'hono';
import { artistService } from '../services/artistService.js';
import { artistRepository } from '../repositories/artistRepository.js';
import { ArtistCreateSchema } from '../validators/artistCreateValidator.js';
import { ArtistUpdateSchema } from '../validators/artistUpdateValidator.js';

export const createArtist = async (c: Context) => {
  const payload = await c.req.json();
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const parsed = ArtistCreateSchema.parse({ ...payload, tenantId });
  const artist = await artistService.create(parsed);
  return c.json(artist, 201);
};

export const getArtist = async (c: Context) => {
  const slug = c.req.param('slug') as string;
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);
  return c.json(artist);
};

export const listArtists = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const query = c.req.query();
  const artistsList = await artistRepository.list({ tenantId, ...query } as any);
  return c.json(artistsList);
};

export const updateArtist = async (c: Context) => {
  const slug = c.req.param('slug') as string;
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const payload = await c.req.json();
  const parsed = ArtistUpdateSchema.parse({ ...payload, tenantId, slug });
  const existing = await artistService.findBySlug(tenantId, slug);
  if (!existing) return c.json({ error: 'Artist not found' }, 404);
  const updated = await artistService.update(tenantId, existing.id, parsed, parsed.version ?? 0);
  return c.json(updated);
};

export const deleteArtist = async (c: Context) => {
  const slug = c.req.param('slug') as string;
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const existing = await artistService.findBySlug(tenantId, slug);
  if (!existing) return c.json({ error: 'Artist not found' }, 404);
  await artistService.softDelete(tenantId, existing.id);
  return c.json({ success: true }, 200);
};
