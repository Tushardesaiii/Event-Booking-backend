import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { verificationEvents } from '../db/schema/verification-events.js';
import { env } from '../config/env.js';
import { rateLimited } from './errors.js';
import { logger } from './logger.js';
import { cacheService } from './cache.js';
import { randomUUID } from 'node:crypto';

export interface RateLimitInput {
  source: 'email' | 'otp';
  email?: string | null;
  phoneNumber?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  tenantId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
}

export async function assertRateLimit(input: RateLimitInput): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // 1 hour window
  const eventTypes = ['send', 'sent', 'resend'];

  // 1. Phone number limit (OTP only)
  if (input.source === 'otp' && input.phoneNumber) {
    const [phoneCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationEvents)
      .where(
        and(
          eq(verificationEvents.source, 'otp'),
          eq(verificationEvents.phoneNumber, input.phoneNumber),
          inArray(verificationEvents.eventType, eventTypes),
          gte(verificationEvents.createdAt, since)
        )
      );
    const phoneCount = Number(phoneCountRow?.count ?? 0);
    if (phoneCount >= env.OTP_MAX_PER_HOUR_PER_PHONE) {
      await logViolation(input, 'phone_rate_limit_exceeded', `Phone number ${input.phoneNumber} exceeded OTP limit of ${env.OTP_MAX_PER_HOUR_PER_PHONE}/hr (got ${phoneCount})`);
      throw rateLimited('Too many OTP verification requests for this phone number.');
    }
  }

  // 2. Email limit (Email verification only)
  if (input.source === 'email' && input.email) {
    const [emailCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationEvents)
      .where(
        and(
          eq(verificationEvents.source, 'email'),
          eq(verificationEvents.email, input.email),
          inArray(verificationEvents.eventType, eventTypes),
          gte(verificationEvents.createdAt, since)
        )
      );
    const emailCount = Number(emailCountRow?.count ?? 0);
    if (emailCount >= env.EMAIL_MAX_PER_HOUR_PER_EMAIL) {
      await logViolation(input, 'email_rate_limit_exceeded', `Email ${input.email} exceeded verification limit of ${env.EMAIL_MAX_PER_HOUR_PER_EMAIL}/hr (got ${emailCount})`);
      throw rateLimited('Too many email verification requests for this email address.');
    }
  }

  // 3. User ID limit (both)
  if (input.actorUserId) {
    const limit = input.source === 'otp' ? env.OTP_MAX_PER_HOUR_PER_PHONE : env.EMAIL_MAX_PER_HOUR_PER_EMAIL;
    const [userCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationEvents)
      .where(
        and(
          eq(verificationEvents.source, input.source),
          eq(verificationEvents.actorUserId, input.actorUserId),
          inArray(verificationEvents.eventType, eventTypes),
          gte(verificationEvents.createdAt, since)
        )
      );
    const userCount = Number(userCountRow?.count ?? 0);
    if (userCount >= limit) {
      await logViolation(input, 'user_rate_limit_exceeded', `User ${input.actorUserId} exceeded verification limit of ${limit}/hr (got ${userCount})`);
      throw rateLimited('Too many verification requests for this user.');
    }
  }

  // 4. IP limit
  if (input.ipAddress) {
    const ipLimit = input.source === 'otp' ? env.OTP_MAX_PER_HOUR_PER_IP : env.EMAIL_MAX_PER_HOUR_PER_IP;
    const [ipCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationEvents)
      .where(
        and(
          eq(verificationEvents.source, input.source),
          eq(verificationEvents.ipAddress, input.ipAddress),
          inArray(verificationEvents.eventType, eventTypes),
          gte(verificationEvents.createdAt, since)
        )
      );
    const ipCount = Number(ipCountRow?.count ?? 0);
    if (ipCount >= ipLimit) {
      await logViolation(input, 'ip_rate_limit_exceeded', `IP ${input.ipAddress} exceeded limit of ${ipLimit}/hr (got ${ipCount})`);
      throw rateLimited('Too many verification requests from this IP address.');
    }
  }
}

async function logViolation(input: RateLimitInput, type: string, detail: string): Promise<void> {
  try {
    await db.insert(verificationEvents).values({
      actorUserId: input.actorUserId ?? null,
      tenantId: input.tenantId ?? null,
      eventType: 'rate_limit_violation',
      source: input.source,
      email: input.email ?? null,
      phoneNumber: input.phoneNumber ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      correlationId: input.correlationId ?? null,
      requestId: input.requestId ?? null,
      metadata: {
        violationType: type,
        detail
      }
    });
    logger.warn('Rate limit violation recorded', { type, detail, correlationId: input.correlationId });
  } catch (error) {
    logger.error('Failed to log rate limit violation', { type, detail, error });
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // epoch timestamp in seconds
  retryAfter: number; // seconds to wait
}

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local unique_id = ARGV[4]

-- Remove timestamps older than now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', '(' .. (now - window))

-- Get count of active logs
local count = redis.call('ZCARD', key)

local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, unique_id)
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
  allowed = 1
  count = count + 1
end

-- Find oldest timestamp for reset calculation
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest_score = now
if oldest and oldest[2] then
  oldest_score = tonumber(oldest[2])
end
local reset_time = oldest_score + window

return {allowed, count, reset_time}
`;

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  failClosed: boolean = false
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const uniqueId = randomUUID();

  const client = cacheService.getClient();
  const isRedisConnected = cacheService.getBreakerState() !== 'OPEN';
  // If Redis is not connected or initialized, fall back
  if (!client || !isRedisConnected) {
    logger.warn('Rate limiter using fallback because Redis is unavailable', { key, failClosed });
    if (failClosed) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        reset: Math.ceil((now + windowMs) / 1000),
        retryAfter: windowSeconds,
      };
    } else {
      return {
        allowed: true,
        limit,
        remaining: limit,
        reset: Math.ceil((now + windowMs) / 1000),
        retryAfter: 0,
      };
    }
  }

  try {
    const result = await client.eval(
      SLIDING_WINDOW_SCRIPT,
      [key],
      [now.toString(), windowMs.toString(), limit.toString(), uniqueId]
    );

    const [allowed, count, resetTime] = result as [number, number, number];

    const isAllowed = allowed === 1;
    const remaining = Math.max(0, limit - count);
    const reset = Math.ceil(resetTime / 1000);
    const retryAfter = isAllowed ? 0 : Math.max(1, Math.ceil((resetTime - now) / 1000));

    return {
      allowed: isAllowed,
      limit,
      remaining,
      reset,
      retryAfter,
    };
  } catch (error: any) {
    logger.error('Rate limit evaluation failed', { key, error: error.message || error });
    if (failClosed) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        reset: Math.ceil((now + windowMs) / 1000),
        retryAfter: windowSeconds,
      };
    } else {
      return {
        allowed: true,
        limit,
        remaining: limit,
        reset: Math.ceil((now + windowMs) / 1000),
        retryAfter: 0,
      };
    }
  }
}

export function getClientIp(c: any): string {
  // Check Cloudflare header first
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // Fastly client IP
  const fastlyIp = c.req.header('fastly-client-ip');
  if (fastlyIp) return fastlyIp.trim();

  // True-Client-IP (Akamai/Cloudflare)
  const trueClientIp = c.req.header('true-client-ip');
  if (trueClientIp) return trueClientIp.trim();

  // X-Real-IP (Nginx/etc)
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp.trim();

  // X-Forwarded-For (list of IPs)
  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map((ip: string) => ip.trim());
    if (ips[0]) return ips[0];
  }

  // Fallback to connection info if available (Node.js request object socket)
  const rawReq = c.env?.incoming;
  if (rawReq?.socket?.remoteAddress) {
    return rawReq.socket.remoteAddress;
  }

  return '127.0.0.1';
}
