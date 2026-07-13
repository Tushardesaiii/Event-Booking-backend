import type { Context, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { tenantMembers } from '../db/schema/tenant-members.js';
import { tenants } from '../db/schema/tenants.js';
import { users } from '../db/schema/users.js';
import { errorResponse } from '../lib/response.js';
import { env } from '../config/env.js';
import { AppError, isAppError } from '../lib/errors.js';
import type { AppLogger } from '../types/context.js';

// Drivers (postgres.js + Drizzle) wrap the underlying PostgresError, so the
// SQLSTATE `code` and `constraint_name` live on a nested `cause`. Walk the chain
// to recover them — otherwise every constraint violation falls through to a
// generic 500 instead of the specific 4xx mapping below.
function extractPgError(error: unknown): { code: string; constraint: string } {
  let cur: any = error;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 6; depth++) {
    const code = typeof cur.code === 'string' ? cur.code : '';
    // PostgreSQL SQLSTATE codes are exactly 5 chars; ignore Node codes like 'ECONNREFUSED'.
    if (/^[0-9A-Z]{5}$/.test(code)) {
      const constraint = typeof cur.constraint_name === 'string'
        ? cur.constraint_name
        : (typeof cur.constraint === 'string' ? cur.constraint : '');
      return { code, constraint };
    }
    cur = cur.cause;
  }
  return { code: '', constraint: '' };
}

function mapDatabaseError(error: unknown) {
  const { code, constraint } = extractPgError(error);

  if (code === '23505') {
    return new AppError({ message: 'Conflict', code: 'CONFLICT', statusCode: 409, details: error });
  }

  if (code === '23503') {
    return new AppError({ message: 'Invalid reference', code: 'BAD_REQUEST', statusCode: 400, details: error });
  }

  // 23514 = check constraint. The inventory-balance guard is the last line of
  // defense against overselling — surface it as a clean "sold out" conflict
  // instead of a 500 so the client can show a sensible message.
  if (code === '23514' && /inventory|balance|quantity|reserved|sold/i.test(constraint)) {
    return new AppError({
      message: 'Not enough tickets available for the selected pass. Please reduce the quantity or pick another pass.',
      code: 'CONFLICT',
      statusCode: 409,
      details: error,
    });
  }

  if (code === '23502' || code === '23514' || code === '22P02') {
    return new AppError({ message: 'Invalid input', code: 'BAD_REQUEST', statusCode: 400, details: error });
  }

  if (code.startsWith('08')) {
    return new AppError({ message: 'Database unavailable', code: 'DATABASE_ERROR', statusCode: 503, details: error });
  }

  return new AppError({ message: 'Database error', code: 'DATABASE_ERROR', statusCode: 500, details: error });
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
        if (!(key in acc)) {
          const value = (error as unknown as Record<string, unknown>)[key];
          if (value !== undefined) {
            acc[key] = value;
          }
        }
        return acc;
      }, {}))
    };
  }

  return error;
}

export function handleAppError(c: Context, error: unknown, logger: AppLogger) {
  const isDevelopment = env.NODE_ENV !== 'production';

  if (error instanceof ZodError) {
    logger.warn('validation error', { issues: error.issues });
    return errorResponse(c, {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      status: 400,
      details: isDevelopment ? { issues: error.issues, flattened: error.flatten() } : error.flatten()
    });
  }

  if (isAppError(error)) {
    logger.warn('application error', { code: error.code, message: error.message, details: isDevelopment ? error.details : undefined });
    return errorResponse(c, {
      message: error.message,
      code: error.code,
      status: error.statusCode,
      details: isDevelopment ? error.details : undefined
    });
  }

  const databaseError = mapDatabaseError(error);
  if (databaseError.statusCode !== 500 || databaseError.code !== 'DATABASE_ERROR') {
    logger.error('database error', {
      code: databaseError.code,
      message: databaseError.message,
      details: isDevelopment ? serializeError(error) : undefined
    });
    return errorResponse(c, {
      message: databaseError.message,
      code: databaseError.code,
      status: databaseError.statusCode,
      details: isDevelopment ? databaseError.details : undefined
    });
  }

  logger.error('unhandled error', {
    message: error instanceof Error ? error.message : 'Unknown error',
    details: isDevelopment ? serializeError(error) : undefined
  });

  return errorResponse(c, {
    message: 'Internal Server Error',
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    details: isDevelopment ? serializeError(error) : undefined
  });
}

export function errorMiddleware(logger: AppLogger): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next();
    } catch (error) {
      return handleAppError(c, error, logger);
    }
  };
}
