import type { MiddlewareHandler } from 'hono';

import type { AppLogger } from '../types/context.js';

export function requestLoggerMiddleware(logger: AppLogger): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();

    await next();

    logger.request({
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      requestId: c.get('requestId') ?? undefined,
      tenantId: c.get('tenant')?.id
    });
  };
}
