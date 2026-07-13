import { db } from '../../db/client.js';
import { emailsRepository } from './repository.js';
import { emailDeliveries } from '../../db/schema/email-deliveries.js';
import { emailEvents } from '../../db/schema/email-events.js';
import { tenants } from '../../db/schema/tenants.js';
import { normalizeBrevoWebhookEvent } from '../../lib/email/brevo.js';
import { logger } from '../../lib/logger.js';
import { eq } from 'drizzle-orm';
import { incrementMetric } from '../../lib/metrics.js';

export class EmailsService {
  /**
   * Processes incoming webhook event notifications from Brevo.
   * Leverages idempotency checks to prevent duplicate processing.
   */
  async processWebhook(payload: Record<string, unknown>): Promise<{ success: boolean; reason?: string }> {
    // 1. Normalize Brevo Webhook Payload
    const event = normalizeBrevoWebhookEvent(payload);
    const providerEventId = event.providerEventId;

    logger.info('[EmailsService] Processing Brevo webhook event', { eventType: event.eventType, providerEventId });

    // 2. Check Idempotency (prevent replay / duplicate processing)
    const existingEvent = await emailsRepository.findEventByProviderId(db, providerEventId);
    if (existingEvent) {
      logger.info('[EmailsService] Event already processed. Skipping.', { providerEventId });
      return { success: true, reason: 'duplicate' };
    }

    // 3. Extract Message ID references if present
    const providerMessageId = (payload['message-id'] || payload['messageId'] || payload['msgid'] || payload['message_id']) as string | undefined;

    let delivery: any = null;
    if (providerMessageId) {
      // 4. Locate the corresponding delivery record
      const [row] = await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.providerMessageId, providerMessageId))
        .limit(1);
      delivery = row;
    }

    let tenantId = delivery?.tenantId;
    if (!tenantId) {
      const [firstTenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
      tenantId = firstTenant?.id || '00000000-0000-0000-0000-000000000000';
    }
    const userId = delivery?.userId || null;

    // 5. Update delivery status atomically if delivery is found
    const mappedStatus = this.mapEventToDeliveryStatus(event.eventType);
    if (delivery && mappedStatus) {
      await db
        .update(emailDeliveries)
        .set({
          status: mappedStatus,
          updatedAt: new Date()
        })
        .where(eq(emailDeliveries.id, delivery.id));
    }

    // 6. Persist event history record
    await emailsRepository.recordEmailEvent(db, {
      tenantId,
      campaignId: delivery?.metadata?.campaignId || null,
      recipientId: delivery?.metadata?.recipientId || null,
      providerEventId,
      eventType: event.eventType,
      metadata: event.metadata
    });

    // Increment Metrics
    this.incrementMetricForEvent(event.eventType);

    // 7. Core Compliance & Suppression Routing
    const recipientEmail = event.email || event.recipientEmail || delivery?.recipientEmail;
    
    if (recipientEmail) {
      const email = recipientEmail.trim().toLowerCase();

      // Track Bounces
      if (['bounce', 'soft_bounce', 'hard_bounce', 'invalid_email'].includes(event.eventType)) {
        await emailsRepository.recordBounce(db, {
          tenantId,
          email,
          bounceType: event.eventType,
          description: (payload.reason || payload.error) as string,
          providerMessageId,
          metadata: payload
        });
      }

      // Track Complaints
      if (['complaint', 'spam'].includes(event.eventType)) {
        await emailsRepository.recordComplaint(db, {
          tenantId,
          email,
          complaintType: event.eventType as string,
          providerMessageId,
          metadata: payload
        });
      }

      // Trigger Auto-Suppressions
      // Automatically suppress sending on hard bounces, spam complaints, and user unsubscribes
      const shouldSuppress = ['bounce', 'hard_bounce', 'complaint', 'spam', 'unsubscribe', 'unsubscribed'].includes(event.eventType);
      
      if (shouldSuppress) {
        let reason = 'unsubscribe';
        if (['bounce', 'hard_bounce'].includes(event.eventType)) reason = 'hard_bounce';
        if (['complaint', 'spam'].includes(event.eventType)) reason = 'spam_complaint';

        logger.info(`[EmailsService] Registering auto-suppression for ${email}`, { reason });

        await emailsRepository.addSuppression(db, {
          tenantId,
          email,
          reason,
          scope: 'individual',
          source: 'webhook_sync',
          metadata: { providerEventId }
        });

        // Also update preference center to unsubscribed marketing / campaign lists
        await emailsRepository.upsertPreferences(db, tenantId, email, {
          userId,
          marketing: false,
          campaign: false,
          notification: false
        });
      }
    }

    return { success: true };
  }

  private mapEventToDeliveryStatus(eventType: string): string | null {
    switch (eventType) {
      case 'delivered':
        return 'delivered';
      case 'opened':
        return 'opened';
      case 'clicked':
        return 'clicked';
      case 'bounce':
      case 'soft_bounce':
      case 'hard_bounce':
      case 'invalid_email':
        return 'failed';
      default:
        return null;
    }
  }

  private incrementMetricForEvent(eventType: string) {
    switch (eventType) {
      case 'delivered':
        incrementMetric('emails_delivered_total');
        break;
      case 'opened':
        incrementMetric('emails_opened_total');
        break;
      case 'clicked':
        incrementMetric('emails_clicked_total');
        break;
      case 'bounce':
      case 'soft_bounce':
      case 'hard_bounce':
        incrementMetric('emails_bounced_total');
        break;
      case 'complaint':
      case 'spam':
        incrementMetric('emails_complaints_total');
        break;
      case 'unsubscribe':
      case 'unsubscribed':
        incrementMetric('emails_unsubscribed_total');
        break;
    }
  }
}

export const emailsService = new EmailsService();
