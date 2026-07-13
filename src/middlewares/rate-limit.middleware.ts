import type { MiddlewareHandler } from 'hono';
import { env } from '../config/env.js';
import { checkRateLimit, getClientIp } from '../lib/rate-limiter.js';
import { logger } from '../lib/logger.js';
import type { AppEnv } from '../types/context.js';
import { db } from '../db/client.js';
import { verificationEvents } from '../db/schema/verification-events.js';

export const rateLimitMetrics = {
  total_rate_limit_hits: 0,
  total_rate_limit_blocks: 0,
  auth_limit_blocks: 0,
  otp_limit_blocks: 0,
  upload_limit_blocks: 0,
  booking_limit_blocks: 0,
};

interface RateLimitMiddlewareOptions {
  type: string;
  getKey: (c: any) => Promise<string> | string;
  limit: number;
  windowSeconds: number;
  failClosed?: boolean;
}

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (env.NODE_ENV !== 'production' && c.req.header('x-bypass-rate-limit') === 'true') {
      await next();
      return;
    }
    rateLimitMetrics.total_rate_limit_hits++;
    const key = await options.getKey(c);
    const result = await checkRateLimit(key, options.limit, options.windowSeconds, options.failClosed);

    const ip = getClientIp(c);
    const userId = c.get('user')?.id || null;
    const tenantId = c.get('tenant')?.id || null;

    logger.info('RATE_LIMIT_HIT', {
      ip,
      userId,
      tenantId,
      endpoint: c.req.path,
      limitType: options.type,
      remainingCount: result.remaining,
      retryAfter: result.retryAfter,
    });

    c.header('RateLimit-Limit', options.limit.toString());
    c.header('RateLimit-Remaining', result.remaining.toString());
    c.header('RateLimit-Reset', result.reset.toString());

    if (!result.allowed) {
      rateLimitMetrics.total_rate_limit_blocks++;
      if (options.type === 'auth') rateLimitMetrics.auth_limit_blocks++;
      if (options.type.startsWith('otp')) rateLimitMetrics.otp_limit_blocks++;
      if (options.type === 'upload') rateLimitMetrics.upload_limit_blocks++;
      if (options.type === 'booking') rateLimitMetrics.booking_limit_blocks++;

      logger.warn('RATE_LIMIT_BLOCKED', {
        ip,
        userId,
        tenantId,
        endpoint: c.req.path,
        limitType: options.type,
        remainingCount: result.remaining,
        retryAfter: result.retryAfter,
      });

      if (options.type.startsWith('otp')) {
        try {
          let phone = '';
          const body = await c.req.json().catch(() => ({}));
          if (body?.phoneNumber) {
            phone = body.phoneNumber;
          }
          
          await db.insert(verificationEvents).values({
            actorUserId: userId ?? null,
            tenantId: tenantId ?? null,
            eventType: 'rate_limit_violation',
            source: 'otp',
            phoneNumber: phone || null,
            ipAddress: ip || null,
            userAgent: c.req.header('user-agent') || null,
            correlationId: c.req.header('x-correlation-id') || null,
            requestId: c.req.header('x-request-id') || null,
            metadata: {
              violationType: 'ip_or_phone_rate_limit_exceeded',
              detail: `Rate limit blocked by middleware: ${options.type}`
            }
          });
        } catch (dbErr) {
          logger.error('Failed to log rate limit violation in middleware', { error: dbErr });
        }
      }

      c.header('Retry-After', result.retryAfter.toString());

      return c.json(
        {
          success: false,
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
          error: {
            code: 'RATE_LIMITED',
          },
        },
        429
      );
    }

    await next();
  };
}

// Layer A: Global
export const globalRateLimit = createRateLimitMiddleware({
  type: 'global',
  getKey: (c) => `revelis:rate_limit:global:${getClientIp(c)}`,
  limit: env.RATE_LIMIT_GLOBAL_MAX,
  windowSeconds: env.RATE_LIMIT_GLOBAL_WINDOW,
  failClosed: false,
});

// Layer B: Auth
export const authRateLimit = createRateLimitMiddleware({
  type: 'auth',
  getKey: async (c) => {
    const ip = getClientIp(c);
    let email = '';
    try {
      const validatedBody = c.get('validatedBody') as any;
      if (validatedBody?.email) {
        email = validatedBody.email;
      } else {
        const body = await c.req.json().catch(() => ({}));
        if (body?.email) {
          email = body.email;
        }
      }
    } catch {}
    return `revelis:rate_limit:auth:${ip}${email ? `:email:${email}` : ''}`;
  },
  limit: env.RATE_LIMIT_AUTH_MAX,
  windowSeconds: env.RATE_LIMIT_AUTH_WINDOW,
  failClosed: true,
});

// Layer C: OTP Send
export const otpSendRateLimit = createRateLimitMiddleware({
  type: 'otp_send',
  getKey: async (c) => {
    const ip = getClientIp(c);
    let phone = '';
    try {
      const validatedBody = c.get('validatedBody') as any;
      if (validatedBody?.phoneNumber) {
        phone = validatedBody.phoneNumber;
      } else {
        const body = await c.req.json().catch(() => ({}));
        if (body?.phoneNumber) {
          phone = body.phoneNumber;
        }
      }
    } catch {}
    return `revelis:rate_limit:otp_send:${ip}${phone ? `:phone:${phone}` : ''}`;
  },
  limit: env.RATE_LIMIT_OTP_SEND_MAX,
  windowSeconds: env.RATE_LIMIT_OTP_SEND_WINDOW,
  failClosed: true,
});

// Layer C: OTP Verify
export const otpVerifyRateLimit = createRateLimitMiddleware({
  type: 'otp_verify',
  getKey: async (c) => {
    const ip = getClientIp(c);
    let phone = '';
    try {
      const validatedBody = c.get('validatedBody') as any;
      if (validatedBody?.phoneNumber) {
        phone = validatedBody.phoneNumber;
      } else {
        const body = await c.req.json().catch(() => ({}));
        if (body?.phoneNumber) {
          phone = body.phoneNumber;
        }
      }
    } catch {}
    return `revelis:rate_limit:otp_verify:${ip}${phone ? `:phone:${phone}` : ''}`;
  },
  limit: env.RATE_LIMIT_OTP_VERIFY_MAX,
  windowSeconds: env.RATE_LIMIT_OTP_VERIFY_WINDOW,
  failClosed: true,
});

// Layer D: Password Reset
export const passwordResetRateLimit = createRateLimitMiddleware({
  type: 'password_reset',
  getKey: async (c) => {
    const ip = getClientIp(c);
    let email = '';
    try {
      const validatedBody = c.get('validatedBody') as any;
      if (validatedBody?.email) {
        email = validatedBody.email;
      } else {
        const body = await c.req.json().catch(() => ({}));
        if (body?.email) {
          email = body.email;
        }
      }
    } catch {}
    return `revelis:rate_limit:password_reset:${ip}${email ? `:email:${email}` : ''}`;
  },
  limit: env.RATE_LIMIT_RESET_PASS_MAX,
  windowSeconds: env.RATE_LIMIT_RESET_PASS_WINDOW,
  failClosed: true,
});

// Layer E: Search
export const searchRateLimit = createRateLimitMiddleware({
  type: 'search',
  getKey: (c) => `revelis:rate_limit:search:${getClientIp(c)}`,
  limit: env.RATE_LIMIT_SEARCH_MAX,
  windowSeconds: env.RATE_LIMIT_SEARCH_WINDOW,
  failClosed: false,
});

// Layer F: Upload
export const uploadRateLimit = createRateLimitMiddleware({
  type: 'upload',
  getKey: (c) => {
    const userId = c.get('user')?.id;
    return userId ? `revelis:rate_limit:upload:user:${userId}` : `revelis:rate_limit:upload:ip:${getClientIp(c)}`;
  },
  limit: env.RATE_LIMIT_UPLOAD_MAX,
  windowSeconds: env.RATE_LIMIT_UPLOAD_WINDOW,
  failClosed: false,
});

// Layer G: Booking
export const bookingRateLimit = createRateLimitMiddleware({
  type: 'booking',
  getKey: (c) => {
    const userId = c.get('user')?.id;
    return userId ? `revelis:rate_limit:booking:user:${userId}` : `revelis:rate_limit:booking:ip:${getClientIp(c)}`;
  },
  limit: env.RATE_LIMIT_BOOKING_MAX,
  windowSeconds: env.RATE_LIMIT_BOOKING_WINDOW,
  failClosed: false,
});

// Layer H: Admin / Tenant
export const adminRateLimit = createRateLimitMiddleware({
  type: 'admin',
  getKey: (c) => {
    const userId = c.get('user')?.id;
    const tenantId = c.get('tenant')?.id || 'global';
    return `revelis:rate_limit:admin:tenant:${tenantId}:user:${userId || getClientIp(c)}`;
  },
  limit: env.RATE_LIMIT_ADMIN_MAX,
  windowSeconds: env.RATE_LIMIT_ADMIN_WINDOW,
  failClosed: false,
});

// Layer I: Webhooks
export const webhookRateLimit = createRateLimitMiddleware({
  type: 'webhook',
  getKey: (c) => `revelis:rate_limit:webhook:${getClientIp(c)}`,
  limit: 60,
  windowSeconds: 60,
  failClosed: false,
});

// Layer K: AI Assistant chat. Keyed per-user (falls back to IP for the rare
// unauthenticated edge case) since Gemini calls carry real per-request cost.
export const aiChatRateLimit = createRateLimitMiddleware({
  type: 'ai_chat',
  getKey: (c) => {
    const userId = c.get('user')?.id;
    return userId ? `revelis:rate_limit:ai_chat:user:${userId}` : `revelis:rate_limit:ai_chat:ip:${getClientIp(c)}`;
  },
  limit: env.RATE_LIMIT_AI_CHAT_MAX,
  windowSeconds: env.RATE_LIMIT_AI_CHAT_WINDOW,
  failClosed: false,
});

// Layer J: CDN delivery. The /cdn route can trigger an on-the-fly image resize
// (full-decode via sharp) which is CPU/RAM heavy, so cap per-IP request volume
// to blunt a resize-amplification DoS.
export const cdnRateLimit = createRateLimitMiddleware({
  type: 'cdn',
  getKey: (c) => `revelis:rate_limit:cdn:${getClientIp(c)}`,
  limit: 300,
  windowSeconds: 60,
  failClosed: false,
});
