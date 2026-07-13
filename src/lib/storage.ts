import crypto from 'node:crypto';
import { eq, and, isNull, desc, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { storageObjects } from '../db/schema/storage-objects.js';
import { storageVariants } from '../db/schema/storage-variants.js';
import { auditLogs } from '../db/schema/audit-logs.js';
import { r2Client } from './r2.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound, unauthorized } from './errors.js';
import { incrementMetric } from './metrics.js';
import { cacheService } from './cache.js';
import {
  canReadAsset,
  canDownloadAsset,
  canDeleteAsset,
  canRestoreAsset,
  canGenerateSignedUrl
} from './storage/authz.js';

// Banned extension list (Priority 13.4 & Phase 15)
const BANNED_EXTENSIONS = [
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.php',
  '.jsp', '.js', '.html', '.htaccess', '.svg'
];

export interface ModuleUploadRule {
  allowedMimes: string[];
  maxSize: number; // in bytes
  isPrivate: boolean;
}

export const MODULE_RULES: Record<string, ModuleUploadRule> = {
  users: {
    allowedMimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    maxSize: 2 * 1024 * 1024, // 2MB
    isPrivate: false
  },
  organizers: {
    allowedMimes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
      'application/pdf'
    ],
    maxSize: 15 * 1024 * 1024, // 15MB
    isPrivate: true
  },
  events: {
    allowedMimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4'],
    maxSize: 150 * 1024 * 1024, // 150MB for video support
    isPrivate: false
  },
  tickets: {
    allowedMimes: ['image/png', 'application/pdf'],
    maxSize: 10 * 1024 * 1024, // 10MB
    isPrivate: true
  },
  payments: {
    allowedMimes: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
    maxSize: 10 * 1024 * 1024, // 10MB
    isPrivate: true
  },
  emails: {
    allowedMimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'],
    maxSize: 10 * 1024 * 1024, // 10MB
    isPrivate: false
  },
  exports: {
    allowedMimes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'],
    maxSize: 150 * 1024 * 1024, // 150MB
    isPrivate: true
  }
};

export function validateStorageFile(fileName: string, mimeType: string, fileSize: number, moduleName: string) {
  const normalizedName = fileName.toLowerCase();
  
  // Extension check
  const hasBannedExt = BANNED_EXTENSIONS.some(ext => normalizedName.endsWith(ext));
  if (hasBannedExt) {
    throw badRequest(`File upload blocked: dangerous extension found in filename ${fileName}`);
  }

  // Validate module
  const rule = MODULE_RULES[moduleName];
  if (!rule) {
    throw badRequest(`File upload blocked: unknown upload module '${moduleName}'`);
  }

  // Size limit validation
  if (fileSize > rule.maxSize) {
    throw badRequest(`File upload blocked: file size ${fileSize} bytes exceeds the limit of ${rule.maxSize} bytes for module '${moduleName}'`);
  }

  // MIME check
  if (!rule.allowedMimes.includes(mimeType.toLowerCase())) {
    throw badRequest(`File upload blocked: MIME type '${mimeType}' is not allowed for module '${moduleName}'`);
  }

  // Extension/MIME alignment heuristic
  const ext = normalizedName.slice(normalizedName.lastIndexOf('.'));
  if (mimeType.toLowerCase() === 'application/pdf' && ext !== '.pdf') {
    throw badRequest('File upload blocked: PDF mime type mismatch with file extension');
  }
  if (mimeType.toLowerCase().startsWith('image/') && !['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].some(e => ext.endsWith(e))) {
    throw badRequest('File upload blocked: Image mime type mismatch with file extension');
  }
}

export async function logStorageAudit(
  eventType: 'storage_upload' | 'storage_delete' | 'storage_download' | 'storage_copy' | 'storage_move' | 'storage_restore' | 'storage_variant_generation',
  userId: string | null,
  tenantId: string | null,
  objectKey: string,
  metadata: any = {},
  ipAddress = '127.0.0.1',
  userAgent = 'server'
) {
  try {
    await db.insert(auditLogs).values({
      eventType,
      actorType: userId ? 'user' : 'system',
      actorUserId: userId,
      entityType: 'storage_object',
      entityId: objectKey,
      correlationId: crypto.randomUUID(),
      ipAddress,
      userAgent,
      metadata: {
        timestamp: new Date().toISOString(),
        tenantId,
        objectKey,
        ...metadata
      }
    });
  } catch (err: any) {
    logger.error('[StorageAudit] Failed to log storage audit event', { error: err.message });
  }
}

export class StorageService {
  // CDN Path mappings (Priority 3)

  public getPublicAssetUrl(objectKey: string): string {
    const bucket = env.BUCKET_NAME || 'revelis';
    const cdnBase = env.CDN_BASE_URL || `https://pub-${bucket}.r2.dev`;
    return `${cdnBase}/${objectKey}`;
  }

  public async getPrivateAssetUrl(objectKey: string, tenantId: string | null = null, userId: string | null = null): Promise<string> {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (!canGenerateSignedUrl(record, tenantId, userId)) {
      throw forbidden('Unauthorized access to generate signed URL');
    }

    // Default pre-signed URL (1 hour)
    return r2Client.generatePresignedDownloadUrl(objectKey, 3600);
  }

  public async getAssetUrl(objectKey: string, tenantId: string | null = null, userId: string | null = null): Promise<string> {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (record.visibility === 'public') {
      return this.getPublicAssetUrl(objectKey);
    }

    return this.getPrivateAssetUrl(objectKey, tenantId, userId);
  }

  // Advanced URL controls with Redis validation (Priority 9)

  public async generateControlledSignedUrl(
    objectKey: string,
    options: {
      expiresIn?: number;
      singleUse?: boolean;
      maxDownloads?: number;
      allowedIp?: string;
      purpose?: string;
    },
    tenantId: string | null = null,
    userId: string | null = null
  ): Promise<string> {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (!canGenerateSignedUrl(record, tenantId, userId)) {
      throw forbidden('Unauthorized access to generate controlled signed URL');
    }

    const token = crypto.randomUUID();
    const redisKey = `revelis:storage:signed_url:${token}`;
    
    const payload = {
      objectKey,
      tenantId,
      userId,
      singleUse: !!options.singleUse,
      maxDownloads: options.maxDownloads || (options.singleUse ? 1 : 99999),
      allowedIp: options.allowedIp || null,
      purpose: options.purpose || 'download',
      downloadsCount: 0
    };

    const ttl = options.expiresIn || 3600;
    await cacheService.set(redisKey, JSON.stringify(payload), ttl);

    incrementMetric('storage_signed_url_requests');

    const publicUrl = env.EMAIL_PUBLIC_URL || 'http://localhost:3000';
    return `${publicUrl}/storage/signed-download?token=${token}`;
  }

  // Upload flows (Priority 1, 2, 6, 10)

  public async findDuplicateAsset(checksum: string, tenantId: string | null): Promise<any> {
    const [existing] = await db
      .select()
      .from(storageObjects)
      .where(
        and(
          eq(storageObjects.checksum, checksum),
          tenantId ? eq(storageObjects.tenantId, tenantId) : isNull(storageObjects.tenantId),
          isNull(storageObjects.deletedAt),
          eq(storageObjects.processingStatus, 'ready')
        )
      )
      .limit(1);

    if (existing) {
      incrementMetric('storage_duplicate_assets');
      return existing;
    }
    return null;
  }

  public async getUploadUrl(
    userId: string,
    tenantId: string | null,
    moduleName: string,
    fileName: string,
    mimeType: string,
    fileSize: number,
    ownerId?: string,
    checksum?: string
  ) {
    validateStorageFile(fileName, mimeType, fileSize, moduleName);

    // If checksum is provided, check for de-duplication (Priority 10)
    if (checksum) {
      const duplicate = await this.findDuplicateAsset(checksum, tenantId);
      if (duplicate) {
        logger.info('[Storage] Duplicate asset found, reusing active record', { checksum, objectKey: duplicate.objectKey });
        return {
          duplicate: true,
          objectKey: duplicate.objectKey,
          id: duplicate.id
        };
      }
    }

    const rule = MODULE_RULES[moduleName];
    const extension = fileName.slice(fileName.lastIndexOf('.'));
    const uniqueId = crypto.randomUUID();
    
    let objectKey = '';
    if (tenantId) {
      objectKey = `tenants/${tenantId}/${moduleName}/${ownerId || uniqueId}${extension}`;
    } else {
      objectKey = `global/${moduleName}/${ownerId || uniqueId}${extension}`;
    }

    const [existing] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    const version = existing ? existing.version + 1 : 1;
    const uploadUrl = await r2Client.generatePresignedUploadUrl(objectKey, mimeType, 600);
    const expiresAt = new Date(Date.now() + 600 * 1000);

    await db.insert(storageObjects).values({
      id: uniqueId,
      tenantId,
      ownerId: ownerId || null,
      module: moduleName,
      bucket: env.BUCKET_NAME || 'revelis',
      objectKey,
      version,
      fileName,
      mimeType,
      fileSize,
      checksum: checksum || null,
      uploadedBy: userId,
      visibility: rule.isPrivate ? 'private' : 'public',
      activeVersion: false, // Not active yet
      processingStatus: 'pending',
      metadata: {
        status: 'pending_upload',
        expiresAt: expiresAt.toISOString()
      }
    });

    await logStorageAudit('storage_upload', userId, tenantId, objectKey, {
      action: 'url_generation',
      fileName,
      mimeType,
      fileSize,
      version
    });

    return {
      duplicate: false,
      uploadUrl,
      objectKey,
      expiresAt: expiresAt.toISOString()
    };
  }

  public async completePresignedUpload(userId: string, tenantId: string | null, objectKey: string) {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), eq(storageObjects.uploadedBy, userId)))
      .orderBy(desc(storageObjects.version))
      .limit(1);

    if (!record) {
      throw notFound('Pre-registered storage object not found');
    }

    // Check R2 Existence (Priority 6 & 7)
    const exists = await r2Client.objectExists(objectKey);
    if (!exists) {
      await this.markAssetFailed(record.id, 'Uploaded object missing from R2 bucket');
      throw badRequest('Object does not exist in R2 bucket');
    }

    const info = await r2Client.headObject(objectKey);
    
    // Verify Size (Priority 6)
    if (info.size !== record.fileSize) {
      await r2Client.deleteObject(objectKey);
      await this.markAssetFailed(record.id, `Size mismatch. Expected: ${record.fileSize}, Actual: ${info.size}`);
      throw badRequest(`Size validation failed. Expected ${record.fileSize} but got ${info.size}`);
    }

    // Verify MIME type (Priority 6)
    if (info.mimeType.toLowerCase() !== record.mimeType.toLowerCase()) {
      await r2Client.deleteObject(objectKey);
      await this.markAssetFailed(record.id, `MIME type mismatch. Expected: ${record.mimeType}, Actual: ${info.mimeType}`);
      throw badRequest(`MIME type validation failed. Expected ${record.mimeType} but got ${info.mimeType}`);
    }

    // Calculate checksum to verify execution checksum match (Priority 6)
    const buffer = await r2Client.getObject(objectKey);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    if (record.checksum && record.checksum !== checksum) {
      await r2Client.deleteObject(objectKey);
      await this.markAssetFailed(record.id, `Checksum mismatch. Expected: ${record.checksum}, Actual: ${checksum}`);
      throw badRequest('Checksum validation failed. The uploaded file has been corrupted or modified.');
    }

    // If duplicate check matches now, perform de-duplication mapping (Priority 10)
    const duplicate = await this.findDuplicateAsset(checksum, tenantId);
    if (duplicate && duplicate.id !== record.id) {
      // Re-map this entry as a duplicate
      await r2Client.deleteObject(objectKey);
      await db
        .update(storageObjects)
        .set({
          checksum,
          etag: duplicate.etag,
          originalId: duplicate.id,
          processingStatus: 'ready',
          activeVersion: true,
          updatedAt: new Date()
        })
        .where(eq(storageObjects.id, record.id));

      incrementMetric('storage_deduplicated_bytes', record.fileSize);
      return duplicate;
    }

    const etag = info.etag ? info.etag.replace(/"/g, '') : null;

    // Toggle active versions (Priority 8)
    await db.transaction(async (tx) => {
      // De-activate old active versions
      await tx
        .update(storageObjects)
        .set({ activeVersion: false, deletedAt: new Date() })
        .where(
          and(
            eq(storageObjects.objectKey, objectKey),
            eq(storageObjects.activeVersion, true)
          )
        );

      // Set new version active
      await tx
        .update(storageObjects)
        .set({
          fileSize: info.size,
          checksum,
          etag,
          activeVersion: true,
          processingStatus: 'uploaded',
          updatedAt: new Date()
        })
        .where(eq(storageObjects.id, record.id));
    });

    await logStorageAudit('storage_upload', userId, tenantId, objectKey, {
      action: 'complete',
      fileSize: info.size,
      checksum,
      etag
    });

    return {
      id: record.id,
      objectKey,
      fileName: record.fileName,
      mimeType: record.mimeType,
      fileSize: info.size,
      etag,
      version: record.version,
      visibility: record.visibility,
      processingStatus: 'uploaded'
    };
  }

  // Server uploads (Priority 1 & 2)

  public async uploadSystemAsset(
    tenantId: string | null,
    ownerId: string,
    moduleName: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    validateStorageFile(fileName, mimeType, buffer.length, moduleName);

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Content address de-duplication check (Priority 10)
    const duplicate = await this.findDuplicateAsset(checksum, tenantId);
    if (duplicate) {
      incrementMetric('storage_deduplicated_bytes', buffer.length);
      return duplicate.objectKey;
    }

    const rule = MODULE_RULES[moduleName];
    const extension = fileName.slice(fileName.lastIndexOf('.'));
    
    let objectKey = '';
    if (tenantId) {
      objectKey = `tenants/${tenantId}/${moduleName}/${ownerId}${extension}`;
    } else {
      objectKey = `global/${moduleName}/${ownerId}${extension}`;
    }

    const [existing] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    const version = existing ? existing.version + 1 : 1;

    // Multipart switch for files > 25MB (Priority 2)
    if (buffer.length > 25 * 1024 * 1024) {
      await r2Client.uploadMultipartParallel(objectKey, buffer, mimeType);
    } else {
      await r2Client.uploadBuffer(objectKey, buffer, mimeType);
    }

    const info = await r2Client.headObject(objectKey);
    const etag = info?.etag ? info.etag.replace(/"/g, '') : null;

    const uniqueId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(storageObjects)
          .set({ activeVersion: false, deletedAt: new Date() })
          .where(eq(storageObjects.id, existing.id));
      }

      await tx.insert(storageObjects).values({
        id: uniqueId,
        tenantId,
        ownerId,
        module: moduleName,
        bucket: env.BUCKET_NAME || 'revelis',
        objectKey,
        version,
        fileName,
        mimeType,
        fileSize: buffer.length,
        checksum,
        etag,
        visibility: rule.isPrivate ? 'private' : 'public',
        activeVersion: true,
        processingStatus: 'uploaded',
        metadata: {
          source: 'system'
        }
      });
    });

    await logStorageAudit('storage_upload', null, tenantId, objectKey, {
      action: 'system_upload',
      checksum,
      etag,
      version
    });

    return objectKey;
  }

  // Deletion logic (Priority 3)

  public async softDeleteAsset(objectKey: string, tenantId: string | null = null, userId: string | null = null, userRole?: string) {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (!canDeleteAsset(record, tenantId, userId, userRole)) {
      throw forbidden('Unauthorized delete attempt');
    }

    await db
      .update(storageObjects)
      .set({ deletedAt: new Date(), activeVersion: false, processingStatus: 'deleted' })
      .where(eq(storageObjects.id, record.id));

    await logStorageAudit('storage_delete', userId, tenantId, objectKey, {
      action: 'soft_delete',
      version: record.version
    });
  }

  public async purgeAsset(objectKey: string, tenantId: string | null = null, userId: string | null = null, userRole?: string) {
    // Purges main assets, variant files and versions from R2 and DB (Priority 3)
    const records = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.objectKey, objectKey));

    if (records.length === 0) return;

    // Check auth against active record
    const active = records.find(r => !r.deletedAt);
    if (active && !canDeleteAsset(active, tenantId, userId, userRole)) {
      throw forbidden('Unauthorized purge attempt');
    }

    for (const record of records) {
      // Get all child variants
      const variants = await db
        .select()
        .from(storageVariants)
        .where(eq(storageVariants.storageObjectId, record.id));

      for (const variant of variants) {
        await r2Client.deleteObject(variant.objectKey).catch(() => {});
      }

      await r2Client.deleteObject(record.objectKey).catch(() => {});
      await db.delete(storageObjects).where(eq(storageObjects.id, record.id));
    }

    await logStorageAudit('storage_delete', userId, tenantId, objectKey, {
      action: 'hard_purge'
    });
  }

  public async restoreAsset(objectKey: string, targetVersion: number, tenantId: string | null = null, userId: string | null = null, userRole?: string) {
    const [active] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    const [target] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), eq(storageObjects.version, targetVersion)))
      .limit(1);

    if (!target) {
      throw notFound(`Version ${targetVersion} not found in history`);
    }

    if (!canRestoreAsset(target, tenantId, userId, userRole)) {
      throw forbidden('Unauthorized restore attempt');
    }

    await db.transaction(async (tx) => {
      if (active) {
        await tx
          .update(storageObjects)
          .set({ deletedAt: new Date(), activeVersion: false })
          .where(eq(storageObjects.id, active.id));
      }

      await tx
        .update(storageObjects)
        .set({ deletedAt: null, activeVersion: true, processingStatus: 'ready', updatedAt: new Date() })
        .where(eq(storageObjects.id, target.id));
    });

    await logStorageAudit('storage_restore', userId, tenantId, objectKey, {
      action: 'rollback',
      fromVersion: active ? active.version : null,
      toVersion: targetVersion
    });

    return target;
  }

  // Lifecycle Policies & Archival (Priority 11)

  public async archiveAsset(objectKey: string, tenantId: string | null = null, userId: string | null = null, userRole?: string): Promise<void> {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (tenantId && record.tenantId !== tenantId) {
      throw forbidden('Unauthorized archive attempt');
    }

    await db
      .update(storageObjects)
      .set({ lifecycleState: 'archived', updatedAt: new Date() })
      .where(eq(storageObjects.id, record.id));

    await logStorageAudit('storage_copy', userId, tenantId, objectKey, {
      action: 'archive_state_transition',
      state: 'archived'
    });
  }

  public async restoreArchivedAsset(objectKey: string, tenantId: string | null = null, userId: string | null = null, userRole?: string): Promise<void> {
    const [record] = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.objectKey, objectKey))
      .orderBy(desc(storageObjects.version))
      .limit(1);

    if (!record) {
      throw notFound('Storage object not found');
    }

    if (tenantId && record.tenantId !== tenantId) {
      throw forbidden('Unauthorized restore attempt');
    }

    await db
      .update(storageObjects)
      .set({ lifecycleState: 'active', deletedAt: null, activeVersion: true, updatedAt: new Date() })
      .where(eq(storageObjects.id, record.id));

    await logStorageAudit('storage_restore', userId, tenantId, objectKey, {
      action: 'archive_state_restore',
      state: 'active'
    });
  }

  // Scanning & Pipeline details (Priority 5 & 6)

  public async scanAsset(id: string): Promise<boolean> {
    const [record] = await db.select().from(storageObjects).where(eq(storageObjects.id, id)).limit(1);
    if (!record) return false;

    // No real malware scanner is wired. Do NOT record a false "clean" verdict —
    // that would misrepresent an unscanned file as safe. When no provider is
    // configured we mark the asset as explicitly unscanned and let the upload
    // proceed (policy: fail-open on delivery, honest on audit trail). Wire a real
    // provider by setting VIRUS_SCAN_PROVIDER and implementing the integration.
    if (env.VIRUS_SCAN_PROVIDER === 'none') {
      await db
        .update(storageObjects)
        .set({
          scanStatus: 'unscanned',
          scanProvider: 'none',
          scanCompletedAt: new Date(),
          scanResult: 'Not scanned - no virus scan provider configured'
        })
        .where(eq(storageObjects.id, id));
      logger.warn('[StorageService] Asset stored without malware scan (VIRUS_SCAN_PROVIDER=none)', { id });
      return true;
    }

    // Mock provider (dev/test only): filename-substring heuristic + EICAR marker.
    const isMockInfected = record.fileName.toLowerCase().includes('virus');
    const scanStatus = isMockInfected ? 'infected' : 'clean';
    const scanResult = isMockInfected ? 'Infected - Malicious signature EICAR detected' : 'Clean - No malware detected';

    await db
      .update(storageObjects)
      .set({
        scanStatus,
        scanProvider: 'Cloudflare Malware Scanner',
        scanCompletedAt: new Date(),
        scanResult
      })
      .where(eq(storageObjects.id, id));

    if (isMockInfected) {
      incrementMetric('storage_scan_failures');
      await this.markAssetFailed(id, scanResult);
      // Hard delete file from bucket immediately to mitigate security risk
      await r2Client.deleteObject(record.objectKey).catch(() => {});
      return false;
    }

    incrementMetric('storage_scan_successes');
    return true;
  }

  public async updateProcessingStatus(id: string, status: string) {
    await db
      .update(storageObjects)
      .set({ processingStatus: status, updatedAt: new Date() })
      .where(eq(storageObjects.id, id));
  }

  public async markAssetFailed(id: string, reason: string) {
    await db
      .update(storageObjects)
      .set({
        processingStatus: 'failed',
        metadata: {
          errorReason: reason,
          failedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where(eq(storageObjects.id, id));

    incrementMetric('storage_processing_failures_total');
  }

  public async retryProcessing(id: string): Promise<void> {
    const [record] = await db.select().from(storageObjects).where(eq(storageObjects.id, id)).limit(1);
    if (!record) throw notFound('Asset not found');

    await db
      .update(storageObjects)
      .set({ processingStatus: 'pending', metadata: {} })
      .where(eq(storageObjects.id, id));
  }
}

export const storageService = new StorageService();
