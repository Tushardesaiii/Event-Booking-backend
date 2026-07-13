import { and, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailOutbox } from '../../db/schema/email-outbox.js';
import { emailCampaignRecipients } from '../../db/schema/email-campaign-recipients.js';
import { emailSuppressions } from '../../db/schema/email-suppressions.js';
import { sendBrevoEmail } from './brevo.js';
import { env } from '../../config/env.js';
import { cacheService } from '../cache.js';

let isRunning = false;
let timeoutId: NodeJS.Timeout | null = null;

export async function processOutboxQueue() {
  const now = new Date();
  const lockTimeout = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes lock timeout

  try {
    // 1. Atomically lock a batch of pending emails using transaction & SKIP LOCKED
    const lockedRecords = await db.transaction(async (tx) => {
      const subquery = await tx
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.status, 'pending'),
            lte(emailOutbox.availableAt, now),
            or(
              isNull(emailOutbox.lockedAt),
              lt(emailOutbox.lockedAt, lockTimeout)
            )
          )
        )
        .limit(env.EMAIL_BATCH_SIZE)
        .for('update', { skipLocked: true });

      if (subquery.length === 0) {
        return [];
      }

      const ids = subquery.map((r) => r.id);

      return tx
        .update(emailOutbox)
        .set({
          status: 'processing',
          lockedAt: now,
          updatedAt: now
        })
        .where(inArray(emailOutbox.id, ids))
        .returning();
    });

    if (lockedRecords.length === 0) {
      return;
    }

    console.log(`[Email Worker] Locked ${lockedRecords.length} outbox items for processing.`);

    // Batch lookup email suppressions
    const queries = lockedRecords
      .map((r) => {
        const payload = r.payloadJson as any;
        const email = payload?.to?.[0]?.email;
        return email ? { tenantId: r.tenantId, email } : null;
      })
      .filter((q): q is { tenantId: string; email: string } => q !== null);

    const suppressionMap = new Map<string, typeof emailSuppressions.$inferSelect>();
    if (queries.length > 0) {
      const orConditions = queries.map((q) =>
        and(eq(emailSuppressions.tenantId, q.tenantId), eq(emailSuppressions.email, q.email))
      );
      const suppressions = await db
        .select()
        .from(emailSuppressions)
        .where(or(...orConditions));

      for (const s of suppressions) {
        suppressionMap.set(`${s.tenantId}:${s.email.toLowerCase()}`, s);
      }
    }

    // 2. Process the locked records in parallel
    await Promise.allSettled(
      lockedRecords.map(async (record) => {
        try {
          const payload = record.payloadJson as {
            to: { email: string; name?: string }[];
            subject: string;
            htmlContent: string;
            textContent?: string | null;
            replyTo?: { email: string; name?: string } | null;
          };

          const recipientEmail = payload.to?.[0]?.email;

          // 3. Check for suppressions
          if (recipientEmail) {
            const suppression = suppressionMap.get(`${record.tenantId}:${recipientEmail.toLowerCase()}`);

            if (suppression) {
              console.log(`[Email Worker] Email to ${recipientEmail} is suppressed. Skipping send for record ${record.id}.`);
              
              await db.transaction(async (tx) => {
                await tx
                  .update(emailOutbox)
                  .set({
                    status: 'failed',
                    processedAt: new Date(),
                    lastError: `Skipped: recipient email is suppressed (reason: ${suppression.reason})`,
                    updatedAt: new Date()
                  })
                  .where(eq(emailOutbox.id, record.id));

                if (record.recipientId) {
                  await tx
                    .update(emailCampaignRecipients)
                    .set({
                      status: 'failed',
                      updatedAt: new Date()
                    })
                    .where(eq(emailCampaignRecipients.id, record.recipientId));
                }
              });
              return;
            }
          }

          // 4. Send email via Brevo
          const sendResult = await sendBrevoEmail({
            to: payload.to,
            subject: payload.subject,
            htmlContent: payload.htmlContent,
            textContent: payload.textContent,
            replyTo: payload.replyTo
          });

          // 5. Update outbox & recipient status upon success
          await db.transaction(async (tx) => {
            await tx
              .update(emailOutbox)
              .set({
                status: 'completed',
                processedAt: new Date(),
                updatedAt: new Date()
              })
              .where(eq(emailOutbox.id, record.id));

            if (record.recipientId) {
              await tx
                .update(emailCampaignRecipients)
                .set({
                  status: 'sent',
                  providerMessageId: sendResult.messageId ?? null,
                  providerBatchId: (sendResult as any).batchId ?? null,
                  updatedAt: new Date()
                })
                .where(eq(emailCampaignRecipients.id, record.recipientId));
            }
          });
        } catch (error: any) {
          console.error(`[Email Worker] Failed to process outbox item ${record.id}:`, error);

          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Check if error is retryable (network issue or server error like status 429, 502, 503, 504)
          const detailsStatus = error?.details?.status || error?.details?.statusCode;
          const statusToCheck = detailsStatus || error?.statusCode;

          const isRetryable =
            !statusToCheck || 
            statusToCheck === 429 ||
            statusToCheck === 502 ||
            statusToCheck === 503 ||
            statusToCheck === 504;

          const currentRetryCount = record.retryCount + 1;

          if (isRetryable && currentRetryCount <= record.maxRetries) {
            // Exponential backoff
            const backoffMs = Math.pow(2, currentRetryCount) * 2000;
            const availableAt = new Date(Date.now() + backoffMs);

            await db
              .update(emailOutbox)
              .set({
                status: 'pending',
                lockedAt: null,
                retryCount: currentRetryCount,
                availableAt,
                lastError: errorMessage,
                updatedAt: new Date()
              })
              .where(eq(emailOutbox.id, record.id));
          } else {
            // Mark as failed permanently
            await db.transaction(async (tx) => {
              await tx
                .update(emailOutbox)
                .set({
                  status: 'failed',
                  processedAt: new Date(),
                  lastError: errorMessage,
                  updatedAt: new Date()
                })
                .where(eq(emailOutbox.id, record.id));

              if (record.recipientId) {
                await tx
                  .update(emailCampaignRecipients)
                  .set({
                    status: 'failed',
                    updatedAt: new Date()
                  })
                  .where(eq(emailCampaignRecipients.id, record.recipientId));
              }
            });
          }
        }
      })
    );
  } catch (error) {
    console.error('[Email Worker] Error in outbox queue processing loop:', error);
  }
}

function tick() {
  timeoutId = setTimeout(async () => {
    if (!isRunning) return;
    await cacheService.set('revelis:worker:last_ping', Date.now().toString(), 60).catch(() => {});
    await processOutboxQueue();
    if (isRunning) {
      tick();
    }
  }, env.EMAIL_WORKER_POLL_INTERVAL_MS);
}

export function startEmailWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log('[Email Worker] Background worker started.');
  cacheService.set('revelis:worker:last_ping', Date.now().toString(), 60).catch(() => {});
  tick();
}

export function stopEmailWorker() {
  isRunning = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  console.log('[Email Worker] Background worker stopped.');
}
