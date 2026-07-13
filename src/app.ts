import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';

import { corsMiddleware, isAllowedCorsOrigin } from './config/cors.js';
import { logger } from './lib/logger.js';
import { errorMiddleware, handleAppError } from './middlewares/error.middleware.js';
import { errorResponse } from './lib/response.js';
import { requestLoggerMiddleware } from './middlewares/request-logger.middleware.js';
import { globalRateLimit } from './middlewares/rate-limit.middleware.js';
import { idempotencyMiddleware } from './lib/idempotency.js';
import { registerRoutes } from './routes/index.js';
import { registerVibesWebSocket } from './modules/vibes/ws.js';
import type { AppEnv } from './types/context.js';
import { randomUUID } from 'node:crypto';

export const app = new Hono<AppEnv>();

// Security headers on every response. HSTS is safe to always send — it is only
// honoured by browsers over HTTPS (TLS is terminated at the upstream proxy/LB).
app.use('*', secureHeaders({
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  referrerPolicy: 'no-referrer',
  crossOriginResourcePolicy: 'cross-origin',
  // No global CSP: responses are JSON APIs and streamed assets, and the /checkout
  // HTML page must be able to load the external Razorpay script.
}));

// Reject oversized request bodies before they are buffered (DoS guard). 10MB is
// generous for JSON APIs; large file uploads go directly to R2 via presigned URLs.
app.use('*', bodyLimit({
  maxSize: 10 * 1024 * 1024,
  onError: (c) => errorResponse(c, { message: 'Request body too large', code: 'PAYLOAD_TOO_LARGE', status: 413 }),
}));

app.use('*', requestLoggerMiddleware(logger));
app.use('*', errorMiddleware(logger));
app.use('*', globalRateLimit);
app.use('*', idempotencyMiddleware());
app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  const correlationId = c.req.header('x-correlation-id') ?? c.req.header('correlation-id') ?? requestId;
  c.set('requestId', requestId);
  c.set('correlationId', correlationId);
  c.header('x-request-id', requestId);
  c.header('x-correlation-id', correlationId);
  return next();
});
app.use('*', async (c, next) => {
  const originalJson = c.json.bind(c) as (body: any, status?: any, headers?: any) => Response;
  (c as any).json = function (body: any, status?: any, headers?: any) {
    const reqId = c.get('requestId') || '';
    const timestamp = new Date().toISOString();

    if (
      body &&
      typeof body === 'object' &&
      'success' in body &&
      'data' in body &&
      'error' in body &&
      'meta' in body &&
      body.meta &&
      typeof body.meta === 'object' &&
      'requestId' in body.meta &&
      'timestamp' in body.meta
    ) {
      return originalJson(body, status, headers);
    }

    let success = true;
    let data: any = null;
    let error: any = null;
    let meta: any = { timestamp, requestId: reqId };

    if (body && typeof body === 'object') {
      if ('success' in body) {
        success = !!body.success;
        if (success) {
          if ('meta' in body && body.meta && typeof body.meta === 'object') {
            meta = { ...meta, ...body.meta };
          }
          data = 'data' in body ? body.data : body;
        } else {
          if ('error' in body && body.error && typeof body.error === 'object') {
            error = {
              code: body.error.code || 'INTERNAL_SERVER_ERROR',
              message: body.error.message || 'An error occurred',
              details: body.error.details || null
            };
          } else {
            error = {
              code: body.code || 'INTERNAL_SERVER_ERROR',
              message: body.message || 'An error occurred',
              details: body.details || null
            };
          }
        }
      } else if ('error' in body && typeof body.error === 'string') {
        success = false;
        error = {
          code: status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
          message: body.error,
          details: null
        };
      } else if ('error' in body && body.error && typeof body.error === 'object') {
        success = false;
        error = {
          code: body.error.code || 'BAD_REQUEST',
          message: body.error.message || 'An error occurred',
          details: body.error.details || null
        };
      } else {
        data = body;
      }
    } else {
      data = body;
    }

    const responsePayload = {
      success,
      data,
      error,
      meta
    };

    return originalJson(responsePayload, status, headers);
  };

  return next();
});
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');

  if (!isAllowedCorsOrigin(origin)) {
    return errorResponse(c, { message: 'CORS origin not allowed', code: 'FORBIDDEN', status: 403 });
  }

  return next();
});
app.use('*', corsMiddleware);

app.get('/checkout', async (c) => {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.resolve(process.cwd(), 'checkout.html'), 'utf8');
    return c.html(html);
  } catch (err: any) {
    return c.text(`Failed to load checkout page: ${err.message}`, 500);
  }
});

registerRoutes(app);

// Realtime vibe-chat websocket (registers GET /ws/vibes on the app). The actual
// upgrade handler is attached to the node server in index.ts via injectVibesWebSocket.
registerVibesWebSocket(app);

app.notFound((c) => errorResponse(c, { message: 'Route not found', code: 'NOT_FOUND', status: 404 }));
app.onError((error, c) => handleAppError(c, error, logger));
