import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env.js';

export interface EmailActionTokenPayload {
  purpose: 'unsubscribe';
  tenantId: string;
  subscriberId: string;
  email: string;
  exp: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value: string) {
  return createHmac('sha256', env.ACCESS_TOKEN_SECRET).update(value).digest('base64url');
}

export function signEmailActionToken(payload: EmailActionTokenPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyEmailActionToken(token: string) {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = sign(encodedPayload);

  if (expected.length !== signature.length) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as EmailActionTokenPayload;

    if (payload.purpose !== 'unsubscribe') {
      return null;
    }

    if (payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(token: string) {
  const baseUrl = env.EMAIL_PUBLIC_URL || 'http://localhost:3000';
  return new URL(`/email-marketing/unsubscribe/${encodeURIComponent(token)}`, baseUrl).toString();
}
