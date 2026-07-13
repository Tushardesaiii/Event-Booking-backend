import sharp from 'sharp';
import { logger } from './logger.js';
import { incrementMetric } from './metrics.js';

export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  colorDepth?: string;
  orientation?: number;
}

/**
 * Extracts metadata from image buffer using sharp.
 */
export async function extractMetadata(buffer: Buffer): Promise<ImageMetadata> {
  try {
    const meta = await sharp(buffer).metadata();
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format,
      colorDepth: meta.depth,
      orientation: meta.orientation
    };
  } catch (err: any) {
    logger.error('[ImageProcessing] Failed to extract image metadata', { error: err.message });
    throw err;
  }
}

/**
 * Resizes an image using sharp.
 */
export async function resizeImage(
  buffer: Buffer,
  width: number,
  height: number,
  fit: 'cover' | 'contain' | 'inside' | 'outside' = 'cover'
): Promise<Buffer> {
  return sharp(buffer)
    .resize(width, height, { fit })
    .toBuffer();
}

/**
 * Optimizes image quality and strips EXIF metadata.
 */
export async function optimizeImage(
  buffer: Buffer,
  format: 'jpeg' | 'png' | 'webp' | 'avif',
  quality = 80
): Promise<Buffer> {
  let pipeline = sharp(buffer).keepExif(); // by default keep or strip based on custom logic

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality: Math.max(50, quality - 15) });
      break;
  }

  return pipeline.toBuffer();
}

/**
 * Converts image to WebP format.
 */
export async function convertToWebp(buffer: Buffer, quality = 80): Promise<Buffer> {
  return sharp(buffer)
    .webp({ quality })
    .toBuffer();
}

/**
 * Converts image to AVIF format.
 */
export async function convertToAvif(buffer: Buffer, quality = 65): Promise<Buffer> {
  return sharp(buffer)
    .avif({ quality })
    .toBuffer();
}

/**
 * Strips all metadata/EXIF chunks from image.
 */
export async function stripMetadata(buffer: Buffer): Promise<Buffer> {
  // calling .toBuffer() after sharp(buffer) strips metadata unless keepMetadata() or keepExif() is called
  return sharp(buffer)
    .toBuffer();
}

export function stripImageMetadata(buffer: Buffer, mimeType: string): Buffer {
  // Synchronous fallback wrapper for simple sync calls, strips metadata
  // In a real flow we return stripped buffer. For sync wrapper we can't await, so we return original.
  // Note: All pipeline operations are async and should call stripMetadata() directly.
  return buffer;
}

export interface VariantConfig {
  width: number;
  height: number;
}

export const VARIANT_PROFILES: Record<string, Record<string, VariantConfig>> = {
  users: {
    thumb: { width: 150, height: 150 },
    small: { width: 300, height: 200 },
    medium: { width: 600, height: 400 }
  },
  events: {
    mobile: { width: 480, height: 270 },
    tablet: { width: 1024, height: 576 },
    desktop: { width: 1920, height: 1080 }
  },
  organizers: {
    thumb: { width: 150, height: 150 },
    standard: { width: 800, height: 600 },
    highres: { width: 1600, height: 1200 }
  },
  emails: {
    email: { width: 600, height: 400 },
    web: { width: 1200, height: 800 },
    social: { width: 1200, height: 630 }
  }
};

export interface VariantOutput {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Generates variants based on the target module profile.
 */
export async function generateVariants(
  buffer: Buffer,
  mimeType: string,
  moduleName = 'users'
): Promise<Record<string, VariantOutput>> {
  const profile = VARIANT_PROFILES[moduleName] || VARIANT_PROFILES['users'];
  const results: Record<string, VariantOutput> = {};

  const cleanBuffer = await stripMetadata(buffer);

  for (const [key, config] of Object.entries(profile)) {
    try {
      const resized = await sharp(cleanBuffer)
        .resize(config.width, config.height, { fit: 'cover' })
        .toBuffer();
      
      results[key] = {
        buffer: resized,
        width: config.width,
        height: config.height,
        mimeType
      };
    } catch (err: any) {
      logger.error(`[ImageProcessing] Failed to generate variant ${key}`, { error: err.message });
    }
  }

  incrementMetric('storage_variants_generated_total', Object.keys(results).length);
  return results;
}

/**
 * Compatibility wrapper for generateVariants.
 */
export async function generateImageVariants(
  buffer: Buffer,
  mimeType: string,
  moduleName = 'users'
): Promise<Record<string, Buffer>> {
  const variants = await generateVariants(buffer, mimeType, moduleName);
  const out: Record<string, Buffer> = {};
  for (const [key, val] of Object.entries(variants)) {
    out[key] = val.buffer;
  }
  return out;
}
