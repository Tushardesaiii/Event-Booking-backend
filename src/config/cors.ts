import { cors } from 'hono/cors';

import { env } from './env.js';

const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const allowedHeaders = [
  'Content-Type',
  'Authorization',
  'X-Tenant-Id',
  // Browser clients (the organizer/superadmin dashboard) send these custom
  // headers; they must be allow-listed or the CORS preflight rejects the request.
  'x-tenant-slug',
  'x-request-id',
  'x-correlation-id',
  'Idempotency-Key',
  'ngrok-skip-browser-warning'
] as const;
const exposedHeaders = ['Authorization'] as const;

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  return env.CORS_ORIGINS.includes(origin);
}

export const corsMiddleware = cors({
  origin: (origin) => origin ?? '',
  credentials: true,
  allowMethods: [...allowedMethods],
  allowHeaders: [...allowedHeaders],
  exposeHeaders: [...exposedHeaders]
});