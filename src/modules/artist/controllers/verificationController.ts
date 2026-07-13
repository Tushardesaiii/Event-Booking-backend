// src/modules/artist/controllers/verificationController.ts
import type { Context } from 'hono';
import { verificationService } from '../services/verificationService.js';
import { artistService } from '../services/artistService.js';

export const requestVerification = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const [verification] = await verificationService.requestVerification(tenantId, artist.id);
  return c.json(verification, 201);
};

export const approveVerification = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;
  const user = c.get('user');
  const reviewerId = user?.id as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  await verificationService.approveVerification(tenantId, artist.id, reviewerId);
  return c.json({ success: true, verified: true }, 200);
};

export const rejectVerification = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;
  const user = c.get('user');
  const reviewerId = user?.id as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  await verificationService.rejectVerification(tenantId, artist.id, reviewerId);
  return c.json({ success: true, verified: false }, 200);
};

export const getVerificationStatus = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const slug = c.req.param('slug') as string;

  const artist = await artistService.findBySlug(tenantId, slug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const status = await verificationService.getVerificationStatus(tenantId, artist.id);
  return c.json({ status });
};
