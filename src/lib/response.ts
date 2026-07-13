import type { Context } from 'hono';

import type { ApiErrorPayload, ApiSuccessPayload, PaginatedApiPayload, PaginationMeta } from '../types/api.js';

export function successResponse<T>(
  c: Context,
  data: T,
  message = 'Success',
  status = 200,
  extraMeta?: Record<string, unknown>
) {
  const requestId = c.get('requestId') || '';
  const timestamp = new Date().toISOString();

  return c.json<ApiSuccessPayload<T>>(
    {
      success: true,
      data,
      error: null,
      meta: {
        timestamp,
        requestId,
        message,
        ...(extraMeta ?? {})
      }
    },
    status as never
  );
}

export function errorResponse(
  c: Context,
  options: {
    message: string;
    code: string;
    status?: number;
    details?: unknown;
  }
) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const requestId = c.get('requestId') || '';
  const timestamp = new Date().toISOString();

  const errorObj: any = {
    code: options.code,
    message: options.message
  };

  if (options.code === 'VALIDATION_ERROR' && options.details !== undefined) {
    errorObj.details = options.details;
  } else if (isDevelopment && options.details !== undefined) {
    errorObj.details = options.details;
  }

  return c.json<ApiErrorPayload>(
    {
      success: false,
      data: null,
      error: errorObj,
      meta: {
        timestamp,
        requestId
      }
    },
    (options.status ?? 500) as never
  );
}

export function paginatedResponse<T>(
  c: Context,
  data: T[],
  meta: PaginationMeta,
  message = 'Success',
  status = 200
) {
  const requestId = c.get('requestId') || '';
  const timestamp = new Date().toISOString();

  return c.json<PaginatedApiPayload<T>>(
    {
      success: true,
      data,
      error: null,
      meta: {
        ...meta,
        timestamp,
        requestId
      }
    },
    status as never
  );
}
