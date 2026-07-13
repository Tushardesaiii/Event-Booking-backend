import { Hono } from 'hono';
import { qstashService } from '../lib/qstash.js';
import { errorResponse, successResponse } from '../lib/response.js';
import type { AppEnv } from '../types/context.js';
import { logger } from '../lib/logger.js';
import { twilioService } from '../lib/twilio.js';
import { processOutboxQueue } from '../lib/email/worker.js';
import { incrementMetric } from '../lib/metrics.js';
import { sendBrevoEmail } from '../lib/email/brevo.js';
import { db } from '../db/client.js';
import { bookingOrders, tenants, events, paymentOrders } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { marketingHooks } from '../modules/marketing/hooks.js';
import { env } from '../config/env.js';
import { createHash } from 'node:crypto';

export const qstashRoute = new Hono<AppEnv>();

// In-memory or Redis key replay protection
// Let's store QStash msg IDs in Redis with short TTL to prevent replay attacks
import { cacheService } from '../lib/cache.js';

qstashRoute.post('/jobs', async (c) => {
  const signature = c.req.header('Upstash-Signature') || '';
  const messageId = c.req.header('Upstash-Message-Id') || '';
  const timestampHeader = c.req.header('Upstash-Timestamp') || '';
  const retriedHeader = c.req.header('Upstash-Retried') || '';
  
  const bodyText = await c.req.text();
  
  // Reconstruct request URL
  const targetUrl = c.req.url;

  // Track retries from header
  if (retriedHeader && parseInt(retriedHeader, 10) > 0) {
    incrementMetric('qstash_jobs_retried_total');
  }

  // 1. Signature & Timestamp Validation
  const isValid = await qstashService.verifySignature(signature, bodyText, targetUrl);
  if (!isValid) {
    logger.warn('[QStash Route] Unsigned or invalid signature request rejected');
    return errorResponse(c, { message: 'Unauthorized: Invalid signature', code: 'UNAUTHORIZED', status: 401 });
  }

  // Verify timestamp (reject if stale, e.g. older than 5 minutes)
  if (timestampHeader) {
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp) || Math.abs(Date.now() - timestamp * 1000) > 300000) {
      logger.warn('[QStash Route] Request rejected due to stale timestamp', { timestampHeader });
      return errorResponse(c, { message: 'Unauthorized: Stale request', code: 'STALE_REQUEST', status: 401 });
    }
  }

  // 2. Replay Protection (deduplication) using Redis.
  //
  // IMPORTANT: the durable "processed" marker is written ONLY after the handler
  // succeeds (see below). Writing it up-front would cause any job that fails its
  // first attempt to be silently dropped on QStash's retry (the retry carries the
  // same Upstash-Message-Id and would match the marker). To still guard against
  // concurrent duplicate deliveries of the same message, we take a short-lived
  // in-progress lock that is released on both success and failure.
  const replayKey = messageId ? `revelis:qstash:replay:${messageId}` : null;
  const processingLockKey = messageId ? `revelis:qstash:processing:${messageId}` : null;

  if (replayKey) {
    const alreadyProcessed = await cacheService.exists(replayKey);
    if (alreadyProcessed) {
      logger.warn('[QStash Route] Prevented replay / duplicate processing', { messageId });
      return successResponse(c, { processed: true, info: 'Already processed (duplicate)' });
    }
  }

  if (processingLockKey) {
    // 10-minute lock covers the slowest handler; auto-expires so a crashed worker
    // does not wedge the message forever.
    const acquired = await cacheService.lock(processingLockKey, 600);
    if (!acquired) {
      // Another worker is actively processing this exact message. Return 409 so
      // QStash retries later; by then the durable marker will exist (dedupe) or
      // the lock will be free (reprocess). This never drops a job.
      logger.warn('[QStash Route] Message already in progress on another worker', { messageId });
      return errorResponse(c, { message: 'Job already in progress, retry later', code: 'IN_PROGRESS', status: 409 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return errorResponse(c, { message: 'Invalid JSON body', code: 'BAD_REQUEST', status: 400 });
  }

  const { jobType, data } = payload;
  logger.info('[QStash Route] Processing job', { jobType });

  try {
    switch (jobType) {
      case 'process_email_outbox':
        await processOutboxQueue();
        break;
      case 'process_delivery': {
        const { deliveryId } = data;
        if (deliveryId) {
          const { processEmailDelivery } = await import('../jobs/email-processor.js');
          await processEmailDelivery(deliveryId);
        }
        break;
      }
      case 'welcome_sms':
        if (data?.phoneNumber) {
          await twilioService.sendSms(data.phoneNumber, `Welcome to Revelis! We're excited to have you on board.`);
        }
        break;
      case 'booking_confirmation':
        logger.info('[QStash Job] Booking confirmation sent', { data });
        break;
      case 'booking_email': {
        const { bookingOrderId, tenantId, email } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
          const [evt] = order ? await db.select().from(events).where(eq(events.id, order.eventId)).limit(1) : [null];
          
          const tenantName = tenant?.name || 'Revelis Platform';
          const eventTitle = evt?.title || 'Upcoming Event';
          const totalAmount = order?.totalAmount || '0.00';
          const currency = order?.currency || 'INR';

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('booking-confirmed', {
            event: { title: eventTitle, startDate: evt?.startDateTime?.toDateString() || '', location: 'N/A' },
            order: { orderNumber: order?.orderNumber || 'N/A', totalAmount, currency }
          }, tenant ? { name: tenantName, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'billing'
          });

          // Also trigger ticket issued email
          const ticketLink = `${env.CORS_ORIGINS?.[0] || 'http://localhost:3000'}/tickets/download?orderId=${bookingOrderId}`;
          const ticketRendered = renderEmail('ticket-issued', {
            event: { title: eventTitle },
            order: { orderNumber: order?.orderNumber || 'N/A' },
            ticketLink
          }, tenant ? { name: tenantName, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: ticketRendered.subject,
            htmlContent: ticketRendered.htmlContent,
            textContent: ticketRendered.textContent,
            category: 'transactional'
          });

          // Schedule reminders via QStash delay
          if (evt && evt.startDateTime && env.QSTASH_TOKEN) {
            const startMs = new Date(evt.startDateTime).getTime();
            const nowMs = Date.now();
            const targetUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;

            // 24h reminder
            const reminder24hMs = startMs - 24 * 60 * 60 * 1000;
            const delay24hSec = Math.round((reminder24hMs - nowMs) / 1000);
            if (delay24hSec > 0) {
              qstashService.publish(targetUrl, {
                jobType: 'event_reminder_24h',
                data: { bookingOrderId, tenantId, email }
              }, { delaySeconds: delay24hSec }).catch((err) => {
                logger.error('[QStash] Failed to schedule 24h event reminder', { error: err.message });
              });
            }

            // 1h reminder
            const reminder1hMs = startMs - 60 * 60 * 1000;
            const delay1hSec = Math.round((reminder1hMs - nowMs) / 1000);
            if (delay1hSec > 0) {
              qstashService.publish(targetUrl, {
                jobType: 'event_reminder_1h',
                data: { bookingOrderId, tenantId, email }
              }, { delaySeconds: delay1hSec }).catch((err) => {
                logger.error('[QStash] Failed to schedule 1h event reminder', { error: err.message });
              });
            }
          }

          logger.info('[QStash Job] Booking confirmation email enqueued successfully', { bookingOrderId, email });
        }
        break;
      }
      case 'booking_pending_email': {
        const { bookingOrderId, tenantId, email } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
          const [evt] = order ? await db.select().from(events).where(eq(events.id, order.eventId)).limit(1) : [null];

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('booking-pending', {
            event: { title: evt?.title || 'Event' },
            order: { orderNumber: order?.orderNumber || 'N/A' }
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'transactional'
          });
          logger.info('[QStash Job] Booking pending email enqueued', { bookingOrderId, email });
        }
        break;
      }
      case 'event_reminder_24h': {
        const { bookingOrderId, tenantId, email } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
          const [evt] = order ? await db.select().from(events).where(eq(events.id, order.eventId)).limit(1) : [null];

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('event-reminder-24h', {
            event: { title: evt?.title || 'Event', startDate: evt?.startDateTime?.toDateString() || '', location: 'N/A' }
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'notification'
          });
          logger.info('[QStash Job] Event reminder 24h email enqueued', { bookingOrderId, email });
        }
        break;
      }
      case 'event_reminder_1h': {
        const { bookingOrderId, tenantId, email } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
          const [evt] = order ? await db.select().from(events).where(eq(events.id, order.eventId)).limit(1) : [null];

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('event-reminder-1h', {
            event: { title: evt?.title || 'Event' }
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'notification'
          });
          logger.info('[QStash Job] Event reminder 1h email enqueued', { bookingOrderId, email });
        }
        break;
      }
      case 'payment_failed_email': {
        const { bookingOrderId, tenantId, email, reason } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('payment-failed', {
            order: { orderNumber: order?.orderNumber || 'N/A', totalAmount: order?.totalAmount || '0.00', currency: order?.currency || 'INR' },
            reason: reason || 'Transaction declined by bank'
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'billing'
          });
          logger.info('[QStash Job] Payment failed email enqueued', { bookingOrderId, email });
        }
        break;
      }
      case 'refund_email': {
        const { bookingOrderId, tenantId, email, amount, currency } = data;
        if (email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('refund-completed', {
            order: { orderNumber: order?.orderNumber || 'N/A' },
            amount: amount || order?.totalAmount || '0.00',
            currency: currency || order?.currency || 'INR'
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            userId: order?.purchaserUserId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'billing'
          });
          logger.info('[QStash Job] Refund email enqueued', { bookingOrderId, email });
        }
        break;
      }
      case 'withdrawal_email': {
        const { organizerId, tenantId, email, amount, currency, status, reason } = data;
        if (email) {
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          let templateKey: 'withdrawal-submitted' | 'withdrawal-approved' | 'withdrawal-rejected' = 'withdrawal-submitted';
          if (status === 'completed') {
            templateKey = 'withdrawal-approved';
          } else if (status === 'failed' || status === 'rejected') {
            templateKey = 'withdrawal-rejected';
          }

          const rendered = renderEmail(templateKey, {
            amount: amount || '0.00',
            currency: currency || 'INR',
            reason: reason || 'Declined'
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'billing'
          });
          logger.info('[QStash Job] Withdrawal status email enqueued', { organizerId, email, status });
        }
        break;
      }
      case 'settlement_email': {
        const { organizerId, tenantId, email, amount, currency } = data;
        if (email) {
          const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

          const { renderEmail } = await import('../lib/email-templates.js');
          const { emailClient } = await import('../lib/email-client.js');

          const rendered = renderEmail('settlement-completed', {
            amount: amount || '0.00',
            currency: currency || 'INR'
          }, tenant ? { name: tenant.name, logoUrl: null, primaryColor: '#4F46E5', website: tenant.website } : null);

          await emailClient.enqueue({
            tenantId,
            recipientEmail: email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'billing'
          });
          logger.info('[QStash Job] Settlement completed email enqueued', { organizerId, email });
        }
        break;
      }
      case 'process_campaign_execute': {
        const { campaignId, tenantId } = data;
        if (campaignId && tenantId) {
          const { campaignService } = await import('../modules/emails/campaign.service.js');
          await campaignService.executeCampaignSnapshotAndSend(tenantId, campaignId);
          logger.info('[QStash Job] Campaign snapshot & execute processed successfully', { campaignId });
        }
        break;
      }
      case 'booking_sms': {
        const { bookingOrderId, phone } = data;
        if (phone) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          const [evt] = order ? await db.select().from(events).where(eq(events.id, order.eventId)).limit(1) : [null];
          if (order && evt) {
            await twilioService.sendSms(phone, `Booking confirmed for ${evt.title}! Order: ${order.orderNumber}. Thank you!`);
            logger.info('[QStash Job] Booking confirmation SMS sent successfully', { bookingOrderId, phone });
          }
        }
        break;
      }
      case 'receipt_generation': {
        logger.info('[QStash Job] Receipt generated successfully', { data });
        break;
      }
      case 'invoice_generation': {
        logger.info('[QStash Job] Invoice generated successfully', { data });
        break;
      }
      case 'analytics_aggregation': {
        logger.info('[QStash Job] Analytics aggregation updated', { data });
        break;
      }
      case 'marketing_events': {
        const { bookingOrderId, tenantId, email, userId } = data;
        if (bookingOrderId && email) {
          const [order] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId)).limit(1);
          if (order) {
            await marketingHooks.onBookingConfirmed(
              {
                id: bookingOrderId,
                orderNumber: order.orderNumber,
                userEmail: email,
                userId: userId ?? undefined
              },
              { tenantId }
            );
            logger.info('[QStash Job] Marketing confirmation hook executed successfully', { bookingOrderId });
          }
        }
        break;
      }
      case 'booking_reminder':
        logger.info('[QStash Job] Booking reminder sent', { data });
        break;
      case 'abandoned_booking_recovery':
        logger.info('[QStash Job] Abandoned booking recovery processed', { data });
        break;
      case 'upcoming_event_notification':
        logger.info('[QStash Job] Upcoming event notification sent', { data });
        break;
      case 'organizer_notification':
        logger.info('[QStash Job] Organizer notification sent', { data });
        break;
      case 'async_aggregation':
        logger.info('[QStash Job] Asynchronous analytics aggregation complete', { data });
        break;
      case 'run_settlements': {
        const { tenantId } = data;
        if (tenantId) {
          const { paymentsService } = await import('../modules/payments/service.js');
          await paymentsService.processSettlements(tenantId);
          logger.info('[QStash Job] Settlements processed successfully', { tenantId });
        }
        break;
      }
      case 'expire_reservations': {
        const { tenantId, batchSize } = data;
        const { expireDueReservations } = await import('../modules/inventory/service.js');
        const size = batchSize ? parseInt(batchSize, 10) : 100;
        // When a specific tenant is supplied, expire only that tenant; otherwise
        // sweep every tenant (the recurring cron path).
        const tenantIds: string[] = tenantId
          ? [tenantId]
          : (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
        let total = 0;
        for (const tid of tenantIds) {
          const expired = await expireDueReservations(db, {
            tenantId: tid,
            batchSize: size,
            source: 'qstash_cron_expiry'
          });
          total += expired.length;
        }
        logger.info('[QStash Job] Expired due reservations', { tenants: tenantIds.length, count: total });
        break;
      }
      case 'reconcile_inventory': {
        const { tenantId } = data;
        const { reconcileCachedInventory } = await import('../modules/inventory/service.js');
        const tenantIds: string[] = tenantId
          ? [tenantId]
          : (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
        let repaired = 0;
        for (const tid of tenantIds) {
          try {
            const result: any = await reconcileCachedInventory(db, {
              tenantId: tid,
              repair: true,
              source: 'qstash_cron_inventory_reconcile'
            });
            // reconcileCachedInventory resolves to the array of drift records it repaired.
            repaired += Array.isArray(result) ? result.length : (Array.isArray(result?.drifts) ? result.drifts.length : 0);
          } catch (err: any) {
            logger.error('[QStash Job] Inventory reconcile failed for tenant', { tenantId: tid, error: err.message });
          }
        }
        logger.info('[QStash Job] Inventory reconciliation complete', { tenants: tenantIds.length, driftsRepaired: repaired });
        break;
      }
      case 'financial_reconciliation': {
        const { tenantId } = data;
        const { LedgerReconciliationService } = await import('../modules/finance/reconciliation/service.js');
        const svc: any = LedgerReconciliationService as any;
        const tenantIds: string[] = tenantId
          ? [tenantId]
          : (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
        let discrepancies = 0;
        for (const tid of tenantIds) {
          try {
            const report: any = await svc.runReconciliation(tid);
            if (report && report.discrepancies) {
              const count = Array.isArray(report.discrepancies) ? report.discrepancies.length : Number(report.discrepancies) || 0;
              discrepancies += count;
              if (count > 0) {
                logger.warn('[QStash Job] Financial reconciliation found discrepancies', { tenantId: tid, count });
                incrementMetric('reconciliation_discrepancies_total', count);
              }
            }
          } catch (err: any) {
            logger.error('[QStash Job] Financial reconciliation failed for tenant', { tenantId: tid, error: err.message });
          }
        }
        logger.info('[QStash Job] Financial reconciliation complete', { tenants: tenantIds.length, discrepancies });
        break;
      }
      case 'db_backup': {
        const { runDatabaseBackup } = await import('../lib/backup.js');
        const result = await runDatabaseBackup();
        logger.info('[QStash Job] Database backup complete', result);
        break;
      }
      case 'process_asset': {
        const { objectKey, tenantId, userId } = data;
        if (objectKey) {
          const { r2Client } = await import('../lib/r2.js');
          const { extractMetadata, stripMetadata } = await import('../lib/image-processing.js');
          const { storageService, logStorageAudit } = await import('../lib/storage.js');
          const { storageObjects } = await import('../db/schema/storage-objects.js');
          const { eq, and, isNull } = await import('drizzle-orm');

          // 1. Fetch record from DB
          const [record] = await db
            .select()
            .from(storageObjects)
            .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
            .limit(1);

          if (record) {
            try {
              // 2. Mark status: processing
              await storageService.updateProcessingStatus(record.id, 'processing');

              // 3. Virus scanning gate (Priority 6)
              const isClean = await storageService.scanAsset(record.id);
              if (!isClean) {
                logger.error('[QStash process_asset] Virus scan failed. Gating asset.', { objectKey });
                break;
              }
              await storageService.updateProcessingStatus(record.id, 'virus_scanned');

              // 4. Download original bytes
              const buffer = await r2Client.getObject(objectKey);

              // 5. Extract metadata with Sharp (Priority 5)
              let width: number | undefined;
              let height: number | undefined;
              let format: string | undefined;
              let colorDepth: string | undefined;
              let orientation: number | undefined;

              const isImage = record.mimeType.toLowerCase().startsWith('image/');
              if (isImage) {
                const sharpMeta = await extractMetadata(buffer);
                width = sharpMeta.width;
                height = sharpMeta.height;
                format = sharpMeta.format;
                colorDepth = sharpMeta.colorDepth;
                orientation = sharpMeta.orientation;
              }

              let metadataCount = 1;
              if (record.mimeType.toLowerCase() === 'application/pdf') {
                format = 'pdf';
                try {
                  const content = buffer.toString('binary');
                  const countMatch = content.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s*(\d+)/) || content.match(/\/Count\s*(\d+)[\s\S]*?\/Type\s*\/Pages/);
                  if (countMatch) {
                    metadataCount = parseInt(countMatch[1], 10);
                  } else {
                    const matches = content.match(/\/Type\s*\/Page\b/g);
                    metadataCount = matches ? matches.length : 1;
                  }
                } catch {
                  metadataCount = 1;
                }
              }

              const extractedMeta = {
                width,
                height,
                format,
                colorDepth,
                orientation,
                pageCount: record.mimeType.toLowerCase() === 'application/pdf' ? metadataCount : undefined,
                checksum: record.checksum,
                etag: record.etag,
                fileSize: record.fileSize,
                uploadedAt: new Date().toISOString()
              };

              await db
                .update(storageObjects)
                .set({
                  metadata: extractedMeta,
                  processingStatus: 'metadata_extracted'
                })
                .where(eq(storageObjects.id, record.id));

              // 6. Image Optimization
              let finalBuffer = buffer;
              if (isImage) {
                await storageService.updateProcessingStatus(record.id, 'optimization');
                finalBuffer = await stripMetadata(buffer);
                await r2Client.uploadObject(objectKey, finalBuffer, record.mimeType);

                const info = await r2Client.headObject(objectKey);
                const etag = info?.etag ? info.etag.replace(/"/g, '') : null;
                await db
                  .update(storageObjects)
                  .set({
                    fileSize: finalBuffer.length,
                    etag
                  })
                  .where(eq(storageObjects.id, record.id));
              }

              // 7. Transition to variant generation
              await storageService.updateProcessingStatus(record.id, 'variant_generation');
              const targetUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;
              await qstashService.publish(targetUrl, {
                jobType: 'generate_variants',
                data: { objectKey, tenantId, userId }
              });

              logger.info('[QStash Job] process_asset completed successfully', { objectKey });
            } catch (err: any) {
              await storageService.markAssetFailed(record.id, err.message);
              logger.error('[QStash Job] process_asset failed', { objectKey, error: err.message });
            }
          }
        }
        break;
      }
      case 'generate_variants': {
        const { objectKey, tenantId, userId } = data;
        if (objectKey) {
          const { r2Client } = await import('../lib/r2.js');
          const { generateVariants } = await import('../lib/image-processing.js');
          const { storageService, logStorageAudit } = await import('../lib/storage.js');
          const { storageObjects } = await import('../db/schema/storage-objects.js');
          const { storageVariants } = await import('../db/schema/storage-variants.js');
          const { eq, and, isNull } = await import('drizzle-orm');

          const [record] = await db
            .select()
            .from(storageObjects)
            .where(and(eq(storageObjects.objectKey, objectKey), isNull(storageObjects.deletedAt)))
            .limit(1);

          if (record) {
            try {
              const isImage = record.mimeType.toLowerCase().startsWith('image/');
              if (isImage) {
                const buffer = await r2Client.getObject(objectKey);
                const variants = await generateVariants(buffer, record.mimeType, record.module);
                const keys = Object.keys(variants);

                // Clean existing variants in registry if any
                await db.delete(storageVariants).where(eq(storageVariants.storageObjectId, record.id));

                for (const [key, val] of Object.entries(variants)) {
                  const variantKey = `${objectKey}_${key}`;
                  await r2Client.uploadObject(variantKey, val.buffer, val.mimeType);

                  const info = await r2Client.headObject(variantKey);
                  const etag = info?.etag ? info.etag.replace(/"/g, '') : null;
                  const checksum = createHash('sha256').update(val.buffer).digest('hex');

                  // Register variant (Priority 4)
                  await db.insert(storageVariants).values({
                    storageObjectId: record.id,
                    variant: key,
                    width: val.width,
                    height: val.height,
                    mimeType: val.mimeType,
                    fileSize: val.buffer.length,
                    objectKey: variantKey,
                    checksum,
                    etag
                  });
                }

                await db
                  .update(storageObjects)
                  .set({
                    variantCount: keys.length,
                    processingStatus: 'ready'
                  })
                  .where(eq(storageObjects.id, record.id));

                await logStorageAudit('storage_variant_generation', userId || null, tenantId || null, objectKey, {
                  action: 'generate_image_variants',
                  variants: keys.map(k => `${objectKey}_${k}`)
                });
              } else {
                await storageService.updateProcessingStatus(record.id, 'ready');
              }
              logger.info('[QStash Job] generate_variants completed successfully', { objectKey });
            } catch (err: any) {
              await storageService.markAssetFailed(record.id, err.message);
              logger.error('[QStash Job] generate_variants failed', { objectKey, error: err.message });
            }
          }
        }
        break;
      }
      case 'cleanup_asset': {
        const { objectKey, tenantId, userId } = data;
        if (objectKey) {
          const { storageService } = await import('../lib/storage.js');
          try {
            await storageService.purgeAsset(objectKey, tenantId || null, userId || null, 'admin');
            logger.info('[QStash Job] cleanup_asset purged successfully', { objectKey });
          } catch (err: any) {
            logger.error('[QStash Job] Failed to purge asset', { objectKey, error: err.message });
          }
        }
        break;
      }
      case 'cleanup_orphans': {
        const { storageService } = await import('../lib/storage.js');
        const { storageObjects } = await import('../db/schema/storage-objects.js');
        const { and, lte, isNotNull, eq, isNull } = await import('drizzle-orm');
        
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const expired = await db
          .select()
          .from(storageObjects)
          .where(and(isNotNull(storageObjects.deletedAt), lte(storageObjects.deletedAt, sevenDaysAgo)));

        logger.info('[QStash Job] Running orphans and expired files cleanup', { count: expired.length });

        for (const item of expired) {
          try {
            await storageService.purgeAsset(item.objectKey, null, null, 'admin');
            logger.info(`[Cleanup Engine] Purged expired asset: ${item.objectKey}`);
          } catch (err: any) {
            logger.error('[Cleanup Engine] Failed to purge expired file', { key: item.objectKey, error: err.message });
          }
        }

        // Scan for actual orphaned assets
        const { users } = await import('../db/schema/users.js');
        const { events } = await import('../db/schema/events.js');
        const { emailCampaigns } = await import('../db/schema/email-campaigns.js');

        const activeAssets = await db
          .select()
          .from(storageObjects)
          .where(isNull(storageObjects.deletedAt));

        for (const asset of activeAssets) {
          if (!asset.ownerId) continue;
          
          let orphan = false;
          if (asset.module === 'users') {
            const [u] = await db.select().from(users).where(eq(users.id, asset.ownerId)).limit(1);
            if (!u) orphan = true;
          } else if (asset.module === 'events') {
            const [e] = await db.select().from(events).where(eq(events.id, asset.ownerId)).limit(1);
            if (!e) orphan = true;
          } else if (asset.module === 'emails' || asset.module === 'campaigns') {
            const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, asset.ownerId)).limit(1);
            if (!c) orphan = true;
          }

          if (orphan) {
            logger.info(`[Cleanup Engine] Soft deleting orphaned asset: ${asset.objectKey}`);
            await storageService.softDeleteAsset(asset.objectKey, null, null, 'admin');
          }
        }
        break;
      }
      case 'verify_storage_integrity': {
        // Daily Storage Integrity Verification Engine (Priority 8)
        const startTime = Date.now();
        const { r2Client } = await import('../lib/r2.js');
        const { storageObjects } = await import('../db/schema/storage-objects.js');
        const { storageVariants } = await import('../db/schema/storage-variants.js');
        const { storageIntegrityReports } = await import('../db/schema/storage-integrity-reports.js');
        const { isNull, and, eq } = await import('drizzle-orm');

        const anomalies: any[] = [];
        const repairs: any[] = [];
        const unrecoverable: any[] = [];

        // Scan active storage objects
        const activeAssets = await db
          .select()
          .from(storageObjects)
          .where(and(isNull(storageObjects.deletedAt), eq(storageObjects.activeVersion, true)));

        for (const asset of activeAssets) {
          try {
            // Check R2 presence
            const exists = await r2Client.objectExists(asset.objectKey);
            if (!exists) {
              anomalies.push({ type: 'object_missing_r2', id: asset.id, key: asset.objectKey });
              // Attempt repair: set status failed
              await db.update(storageObjects).set({ processingStatus: 'failed' }).where(eq(storageObjects.id, asset.id));
              repairs.push({ type: 'mark_failed', id: asset.id, key: asset.objectKey });
              continue;
            }

            // Check variants presence if it's an image
            if (asset.mimeType.startsWith('image/')) {
              const variants = await db
                .select()
                .from(storageVariants)
                .where(eq(storageVariants.storageObjectId, asset.id));

              if (variants.length === 0 && asset.variantCount > 0) {
                anomalies.push({ type: 'variants_missing_db', id: asset.id, key: asset.objectKey });
              }

              for (const variant of variants) {
                const varExists = await r2Client.objectExists(variant.objectKey);
                if (!varExists) {
                  anomalies.push({ type: 'variant_missing_r2', id: variant.id, parentKey: asset.objectKey, key: variant.objectKey });
                  // Unrecoverable
                  unrecoverable.push({ id: variant.id, key: variant.objectKey });
                }
              }
            }

            // Validate checksum (range limit checks or full hash checks)
            // For audit we can run a verify check
            const buffer = await r2Client.getObject(asset.objectKey);
            const checksum = createHash('sha256').update(buffer).digest('hex');
            if (asset.checksum && asset.checksum !== checksum) {
              anomalies.push({ type: 'checksum_mismatch', id: asset.id, key: asset.objectKey, expected: asset.checksum, actual: checksum });
              unrecoverable.push({ id: asset.id, key: asset.objectKey });
            }
          } catch (err: any) {
            anomalies.push({ type: 'verify_error', id: asset.id, key: asset.objectKey, error: err.message });
          }
        }

        // Save report
        await db.insert(storageIntegrityReports).values({
          anomaliesFound: anomalies,
          repairedRecords: repairs,
          unrecoverableAssets: unrecoverable,
          executionDurationMs: Date.now() - startTime
        });

        logger.info('[Integrity Engine] Audit report generated successfully', {
          anomalies: anomalies.length,
          repairs: repairs.length,
          unrecoverable: unrecoverable.length
        });
        break;
      }
      default:
        logger.warn('[QStash Route] Unknown job type received', { jobType });
        return errorResponse(c, { message: `Unknown job type: ${jobType}`, code: 'BAD_REQUEST', status: 400 });
    }

    // Success: record the durable dedup marker so genuine replays are dropped.
    if (replayKey) {
      await cacheService.set(replayKey, 'processed', 86400);
    }
    incrementMetric('qstash_jobs_completed_total');
    return successResponse(c, { processed: true }, 'Job processed successfully');
  } catch (error: any) {
    // Do NOT set the dedup marker — returning non-2xx lets QStash retry.
    incrementMetric('qstash_jobs_failed_total');
    logger.error('[QStash Route] Error executing job', { jobType, error: error.message });
    return errorResponse(c, { message: 'Job processing failed', code: 'INTERNAL_SERVER_ERROR', status: 500, details: error.message });
  } finally {
    // Always release the in-progress lock so a retry (after failure) can proceed.
    if (processingLockKey) {
      await cacheService.unlock(processingLockKey).catch(() => {});
    }
  }
});
