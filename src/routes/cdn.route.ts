import type { Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';

import { logger } from '../lib/logger.js';
import { r2Client } from '../lib/r2.js';
import { resizeImage, optimizeImage } from '../lib/image-processing.js';
import { db } from '../db/client.js';
import { storageObjects } from '../db/schema/storage-objects.js';
import { env } from '../config/env.js';
import type { AppEnv } from '../types/context.js';

// Public origin that serves stored objects from R2 (Cloudflare). This is the
// concrete implementation behind CDN_BASE_URL (default http://localhost:3000/cdn)
// — the public/event APIs hand back `${CDN_BASE_URL}/${key}` and this route
// streams (or on-the-fly resizes) the object back.
//
// SECURITY: this endpoint is unauthenticated so image URLs can be embedded in
// <img> tags, therefore it must ONLY serve objects that are explicitly public.
// Private modules (organizer KYC, tickets, payment invoices, exports) are always
// registered in `storage_objects` with a non-public `visibility` by lib/storage.ts,
// so we refuse to stream any key whose storage record is not `public`. Objects
// with no storage record are legacy/public-media (event images, avatars) and are
// served. Private assets must be fetched via the signed-download endpoint instead.

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Hosts we are willing to 302-redirect legacy absolute-URL keys to. Prevents the
// endpoint from being used as an open redirect via an attacker-supplied key.
function isTrustedRedirectHost(urlString: string): boolean {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    const trusted: string[] = [];
    try {
      if (env.CDN_BASE_URL) trusted.push(new URL(env.CDN_BASE_URL).hostname.toLowerCase());
    } catch { /* ignore malformed config */ }
    const suffixes = ['.r2.dev', '.r2.cloudflarestorage.com', '.cloudflare.com'];
    return trusted.includes(host) || suffixes.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

async function isServableViaCdn(objectKey: string): Promise<boolean> {
  const [record] = await db
    .select({ visibility: storageObjects.visibility })
    .from(storageObjects)
    .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
    .limit(1);
  // No record => legacy/public media (private modules always create a record).
  if (!record) return true;
  return record.visibility === 'public';
}

function clampDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.round(n), 2000);
}

export async function serveCdnObject(c: Context<AppEnv>) {
  const key = c.req.param('key');
  if (!key) {
    return c.text('Not found', 404);
  }

  // If the key is itself an absolute URL (legacy/seeded assets), redirect to it —
  // but only to trusted hosts, so this cannot be abused as an open redirect.
  if (/^https?:\/\//i.test(key)) {
    if (isTrustedRedirectHost(key)) {
      return c.redirect(key, 302);
    }
    logger.warn('[CDN] Refused redirect to untrusted host', { key });
    return c.text('Not found', 404);
  }

  // Refuse to serve any object that is not explicitly public.
  try {
    if (!(await isServableViaCdn(key))) {
      logger.warn('[CDN] Refused to serve non-public object', { key });
      return c.text('Not found', 404);
    }
  } catch (err: any) {
    logger.error('[CDN] Visibility check failed', { key, error: err?.message });
    return c.text('Failed to load asset', 502);
  }

  try {
    const head = await r2Client.headObject(key);
    const etag = head.etag ? head.etag.replace(/"/g, '') : undefined;

    if (etag && c.req.header('if-none-match') === etag) {
      return c.body(null, 304);
    }

    const width = clampDimension(c.req.query('w'));
    const height = clampDimension(c.req.query('h'));
    const isImage = head.mimeType.startsWith('image/');

    // On-the-fly resize for responsive thumbnails (?w=&h=&fit=).
    if (isImage && (width || height)) {
      const fitParam = c.req.query('fit');
      const fit = (['cover', 'contain', 'inside', 'outside'] as const).includes(fitParam as never)
        ? (fitParam as 'cover' | 'contain' | 'inside' | 'outside')
        : 'cover';
      const source = await r2Client.getObjectBuffer(key);
      const resized = await resizeImage(source, width ?? height!, height ?? width!, fit);
      const out = await optimizeImage(resized, 'webp', 82);
      c.header('Content-Type', 'image/webp');
      c.header('Content-Length', String(out.length));
      c.header('Cache-Control', IMMUTABLE_CACHE);
      if (etag) c.header('ETag', `"${etag}-w${width ?? 0}h${height ?? 0}${fit}"`);
      return c.body(new Uint8Array(out), 200);
    }

    const range = c.req.header('Range');
    const stream = await r2Client.getObjectStream(key, range);
    c.header('Content-Type', head.mimeType);
    c.header('Content-Length', String(head.size));
    c.header('Cache-Control', IMMUTABLE_CACHE);
    c.header('Accept-Ranges', 'bytes');
    if (etag) c.header('ETag', `"${etag}"`);

    if (range) {
      c.header('Content-Range', range);
      return c.body(stream, 206);
    }
    return c.body(stream, 200);
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404 || /not ?found/i.test(err?.message ?? '')) {
      return c.text('Not found', 404);
    }
    logger.error('[CDN] Failed to serve object', { key, error: err?.message });
    return c.text('Failed to load asset', 502);
  }
}
