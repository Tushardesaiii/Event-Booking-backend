export {
  sendBrevoEmail,
  sendBrevoBatch,
  type BrevoEmailAddress,
  type BrevoSendEmailInput,
  type BrevoSendEmailResult
} from './providers/brevo/client.js';

export {
  verifyBrevoWebhookSignature,
  normalizeBrevoWebhookEvent,
  type BrevoWebhookEvent,
  type BrevoWebhookEventType
} from './providers/brevo/webhooks.js';
