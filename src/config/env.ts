import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function loadDockerSecrets() {
  const secretsDir = '/run/secrets';
  if (fs.existsSync(secretsDir)) {
    try {
      const files = fs.readdirSync(secretsDir);
      for (const file of files) {
        const filePath = path.join(secretsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const secretValue = fs.readFileSync(filePath, 'utf8').trim();
          process.env[file] = secretValue;
        }
      }
      console.log('[Secrets Loader] Loaded Docker secrets from /run/secrets/');
    } catch (err) {
      console.error('[Secrets Loader] Failed to read Docker secrets:', err);
    }
  }
}

loadDockerSecrets();

import { z } from 'zod';

function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const parsedOrigins = origins.map((origin) => {
    const url = new URL(origin);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid CORS origin protocol: ${origin}`);
    }

    return url.origin;
  });

  return [...new Set(parsedOrigins)];
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url('DATABASE_URL must be a valid PostgreSQL URL'),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('dev-access-secret-change-me-000000'),
  REFRESH_TOKEN_SECRET: z.string().min(32).default('dev-refresh-secret-change-me-00000'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL').default('redis://localhost:6379'),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_GLOBAL_WINDOW: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_OTP_SEND_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_OTP_SEND_WINDOW: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_OTP_VERIFY_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_OTP_VERIFY_WINDOW: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_RESET_PASS_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_RESET_PASS_WINDOW: z.coerce.number().int().positive().default(3600),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_SEARCH_WINDOW: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_UPLOAD_WINDOW: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_BOOKING_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_BOOKING_WINDOW: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_ADMIN_WINDOW: z.coerce.number().int().positive().default(60),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  TWILIO_ACCOUNT_SID: z.string().trim().default(''),
  TWILIO_AUTH_TOKEN: z.string().trim().default(''),
  TWILIO_VERIFY_SERVICE_SID: z.string().trim().default(''),
  BREVO_API_KEY: z.string().trim().default(''),
  BREVO_SMTP_KEY: z.string().trim().default(''),
  EMAIL_FROM: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  BREVO_WEBHOOK_SECRET: z.string().trim().default(''),
  EMAIL_FROM_NAME: z.string().trim().default('Event Booking'),
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@example.com'),
  EMAIL_REPLY_TO: z.string().email().optional().or(z.literal('')),
  EMAIL_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  EMAIL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  EMAIL_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  EMAIL_TRACK_OPENS: z.coerce.boolean().default(true),
  EMAIL_TRACK_CLICKS: z.coerce.boolean().default(true),
  AUTH_BYPASS_EMAIL_VERIFICATION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  AUTH_BYPASS_OTP_VERIFICATION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  EMAIL_PROVIDER: z.string().default('brevo'),
  SMS_PROVIDER: z.string().default('twilio'),
  BREVO_SENDER_EMAIL: z.string().trim().default(''),
  BREVO_SENDER_NAME: z.string().trim().default(''),
  TWILIO_PHONE_NUMBER: z.string().trim().default(''),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().positive().default(24),
  OTP_MAX_PER_HOUR_PER_PHONE: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_HOUR_PER_IP: z.coerce.number().int().positive().default(20),
  EMAIL_MAX_PER_HOUR_PER_EMAIL: z.coerce.number().int().positive().default(5),
  EMAIL_MAX_PER_HOUR_PER_IP: z.coerce.number().int().positive().default(20),
  MARKETING_DEFAULT_FROM_EMAIL: z.string().trim().default(''),
  MARKETING_DEFAULT_FROM_NAME: z.string().trim().default(''),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  CAMPAIGN_SEND_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value, ctx) => {
      try {
        return parseCorsOrigins(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : 'Invalid CORS_ORIGINS value'
        });

        return z.NEVER;
      }
    }),
  S3_REGION: z.string().trim().default('auto'),
  S3_BUCKET: z.string().trim().default('events-bucket'),
  S3_ACCESS_KEY: z.string().trim().default(''),
  S3_SECRET_KEY: z.string().trim().default(''),
  S3_ENDPOINT: z.string().trim().default(''),
  CDN_PROVIDER: z.enum(['cloudfront', 'r2', 'spaces', 'bunny']).default('r2'),
  CDN_BASE_URL: z.string().trim().default('http://localhost:3000/cdn'),
  // No storage bypass by default — media (avatars, event images) always goes to
  // real R2 object storage. Set to 'true' only for isolated tests that must not
  // touch the network.
  MEDIA_BYPASS_STORAGE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  CLOUDFLARE_ZONE_ID: z.string().trim().default(''),
  CLOUDFLARE_API_TOKEN: z.string().trim().default(''),
  CLOUDFLARE_ACCOUNT_ID: z.string().trim().default(''),
  BUCKET_NAME: z.string().trim().default(''),
  ACCESS_KEY_ID: z.string().trim().default(''),
  SECRET_KEY_ID: z.string().trim().default(''),
  EMAIL_PUBLIC_URL: z.string().trim().default('http://localhost:3000'),
  UPSTASH_REDIS_REST_URL: z.string().trim().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().trim().default(''),
  QSTASH_TOKEN: z.string().trim().default(''),
  QSTASH_CURRENT_SIGNING_KEY: z.string().trim().default(''),
  QSTASH_NEXT_SIGNING_KEY: z.string().trim().default(''),
  QSTASH_URL: z.string().trim().default('https://qstash.upstash.io'),
  RAZORPAY_KEY_ID: z.string().trim().default(''),
  RAZORPAY_KEY_SECRET: z.string().trim().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().default(''),
  RAZORPAY_TEST_KEY_ID: z.string().trim().default(''),
  RAZORPAY_SECRET_KEY: z.string().trim().default(''),
  RAZORPAY_MODE: z.enum(['test', 'production']).default('test'),
  RAZORPAY_TEST_API: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === 'true' || trimmed.startsWith('rzp_test_');
    }
    return val === true;
  }, z.boolean()).default(false),
  OTEL_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('revelis-backend'),

  // Financial/security control gates. The built-in payout provider and virus
  // scanner are mocks; they must never present themselves as real controls in
  // production. Auto-payouts require an explicit opt-in; the scanner requires a
  // real provider to be named, otherwise files are recorded as unscanned.
  ALLOW_MOCK_PAYOUTS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  VIRUS_SCAN_PROVIDER: z.enum(['none', 'mock', 'cloudflare']).default('none'),

  // Database connection pool tuning (see db/client.ts). Defaults are safe for a
  // single replica; lower DB_POOL_MAX when running many replicas against one DB.
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_IDLE_TIMEOUT: z.coerce.number().int().nonnegative().default(30), // seconds
  DB_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10), // seconds
  DB_STATEMENT_TIMEOUT: z.coerce.number().int().positive().default(30), // seconds

  // Revelis AI Assistant (Gemini). Optional at boot — the /ai/chat endpoint
  // fails gracefully with AI_PROVIDER_UNAVAILABLE if the key isn't set, rather
  // than crashing the whole backend for an optional feature.
  //
  // Use an "auth key" from Google AI Studio (the default for keys created
  // there since the standard→auth key migration), restricted to the
  // Generative Language API only. Never expose this to the frontend — only
  // this server reads it; the app talks to /ai/chat, never to Gemini directly.
  GEMINI_API_KEY: z.string().trim().default(''),
  // "gemini-2.5-flash-lite" is a dead pinned version (404s with "no longer
  // available to new users") on newer API keys — always alias to Google's
  // rolling "-latest" tag so this doesn't silently break again on the next
  // model deprecation.
  GEMINI_MODEL: z.string().trim().default('gemini-flash-lite-latest'),
  AI_CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(220),
  AI_CHAT_HISTORY_LIMIT: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AI_CHAT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_AI_CHAT_WINDOW: z.coerce.number().int().positive().default(60)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

if (parsed.data.NODE_ENV === 'production') {
  if (parsed.data.AUTH_BYPASS_OTP_VERIFICATION) {
    throw new Error('AUTH_BYPASS_OTP_VERIFICATION must be false in production');
  }
  if (parsed.data.AUTH_BYPASS_EMAIL_VERIFICATION) {
    throw new Error('AUTH_BYPASS_EMAIL_VERIFICATION must be false in production');
  }
}

if (
  parsed.data.NODE_ENV === 'production' &&
  (parsed.data.ACCESS_TOKEN_SECRET.startsWith('dev-') || parsed.data.REFRESH_TOKEN_SECRET.startsWith('dev-'))
) {
  throw new Error('JWT secrets must be set to non-default values in production');
}

if (
  parsed.data.NODE_ENV === 'production' &&
  !parsed.data.AUTH_BYPASS_OTP_VERIFICATION &&
  (!parsed.data.TWILIO_ACCOUNT_SID || !parsed.data.TWILIO_AUTH_TOKEN || !parsed.data.TWILIO_VERIFY_SERVICE_SID)
) {
  throw new Error('Twilio Verify environment variables must be configured in production when OTP verification is active');
}

if (
  parsed.data.NODE_ENV === 'production' &&
  !parsed.data.AUTH_BYPASS_EMAIL_VERIFICATION &&
  !parsed.data.BREVO_API_KEY
) {
  throw new Error('BREVO_API_KEY must be configured in production when email verification is active');
}

if (parsed.data.NODE_ENV === 'production') {
  if (!parsed.data.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY must be configured in production');
  }
  if (!parsed.data.BREVO_SMTP_KEY) {
    throw new Error('BREVO_SMTP_KEY must be configured in production');
  }
  if (!parsed.data.EMAIL_FROM) {
    throw new Error('EMAIL_FROM must be configured in production');
  }
  if (!parsed.data.EMAIL_FROM_NAME) {
    throw new Error('EMAIL_FROM_NAME must be configured in production');
  }
  if (!parsed.data.SMTP_PORT) {
    throw new Error('SMTP_PORT must be configured in production');
  }
  if ((!parsed.data.UPSTASH_REDIS_REST_URL || !parsed.data.UPSTASH_REDIS_REST_TOKEN) && !parsed.data.REDIS_URL) {
    throw new Error('Upstash Redis environment variables or REDIS_URL must be configured in production');
  }
  if (!parsed.data.QSTASH_TOKEN || !parsed.data.QSTASH_CURRENT_SIGNING_KEY || !parsed.data.QSTASH_NEXT_SIGNING_KEY) {
    throw new Error('QStash environment variables must be configured in production');
  }
  if (parsed.data.RAZORPAY_MODE === 'test') {
    if (!parsed.data.RAZORPAY_TEST_KEY_ID || !parsed.data.RAZORPAY_SECRET_KEY) {
      throw new Error('Razorpay Test credentials (RAZORPAY_TEST_KEY_ID, RAZORPAY_SECRET_KEY) must be configured in test mode');
    }
  } else {
    if (!parsed.data.RAZORPAY_KEY_ID || !parsed.data.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay Production credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) must be configured in production mode');
    }
  }
  if (!parsed.data.RAZORPAY_WEBHOOK_SECRET && parsed.data.NODE_ENV === 'production') {
    throw new Error('RAZORPAY_WEBHOOK_SECRET must be configured in production');
  }
  if (!parsed.data.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be configured in production');
  }
  if (!parsed.data.BUCKET_NAME) {
    throw new Error('BUCKET_NAME must be configured in production');
  }
  if (!parsed.data.ACCESS_KEY_ID) {
    throw new Error('ACCESS_KEY_ID must be configured in production');
  }
  if (!parsed.data.SECRET_KEY_ID) {
    throw new Error('SECRET_KEY_ID must be configured in production');
  }
  if (!parsed.data.S3_ENDPOINT) {
    throw new Error('S3_ENDPOINT must be configured in production');
  }
}

export const env = parsed.data;
