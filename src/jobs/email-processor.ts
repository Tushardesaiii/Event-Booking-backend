import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailDeliveries } from '../db/schema/email-deliveries.js';
import { emailAuditLogs } from '../db/schema/email-audit-logs.js';
import { brevoCoreClient } from '../lib/brevo.js';
import { logger } from '../lib/logger.js';
import { incrementMetric } from '../lib/metrics.js';

export async function processEmailDelivery(deliveryId: string): Promise<{ success: boolean; error?: string }> {
  logger.info('[EmailProcessor] Processing outbox email delivery', { deliveryId });

  // 1. Fetch the email delivery details
  const [delivery] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, deliveryId))
    .limit(1);

  if (!delivery) {
    logger.error('[EmailProcessor] Outbox record not found', { deliveryId });
    return { success: false, error: 'Outbox record not found' };
  }

  if (delivery.status === 'delivered' || delivery.status === 'sent') {
    logger.info('[EmailProcessor] Delivery already completed. Skipping.', { deliveryId, status: delivery.status });
    return { success: true };
  }

  try {
    // 2. Transition status to processing
    await db
      .update(emailDeliveries)
      .set({
        status: 'processing',
        updatedAt: new Date()
      })
      .where(eq(emailDeliveries.id, deliveryId));

    // 3. Dispatch to Brevo
    const response = await brevoCoreClient.sendTransactionalEmail({
      to: [{ email: delivery.recipientEmail }],
      subject: delivery.subject,
      htmlContent: delivery.htmlContent,
      textContent: delivery.textContent || undefined,
      metadata: { deliveryId: delivery.id }
    } as any);

    const providerMessageId = (response as any)?.messageId || (response as any)?.messageIds?.[0] || 'simulated';

    // 4. Update status upon success
    await db.transaction(async (tx) => {
      await tx
        .update(emailDeliveries)
        .set({
          status: 'delivered',
          providerMessageId,
          sentAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(emailDeliveries.id, deliveryId));

      await tx.insert(emailAuditLogs).values({
        tenantId: delivery.tenantId,
        userId: delivery.userId,
        action: 'send_success',
        email: delivery.recipientEmail,
        metadata: { deliveryId, providerMessageId }
      });
    });

    incrementMetric('emails_sent_total');
    incrementMetric('emails_delivered_total');

    logger.info('[EmailProcessor] Email delivered successfully', { deliveryId, providerMessageId });
    return { success: true };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[EmailProcessor] Failed to deliver email', { deliveryId, error: errorMessage });

    const newRetryCount = delivery.retryCount + 1;
    const isRetryable = newRetryCount <= delivery.maxRetries;

    if (isRetryable) {
      // Transition back to pending with updated retry count
      await db
        .update(emailDeliveries)
        .set({
          status: 'pending',
          retryCount: newRetryCount,
          lastError: errorMessage,
          updatedAt: new Date()
        })
        .where(eq(emailDeliveries.id, deliveryId));

      incrementMetric('emails_failed_total');

      // Throw error so QStash knows the job failed and triggers a retry
      throw new Error(`Email delivery processing failed (attempt ${newRetryCount}/${delivery.maxRetries}): ${errorMessage}`);
    } else {
      // Mark as permanently failed
      await db.transaction(async (tx) => {
        await tx
          .update(emailDeliveries)
          .set({
            status: 'failed',
            lastError: errorMessage,
            updatedAt: new Date()
          })
          .where(eq(emailDeliveries.id, deliveryId));

        await tx.insert(emailAuditLogs).values({
          tenantId: delivery.tenantId,
          userId: delivery.userId,
          action: 'send_failed_permanently',
          email: delivery.recipientEmail,
          metadata: { deliveryId, error: errorMessage }
        });
      });

      incrementMetric('emails_failed_total');
      return { success: false, error: errorMessage };
    }
  }
}
