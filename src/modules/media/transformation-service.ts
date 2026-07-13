export interface ImageVariantInfo {
  width: number;
  height: number;
  storageKey: string;
  fileSize: number;
}

export interface MediaMetadata {
  variants?: {
    thumbnail?: ImageVariantInfo;
    small?: ImageVariantInfo;
    medium?: ImageVariantInfo;
    large?: ImageVariantInfo;
    original?: ImageVariantInfo;
  };
  duration?: number;
}

export class MediaTransformationService {
  /**
   * Generates dimensions, storage keys, and metadata for image/video variants.
   * In a future production environment, these variants can be generated asynchronously
   * by image resizer workers. Here we pre-calculate the keys and sizes.
   */
  async processMedia(
    storageKey: string,
    mimeType: string,
    fileSize: number,
    width?: number,
    height?: number
  ): Promise<{
    width: number | null;
    height: number | null;
    blurHash: string | null;
    dominantColor: string | null;
    metadata: MediaMetadata;
  }> {
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');

    let resolvedWidth = width ?? null;
    let resolvedHeight = height ?? null;
    let blurHash: string | null = null;
    let dominantColor: string | null = null;
    const metadata: MediaMetadata = {};

    if (isImage) {
      resolvedWidth = resolvedWidth ?? 1200;
      resolvedHeight = resolvedHeight ?? 800;
      blurHash = 'L6PZ|Ye.dCp000ys_NS4~p%0M_ae'; // Standard mock BlurHash
      dominantColor = '#3B82F6'; // Default brand dominant color

      // Calculate path with variant suffixes
      // e.g. "path/to/file.jpg" -> "path/to/file_thumbnail.jpg"
      const lastDotIndex = storageKey.lastIndexOf('.');
      const base = lastDotIndex !== -1 ? storageKey.substring(0, lastDotIndex) : storageKey;
      const ext = lastDotIndex !== -1 ? storageKey.substring(lastDotIndex) : '';

      metadata.variants = {
        thumbnail: {
          width: 150,
          height: 150,
          storageKey: `${base}_thumbnail${ext}`,
          fileSize: Math.round(fileSize * 0.05) // Simulated compression
        },
        small: {
          width: 300,
          height: 200,
          storageKey: `${base}_small${ext}`,
          fileSize: Math.round(fileSize * 0.15)
        },
        medium: {
          width: 600,
          height: 400,
          storageKey: `${base}_medium${ext}`,
          fileSize: Math.round(fileSize * 0.4)
        },
        large: {
          width: 1200,
          height: 800,
          storageKey: `${base}_large${ext}`,
          fileSize: Math.round(fileSize * 0.8)
        },
        original: {
          width: resolvedWidth,
          height: resolvedHeight,
          storageKey,
          fileSize
        }
      };
    } else if (isVideo) {
      resolvedWidth = resolvedWidth ?? 1920;
      resolvedHeight = resolvedHeight ?? 1080;
      metadata.variants = {
        original: {
          width: resolvedWidth,
          height: resolvedHeight,
          storageKey,
          fileSize
        }
      };
    }

    return {
      width: resolvedWidth,
      height: resolvedHeight,
      blurHash,
      dominantColor,
      metadata
    };
  }
}

export const mediaTransformationService = new MediaTransformationService();
