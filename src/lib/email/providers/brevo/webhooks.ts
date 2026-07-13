import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../../../config/env.js';

export type BrevoWebhookEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'unsubscribe' | 'bounce' | 'complaint';

export interface BrevoWebhookEvent {
  providerEventId: string;
  eventType: BrevoWebhookEventType;
  email: string | null;
  campaignId: string | null;
  recipientEmail: string | null;
  metadata: Record<string, unknown>;
}

function normalizeSignature(value: string) {
  return value.trim().replace(/^sha256=/i, '').replace(/^v1=/i, '').replace(/^signature=/i, '');
}

export function verifyBrevoWebhookSignature(rawBody: string, signatureHeader: string | null) {
  if (!env.BREVO_WEBHOOK_SECRET) {
    return false;
  }

  if (!signatureHeader) {
    return false;
  }

  const signature = normalizeSignature(signatureHeader);
  const expectedHex = createHmac('sha256', env.BREVO_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const expectedBase64 = createHmac('sha256', env.BREVO_WEBHOOK_SECRET).update(rawBody).digest('base64');

  const candidates = [expectedHex, expectedBase64];

  return candidates.some((candidate) => {
    if (candidate.length !== signature.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(candidate), Buffer.from(signature));
  });
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function asNumberString(value: unknown) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return asString(value);
}

function mapEventType(event: string): BrevoWebhookEventType {
  switch (event.toLowerCase()) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'opened':
    case 'first_opening':
    case 'proxy_open':
    case 'unique_proxy_open':
      return 'opened';
    case 'click':
    case 'clicked':
      return 'clicked';
    case 'unsubscribe':
    case 'unsubscribed':
      return 'unsubscribe';
    case 'hard_bounce':
    case 'soft_bounce':
    case 'bounced':
    case 'blocked':
    case 'invalid_email':
    case 'deferred':
    case 'error':
      return 'bounce';
    case 'spam':
    case 'complaint':
      return 'complaint';
    default:
      return 'sent';
  }
}

export function normalizeBrevoWebhookEvent(payload: Record<string, unknown>): BrevoWebhookEvent {
  const event = asString(payload.event) ?? asString(payload.event_name) ?? 'sent';
  const providerEventId =
    asNumberString(payload.id) ??
    asString(payload.event_id) ??
    asString(payload.ts_event) ??
    `${event}:${asString(payload.email) ?? 'unknown'}:${asString(payload.ts) ?? Date.now().toString()}`;

  return {
    providerEventId,
    eventType: mapEventType(event),
    email: asString(payload.email),
    campaignId: asNumberString(payload.camp_id) ?? asNumberString(payload.campaign_id),
    recipientEmail: asString(payload.email),
    metadata: payload
  };
}
