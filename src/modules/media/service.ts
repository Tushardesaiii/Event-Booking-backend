import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { storageProvider } from './storage-provider.js';
import { mediaTransformationService } from './transformation-service.js';
import { mediaRepository } from './repository.js';
import { profiles } from '../../db/schema/profile.js';
import { activityService } from '../profile/services/activityService.js';
import { cloudflareCdnService } from './cloudflare-cdn.service.js';
import { r2Client } from '../../lib/r2.js';
import { extractMetadata, optimizeImage, resizeImage } from '../../lib/image-processing.js';

const MAX_DECODED_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1920;

function decodeBase64Image(input: string): Buffer {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input.trim());
  const base64 = match ? match[2] : input.trim();
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw badRequest('Empty image data');
  if (buffer.length > MAX_DECODED_BYTES) throw badRequest('Image is too large (max 15MB)');
  return buffer;
}

export function mapAssetResponse(asset: any) {
  return {
    id: asset.id,
    uploaderUserId: asset.uploaderUserId,
    originalFileName: asset.originalFileName,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
    blurHash: asset.blurHash,
    dominantColor: asset.dominantColor,
    moderationStatus: asset.moderationStatus,
    processingStatus: asset.processingStatus,
    version: asset.version,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    scanStatus: asset.scanStatus,
    scanCompletedAt: asset.scanCompletedAt,
    originalUploaderId: asset.originalUploaderId,
    currentOwnerId: asset.currentOwnerId,
    // Dynamic Cloudflare CDN Variant URLs
    thumbnailUrl: cloudflareCdnService.buildThumbnailUrl(asset.storageKey),
    smallUrl: cloudflareCdnService.buildSmallUrl(asset.storageKey),
    mediumUrl: cloudflareCdnService.buildMediumUrl(asset.storageKey),
    largeUrl: cloudflareCdnService.buildLargeUrl(asset.storageKey),
    originalUrl: cloudflareCdnService.buildPublicUrl(asset.storageKey),
    cdnUrl: cloudflareCdnService.buildPublicUrl(asset.storageKey)
  };
}

async function getProfileIdByUserId(tenantId: string, userId: string): Promise<string | null> {
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), eq(profiles.userId, userId)))
    .limit(1);
  return profile?.id ?? null;
}

async function logMediaActivity(tenantId: string, userId: string, activityType: string, targetId: string, metadata: any = {}) {
  try {
    const profileId = await getProfileIdByUserId(tenantId, userId);
    if (profileId) {
      await activityService.logActivity(tenantId, profileId, activityType, targetId, metadata);
    }
  } catch (error) {
    console.error('Failed to log media activity:', error);
  }
}

export const mediaService = {
  async generateUploadUrl(
    tenantId: string,
    userId: string,
    input: {
      fileName: string;
      mimeType: string;
      fileSize: number;
      entityType: string;
      role: string;
      expiresInSeconds?: number;
    }
  ) {
    // 1. Quota check (Tenant level)
    const tenantQuota = await mediaRepository.findOrCreateTenantQuota(db, tenantId);
    if (tenantQuota) {
      const currentBytes = Number(tenantQuota.currentStorageBytes);
      const maxBytes = Number(tenantQuota.maxStorageBytes);
      if (currentBytes + input.fileSize > maxBytes) {
        throw badRequest('Upload blocked: Tenant storage quota limit exceeded');
      }
    }

    // 2. Quota check (User level)
    const userQuota = await mediaRepository.findOrCreateUserQuota(db, tenantId, userId);
    if (userQuota) {
      const currentBytes = Number(userQuota.currentStorageBytes);
      const maxBytes = Number(userQuota.maxStorageBytes);
      if (currentBytes + input.fileSize > maxBytes) {
        throw badRequest('Upload blocked: User storage quota limit exceeded');
      }
    }

    const sanitizedFileName = input.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const randomUuid = crypto.randomUUID();
    const storageKey = `tenants/${tenantId}/${input.entityType}/${input.role}/${randomUuid}_${sanitizedFileName}`;

    const uploadUrl = await storageProvider.getSignedUploadUrl(
      env.S3_BUCKET,
      storageKey,
      input.mimeType,
      input.expiresInSeconds
    );

    return {
      uploadUrl,
      storageKey,
      cdnUrl: cloudflareCdnService.buildPublicUrl(storageKey)
    };
  },

  // Base64 → sharp-optimized WebP → R2 → media_assets (+ optional media_link).
  // Lets the browser upload without a direct R2 presigned PUT (no R2 CORS needed).
  async uploadDirect(
    tenantId: string,
    userId: string,
    input: { image: string; entityType: string; entityId?: string; role: string; fileName?: string }
  ) {
    const raw = decodeBase64Image(input.image);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await extractMetadata(raw);
      width = meta.width;
      height = meta.height;
    } catch {
      throw badRequest('Unsupported or corrupt image');
    }

    let processed: Buffer;
    try {
      const bounded =
        width && height && Math.max(width, height) > MAX_EDGE
          ? await resizeImage(raw, MAX_EDGE, MAX_EDGE, 'inside')
          : raw;
      processed = await optimizeImage(bounded, 'webp', 82);
      const meta = await extractMetadata(processed);
      width = meta.width ?? width;
      height = meta.height ?? height;
    } catch {
      throw badRequest('Could not process image');
    }

    const storageKey = `tenants/${tenantId}/media/${input.role}/${randomUUID()}.webp`;
    await r2Client.uploadBuffer(storageKey, processed, 'image/webp');

    const asset = await mediaRepository.createMediaAsset(db, tenantId, userId, {
      storageProvider: 's3',
      bucket: env.BUCKET_NAME || 'revelis',
      storageKey,
      originalFileName: input.fileName || 'upload.webp',
      mimeType: 'image/webp',
      fileSize: processed.length,
      width,
      height,
      processingStatus: 'ready'
    });

    if (input.entityId) {
      await mediaRepository.createMediaLink(db, tenantId, {
        mediaAssetId: asset.id,
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.role,
        displayOrder: 0
      });
    }

    return mapAssetResponse(asset);
  },

  async completeUpload(
    tenantId: string,
    userId: string,
    input: {
      storageKey: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      width?: number;
      height?: number;
      checksum?: string;
    }
  ) {
    // 1. Checksum deduplication
    if (input.checksum) {
      const existing = await mediaRepository.findMediaAssetByChecksum(db, tenantId, input.checksum);
      if (existing) {
        await logMediaActivity(tenantId, userId, 'media_uploaded', existing.id, {
          fileName: input.fileName,
          mimeType: input.mimeType,
          checksum: input.checksum,
          reused: true
        });
        return mapAssetResponse(existing);
      }
    }

    // 2. Extract variant transformations and dimensions
    const processed = await mediaTransformationService.processMedia(
      input.storageKey,
      input.mimeType,
      input.fileSize,
      input.width,
      input.height
    );

    // 3. Create database record
    const asset = await mediaRepository.createMediaAsset(db, tenantId, userId, {
      storageProvider: env.MEDIA_BYPASS_STORAGE ? 'mock' : 's3',
      bucket: env.S3_BUCKET,
      storageKey: input.storageKey,
      originalFileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      width: processed.width ?? undefined,
      height: processed.height ?? undefined,
      checksum: input.checksum,
      blurHash: processed.blurHash ?? undefined,
      dominantColor: processed.dominantColor ?? undefined,
      metadata: processed.metadata
    });

    // 4. Update Quotas
    await mediaRepository.incrementQuotaUsage(db, tenantId, userId, input.fileSize, input.mimeType);

    // 5. Log upload activity
    await logMediaActivity(tenantId, userId, 'media_uploaded', asset.id, {
      fileName: input.fileName,
      mimeType: input.mimeType,
      checksum: input.checksum,
      reused: false
    });

    return mapAssetResponse(asset);
  },

  async getMediaAsset(tenantId: string, id: string) {
    const asset = await mediaRepository.findMediaAssetById(db, tenantId, id);
    if (!asset) {
      throw notFound('Media asset not found');
    }
    return mapAssetResponse(asset);
  },

  async deleteMediaAsset(tenantId: string, userId: string, id: string, lastKnownUpdatedAt: string) {
    const asset = await mediaRepository.findMediaAssetById(db, tenantId, id);
    if (!asset) {
      throw notFound('Media asset not found');
    }

    // Soft delete record
    const updated = await mediaRepository.softDeleteMediaAsset(db, tenantId, id, lastKnownUpdatedAt);

    // Update Quotas
    const originalUploader = asset.uploaderUserId || userId;
    await mediaRepository.decrementQuotaUsage(db, tenantId, originalUploader, asset.fileSize, asset.mimeType);

    // Invalidate CDN Cache
    await cloudflareCdnService.purgeCache([asset.storageKey]);

    // Delete S3 object
    await storageProvider.delete(asset.bucket, asset.storageKey);

    // Log delete activity
    await logMediaActivity(tenantId, userId, 'media_deleted', id, {
      originalFileName: asset.originalFileName
    });

    return mapAssetResponse(updated);
  },

  async linkMediaAsset(
    tenantId: string,
    userId: string,
    input: {
      mediaAssetId: string;
      entityType: string;
      entityId: string;
      role: string;
      displayOrder?: number;
    }
  ) {
    // Verify media asset exists and belongs to the tenant
    const asset = await mediaRepository.findMediaAssetById(db, tenantId, input.mediaAssetId);
    if (!asset) {
      throw notFound('Media asset not found');
    }

    // Link asset
    const link = await mediaRepository.createMediaLink(db, tenantId, input);

    // Log link activity
    await logMediaActivity(tenantId, userId, 'media_linked', input.mediaAssetId, {
      entityType: input.entityType,
      entityId: input.entityId,
      role: input.role
    });

    return {
      id: link.id,
      mediaAssetId: link.mediaAssetId,
      entityType: link.entityType,
      entityId: link.entityId,
      role: link.role,
      displayOrder: link.displayOrder,
      createdAt: link.createdAt
    };
  },

  async unlinkMediaAsset(
    tenantId: string,
    userId: string,
    input: {
      mediaAssetId: string;
      entityType: string;
      entityId: string;
      role: string;
    }
  ) {
    const link = await mediaRepository.deleteMediaLink(
      db,
      tenantId,
      input.mediaAssetId,
      input.entityType,
      input.entityId,
      input.role
    );

    if (!link) {
      throw notFound('Media link not found');
    }

    // Log unlink activity
    await logMediaActivity(tenantId, userId, 'media_unlinked', input.mediaAssetId, {
      entityType: input.entityType,
      entityId: input.entityId,
      role: input.role
    });

    return { success: true };
  },

  async listMediaForEntity(tenantId: string, entityType: string, entityId: string) {
    const links = await mediaRepository.listMediaLinksForEntity(db, tenantId, entityType, entityId);
    return links.map(link => ({
      id: link.id,
      originalFileName: link.originalFileName,
      mimeType: link.mimeType,
      fileSize: link.fileSize,
      width: link.width,
      height: link.height,
      blurHash: link.blurHash,
      dominantColor: link.dominantColor,
      moderationStatus: link.moderationStatus,
      processingStatus: link.processingStatus,
      role: link.role,
      displayOrder: link.displayOrder,
      linkId: link.linkId,
      thumbnailUrl: cloudflareCdnService.buildThumbnailUrl(link.storageKey),
      smallUrl: cloudflareCdnService.buildSmallUrl(link.storageKey),
      mediumUrl: cloudflareCdnService.buildMediumUrl(link.storageKey),
      largeUrl: cloudflareCdnService.buildLargeUrl(link.storageKey),
      originalUrl: cloudflareCdnService.buildPublicUrl(link.storageKey),
      cdnUrl: cloudflareCdnService.buildPublicUrl(link.storageKey)
    }));
  },

  async listGalleryForEntity(tenantId: string, entityType: string, entityId: string) {
    const links = await mediaRepository.listGalleryMediaLinksForEntity(db, tenantId, entityType, entityId);
    return links.map(link => ({
      id: link.id,
      originalFileName: link.originalFileName,
      mimeType: link.mimeType,
      fileSize: link.fileSize,
      width: link.width,
      height: link.height,
      blurHash: link.blurHash,
      dominantColor: link.dominantColor,
      moderationStatus: link.moderationStatus,
      processingStatus: link.processingStatus,
      role: link.role,
      displayOrder: link.displayOrder,
      linkId: link.linkId,
      thumbnailUrl: cloudflareCdnService.buildThumbnailUrl(link.storageKey),
      smallUrl: cloudflareCdnService.buildSmallUrl(link.storageKey),
      mediumUrl: cloudflareCdnService.buildMediumUrl(link.storageKey),
      largeUrl: cloudflareCdnService.buildLargeUrl(link.storageKey),
      originalUrl: cloudflareCdnService.buildPublicUrl(link.storageKey),
      cdnUrl: cloudflareCdnService.buildPublicUrl(link.storageKey)
    }));
  },

  // Governance, Quotas, Moderation APIs
  async getQuotaUsage(tenantId: string, userId: string) {
    const tenantQuota = await mediaRepository.findOrCreateTenantQuota(db, tenantId);
    const userQuota = await mediaRepository.findOrCreateUserQuota(db, tenantId, userId);
    return {
      tenantQuota: {
        maxStorageBytes: Number(tenantQuota.maxStorageBytes),
        currentStorageBytes: Number(tenantQuota.currentStorageBytes),
        imageCount: tenantQuota.imageCount,
        videoCount: tenantQuota.videoCount,
        documentCount: tenantQuota.documentCount
      },
      userQuota: {
        maxStorageBytes: Number(userQuota.maxStorageBytes),
        currentStorageBytes: Number(userQuota.currentStorageBytes),
        imageCount: userQuota.imageCount,
        videoCount: userQuota.videoCount,
        documentCount: userQuota.documentCount
      }
    };
  },

  async updateQuotaLimit(
    tenantId: string,
    input: {
      userId?: string;
      maxStorageBytes: number;
    }
  ) {
    if (input.userId) {
      const updated = await mediaRepository.updateUserQuotaLimit(db, tenantId, input.userId, input.maxStorageBytes);
      return updated;
    } else {
      const updated = await mediaRepository.updateTenantQuotaLimit(db, tenantId, input.maxStorageBytes);
      return updated;
    }
  },

  async moderateAsset(
    tenantId: string,
    userId: string,
    input: {
      mediaAssetId: string;
      status: 'approved' | 'rejected' | 'flagged' | 'under_review';
      reason?: string;
    }
  ) {
    const asset = await mediaRepository.findMediaAssetById(db, tenantId, input.mediaAssetId);
    if (!asset) {
      throw notFound('Media asset not found');
    }

    const historyEntry = {
      status: input.status,
      reason: input.reason || '',
      moderatedBy: userId,
      moderatedAt: new Date().toISOString()
    };

    const updated = await mediaRepository.moderateMediaAsset(
      db,
      tenantId,
      input.mediaAssetId,
      userId,
      input.status,
      input.reason || '',
      historyEntry
    );

    return mapAssetResponse(updated);
  },

  async getAdvancedMediaAnalytics(tenantId: string) {
    return mediaRepository.getAdvancedMediaAnalytics(db, tenantId);
  },

  async getMediaAnalytics(tenantId: string) {
    return mediaRepository.getMediaAnalytics(db, tenantId);
  }
};
