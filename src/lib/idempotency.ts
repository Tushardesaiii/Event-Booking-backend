import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { verificationRequestLogs } from '../db/schema/verification-request-logs.js';
import { logger } from './logger.js';
import { cacheService } from './cache.js';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context.js';
import { conflict } from './errors.js';

const DEDUPLICATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface IdempotencyRecord {
  status: 'processing' | 'completed';
  responseReference: {
    status: number;
    headers: Record<string, string>;
    body: string;
    message?: string;
    data?: any;
  };
  startedAt: number;
}

/**
 * Check if the idempotency key exists in Redis cache revelis:idempotency:{key}
 */
export async function checkIdempotency(
  idempotencyKey: string,
  requestType: string
): Promise<any | null> {
  const cacheKey = `revelis:idempotency:${idempotencyKey}:${requestType}`;
  try {
    const cached = await cacheService.get<IdempotencyRecord>(cacheKey);
    if (cached) {
      if (cached.status === 'processing') {
        logger.warn('Idempotent request is already in progress', { idempotencyKey, requestType });
        throw conflict('Request with this Idempotency-Key is already being processed');
      }
      logger.info('Idempotent request matched in Redis cache', { idempotencyKey, requestType });
      return cached.responseReference;
    }

    // Set lock to prevent concurrent duplicate requests (expires in 5 minutes if not completed)
    await cacheService.set(
      cacheKey,
      {
        status: 'processing',
        startedAt: Date.now(),
        responseReference: null
      },
      300
    );
  } catch (error: any) {
    if (error.code === 'CONFLICT') {
      throw error;
    }
    logger.error('Failed to check idempotency in Redis', { idempotencyKey, requestType, error: error.message });
  }

  // Double check Database as persistent fallback
  try {
    const since = new Date(Date.now() - DEDUPLICATION_WINDOW_MS);
    const [log] = await db
      .select()
      .from(verificationRequestLogs)
      .where(
        and(
          eq(verificationRequestLogs.idempotencyKey, idempotencyKey),
          eq(verificationRequestLogs.requestType, requestType),
          gte(verificationRequestLogs.createdAt, since)
        )
      )
      .limit(1);

    if (log && log.responseReference) {
      logger.info('Idempotent request matched in database fallback', { idempotencyKey, requestType });
      // Repopulate Redis cache
      await cacheService.set(
        cacheKey,
        {
          status: 'completed',
          responseReference: log.responseReference,
          startedAt: log.createdAt.getTime()
        },
        86400
      );
      return log.responseReference;
    }
  } catch (error: any) {
    logger.error('Failed to check database fallback for idempotency', { idempotencyKey, requestType, error: error.message });
  }

  return null;
}

/**
 * Save response payload to Redis and Database
 */
export async function saveIdempotency(
  idempotencyKey: string,
  requestType: string,
  email: string | null,
  phoneNumber: string | null,
  responseReference: any,
  actorUserId?: string | null
): Promise<void> {
  const cacheKey = `revelis:idempotency:${idempotencyKey}:${requestType}`;
  try {
    const record: IdempotencyRecord = {
      status: 'completed',
      responseReference,
      startedAt: Date.now()
    };
    // Save to Redis (24 hours TTL)
    await cacheService.set(cacheKey, record, 86400);
    logger.info('Saved idempotency key response to Redis', { idempotencyKey, requestType });
  } catch (error: any) {
    logger.error('Failed to save idempotency to Redis', { idempotencyKey, requestType, error: error.message });
  }

  try {
    // Persistent audit log
    await db.insert(verificationRequestLogs).values({
      idempotencyKey,
      requestType,
      actorUserId: actorUserId ?? null,
      email: email ?? null,
      phoneNumber: phoneNumber ?? null,
      responseReference
    }).onConflictDoNothing();
    logger.info('Saved idempotency log to database', { idempotencyKey, requestType });
  } catch (error: any) {
    logger.error('Failed to save idempotency key to database', { idempotencyKey, requestType, error: error.message });
  }
}

/**
 * Delete idempotency key from Redis (e.g. if the execution failed, allowing retrying)
 */
export async function deleteIdempotency(
  idempotencyKey: string,
  requestType: string
): Promise<void> {
  const cacheKey = `revelis:idempotency:${idempotencyKey}:${requestType}`;
  try {
    await cacheService.delete(cacheKey);
    logger.info('Deleted idempotency key from Redis', { idempotencyKey, requestType });
  } catch (error: any) {
    logger.error('Failed to delete idempotency key from Redis', { idempotencyKey, requestType, error: error.message });
  }
}

/**
 * Generic Hono middleware to enforce idempotency keys on all mutation endpoints
 */
export function idempotencyMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return next();
    }

    const method = c.req.method;

    const path = c.req.path;
    // Avoid double checking for routes that handle idempotency manually
    const bypassManualRoutes = [
      '/auth/send-email-verification',
      '/auth/verify-email',
      '/auth/send-otp',
      '/auth/verify-otp'
    ];
    if (bypassManualRoutes.includes(path)) {
      return next();
    }

    const requestType = `${method}:${path}`;
    logger.info(`[IdempotencyMiddleware] Intercepted request with key`, { idempotencyKey, requestType });

    try {
      const cachedResponse = await checkIdempotency(idempotencyKey, requestType);
      if (cachedResponse) {
        if (cachedResponse.status === 'processing') {
          return c.json({ success: false, message: 'Request with this Idempotency-Key is already being processed' }, 409);
        }

        // Apply headers
        const headers = cachedResponse.headers || {};
        for (const [k, v] of Object.entries(headers)) {
          c.header(k, v as string);
        }
        c.header('X-Cache-Idempotency', 'HIT');

        const body = cachedResponse.body;
        const status = cachedResponse.status || 200;

        // Determine if JSON
        try {
          return c.json(JSON.parse(body), status);
        } catch {
          return c.text(body, status);
        }
      }

      // Proceed with execution
      await next();

      const responseStatus = c.res.status;
      if (responseStatus >= 200 && responseStatus < 300) {
        // Clone and capture response
        const clonedRes = c.res.clone();
        const bodyText = await clonedRes.text();
        const headers = Object.fromEntries(clonedRes.headers.entries());

        const responsePayload = {
          status: responseStatus,
          headers,
          body: bodyText
        };

        const userId = c.get('user')?.id || null;
        await saveIdempotency(idempotencyKey, requestType, null, null, responsePayload, userId);
      } else {
        // Delete in-progress lock on failure
        await deleteIdempotency(idempotencyKey, requestType);
      }
    } catch (err: any) {
      await deleteIdempotency(idempotencyKey, requestType);
      throw err;
    }
  };
}
