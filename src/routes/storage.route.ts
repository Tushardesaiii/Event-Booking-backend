import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../middlewares/tenant.middleware.js';
import { uploadRateLimit } from '../middlewares/rate-limit.middleware.js';
import { errorResponse, successResponse } from '../lib/response.js';
import { storageService } from '../lib/storage.js';
import { qstashService } from '../lib/qstash.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isAppError } from '../lib/errors.js';
import { requireUser } from '../lib/http-context.js';
import { cacheService } from '../lib/cache.js';
import type { AppEnv } from '../types/context.js';
import type { MiddlewareHandler } from 'hono';

export const storageRoute = new Hono<AppEnv>();

// Public endpoint for controlled signed downloads (Priority 9)
storageRoute.get('/signed-download', async (c) => {
  const token = c.req.query('token') || '';
  if (!token) {
    return errorResponse(c, { message: 'Missing token parameter', code: 'BAD_REQUEST', status: 400 });
  }

  try {
    const redisKey = `revelis:storage:signed_url:${token}`;
    const payload = await cacheService.get<any>(redisKey);
    if (!payload) {
      return errorResponse(c, { message: 'Invalid or expired download link', code: 'LINK_EXPIRED', status: 403 });
    }

    // IP Check
    if (payload.allowedIp) {
      const requesterIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
      if (requesterIp !== payload.allowedIp) {
        return errorResponse(c, { message: 'Access denied: unauthorized IP address', code: 'IP_BLOCKED', status: 403 });
      }
    }

    // Max downloads count check
    if (payload.downloadsCount >= payload.maxDownloads) {
      return errorResponse(c, { message: 'Download limit exceeded for this link', code: 'LIMIT_EXCEEDED', status: 403 });
    }

    // Single use check
    if (payload.singleUse && payload.downloadsCount > 0) {
      return errorResponse(c, { message: 'This link has already been used', code: 'LINK_ALREADY_USED', status: 403 });
    }

    // Increment downloads count
    payload.downloadsCount += 1;
    const ttl = await cacheService.ttl(redisKey);
    if (payload.singleUse || payload.downloadsCount >= payload.maxDownloads) {
      await cacheService.delete(redisKey);
    } else {
      await cacheService.set(redisKey, JSON.stringify(payload), ttl > 0 ? ttl : 3600);
    }

    const { r2Client } = await import('../lib/r2.js');
    const rangeHeader = c.req.header('Range');
    const info = await r2Client.headObject(payload.objectKey);
    const stream = await r2Client.getObjectStream(payload.objectKey, rangeHeader);

    c.header('Content-Type', info.mimeType);
    c.header('Content-Length', String(info.size));
    c.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    if (rangeHeader) {
      c.header('Content-Range', rangeHeader);
      return c.body(stream, 206);
    }
    return c.body(stream, 200);
  } catch (err: any) {
    logger.error('[StorageRoute] Failed controlled signed download', { error: err.message });
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

// Zod payload schemas
const UploadUrlSchema = z.object({
  fileName: z.string().min(1, 'fileName is required'),
  mimeType: z.string().min(1, 'mimeType is required'),
  fileSize: z.number().int().positive('fileSize must be positive'),
  module: z.string().min(1, 'module name is required'),
  ownerId: z.string().uuid().optional(),
  checksum: z.string().optional()
});

const CompleteUploadSchema = z.object({
  objectKey: z.string().min(1, 'objectKey is required')
});

const RollbackSchema = z.object({
  objectKey: z.string().min(1, 'objectKey is required'),
  version: z.number().int().positive('version must be a positive integer')
});

const AssetActionSchema = z.object({
  objectKey: z.string().min(1, 'objectKey is required')
});

// Mount auth and tenant middlewares on standard mutations
const standardChain = [authMiddleware, tenantMiddleware({ routeParamNames: [] })] as [
  MiddlewareHandler<AppEnv>,
  MiddlewareHandler<AppEnv>
];

storageRoute.post('/upload-url', ...standardChain, uploadRateLimit, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = UploadUrlSchema.parse(body);

    const result = await storageService.getUploadUrl(
      userId,
      tenantId,
      payload.module,
      payload.fileName,
      payload.mimeType,
      payload.fileSize,
      payload.ownerId,
      payload.checksum
    );

    return successResponse(c, result, 'Upload URL resolved successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.post('/complete', ...standardChain, uploadRateLimit, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = CompleteUploadSchema.parse(body);

    const metadata = await storageService.completePresignedUpload(userId, tenantId, payload.objectKey);

    // Queue processing pipeline (Priority 5)
    try {
      const qstashUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;
      await qstashService.publish(qstashUrl, {
        jobType: 'process_asset',
        data: {
          objectKey: metadata.objectKey,
          tenantId,
          userId
        }
      });
    } catch (qstashErr: any) {
      logger.error('[StorageRoute] Failed to dispatch process_asset job to QStash', { error: qstashErr.message });
    }

    return successResponse(c, metadata, 'Upload completion confirmed', 201);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.post('/rollback', ...standardChain, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = RollbackSchema.parse(body);

    const result = await storageService.restoreAsset(
      payload.objectKey,
      payload.version,
      tenantId,
      userId,
      c.get('tenantMembership')?.role
    );

    return successResponse(c, result, 'Rollback executed successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.post('/archive', ...standardChain, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = AssetActionSchema.parse(body);

    await storageService.archiveAsset(payload.objectKey, tenantId, userId, c.get('tenantMembership')?.role);
    return successResponse(c, { archived: true }, 'Asset archived successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.post('/restore-archive', ...standardChain, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = AssetActionSchema.parse(body);

    await storageService.restoreArchivedAsset(payload.objectKey, tenantId, userId, c.get('tenantMembership')?.role);
    return successResponse(c, { restored: true }, 'Archived asset restored successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.delete('/assets', ...standardChain, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = AssetActionSchema.parse(body);

    await storageService.softDeleteAsset(payload.objectKey, tenantId, userId, c.get('tenantMembership')?.role);
    return successResponse(c, { deleted: true }, 'Asset soft deleted successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});

storageRoute.delete('/assets/purge', ...standardChain, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const userId = requireUser(c).id;
  const tenantId = tenant?.id || null;

  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = AssetActionSchema.parse(body);

    await storageService.purgeAsset(payload.objectKey, tenantId, userId, c.get('tenantMembership')?.role);
    return successResponse(c, { purged: true }, 'Asset hard purged successfully', 200);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return errorResponse(c, { message: 'Validation failed', code: 'BAD_REQUEST', status: 400, details: err.issues });
    }
    if (isAppError(err)) {
      return errorResponse(c, { message: err.message, code: err.code, status: err.statusCode, details: err.details });
    }
    return errorResponse(c, { message: err.message || 'Internal server error', code: 'INTERNAL_SERVER_ERROR', status: 500 });
  }
});
