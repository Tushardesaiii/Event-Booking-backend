import { randomUUID } from 'node:crypto';

import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { assets } from '../../db/schema/assets.js';
import { badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { r2Client } from '../../lib/r2.js';
import { extractMetadata, optimizeImage, resizeImage } from '../../lib/image-processing.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';

const MAX_DECODED_BYTES = 12 * 1024 * 1024; // 12MB pre-optimization ceiling
const MAX_EDGE = 1600; // longest side after normalization

export type AssetRole = 'banner' | 'thumbnail' | 'gallery' | 'poster' | 'cover';

const ROLE_FOLDER: Record<AssetRole, string> = {
  banner: 'events',
  poster: 'events',
  thumbnail: 'events',
  cover: 'events',
  gallery: 'events',
};

/** Strip a data-URI prefix and decode to a Buffer. Accepts raw base64 too. */
function decodeBase64Image(input: string): Buffer {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input.trim());
  const base64 = match ? match[2] : input.trim();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('Invalid image data');
  }
  if (buffer.length === 0) throw badRequest('Empty image data');
  if (buffer.length > MAX_DECODED_BYTES) throw badRequest('Image is too large (max 12MB)');
  return buffer;
}

export interface UploadAssetInput {
  image: string;
  role?: AssetRole;
  fileName?: string;
}

export interface UploadedAsset {
  id: string;
  key: string;
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  size: number;
}

/**
 * Accept a base64 image, normalize + optimize it with sharp (auto-orient, cap
 * the longest edge, strip EXIF, encode WebP), upload the processed bytes to R2,
 * and persist a row in the `assets` table. Returns the asset id (for
 * event.bannerAssetId / thumbnailAssetId) and a public URL served via /cdn.
 *
 * Processing on the server (rather than presigned passthrough) guarantees every
 * stored image is a sane size/format regardless of what the organizer uploads.
 */
export async function uploadImageAsset(
  tenantId: string | null,
  userId: string | undefined,
  input: UploadAssetInput,
): Promise<UploadedAsset> {
  const raw = decodeBase64Image(input.image);

  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await extractMetadata(raw);
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    throw badRequest('Unsupported or corrupt image');
  }

  // Normalize: auto-orient, cap longest edge, then encode WebP for delivery.
  let processed: Buffer;
  try {
    const bounded =
      width && height && Math.max(width, height) > MAX_EDGE
        ? await resizeImage(raw, MAX_EDGE, MAX_EDGE, 'inside')
        : raw;
    processed = await optimizeImage(bounded, 'webp', 82);
    // Re-read dimensions after a possible resize.
    const meta = await extractMetadata(processed);
    width = meta.width ?? width;
    height = meta.height ?? height;
  } catch (err: any) {
    logger.error('[Assets] Image optimization failed', { error: err?.message });
    throw badRequest('Could not process image');
  }

  const folder = ROLE_FOLDER[input.role ?? 'gallery'] ?? 'events';
  const key = `tenants/${tenantId ?? 'public'}/${folder}/${randomUUID()}.webp`;
  const mimeType = 'image/webp';

  await r2Client.uploadBuffer(key, processed, mimeType);

  const [row] = await db
    .insert(assets)
    .values({
      bucket: env.BUCKET_NAME || 'revelis',
      key,
      mimeType,
      size: processed.length,
      uploadedBy: userId ?? null,
    })
    .returning({ id: assets.id, key: assets.key });

  if (!row) throw badRequest('Failed to persist asset');

  return {
    id: row.id,
    key: row.key,
    url: cloudflareCdnService.buildPublicUrl(row.key),
    width,
    height,
    mimeType,
    size: processed.length,
  };
}
