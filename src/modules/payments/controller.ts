import type { Context } from 'hono';
import { createHmac } from 'node:crypto';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { paymentsService } from './service.js';
import { razorpayClient, timingSafeEqualHex } from '../../lib/razorpay.js';
import { forbidden, unauthorized, badRequest, notFound } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import { requireParam } from '../../lib/http-context.js';
import { logger } from '../../lib/logger.js';
import { incrementMetric } from '../../lib/metrics.js';
import type { AppEnv } from '../../types/context.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  paymentOrders,
  paymentTransactions,
  paymentRefunds,
  paymentWebhookEvents,
  organizers,
  organizerWallets,
  organizerWalletTransactions,
  withdrawalRequests,
  settlementRuns,
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  bookingOrders,
  events,
  users
} from '../../db/schema/index.js';
import { cacheService } from '../../lib/cache.js';
import { reconciliationService } from './reconciliation/service.js';
import { reconciliationRepository } from './reconciliation/repository.js';
import { paymentsRepository } from './repository.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

function maskSensitiveData(value: string | null | undefined): string {
  if (!value) return '';
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (local.length <= 2) return `*@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}******${value.slice(-3)}`;
}

export const paymentsController = {
  /**
   * Create Razorpay order for a booking order
   */
  async createOrder(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const body = c.get('validatedBody') as any;
    const bookingOrderId = body.bookingOrderId || body.bookingId;

    logger.info('[PaymentsController] POST /payments/create-order initiated', {
      bookingOrderId,
      tenantId: tenant.id,
      userId: user.id
    });

    const result = await paymentsService.createPaymentOrder(tenant.id, user.id, bookingOrderId);

    logger.info('[PaymentsController] Razorpay order created successfully', {
      bookingOrderId,
      razorpayOrderId: result.orderId
    });

    return successResponse(c, result, 'Razorpay order created', 201);
  },

  /**
   * Capture authorized payment manually
   */
  async capturePayment(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));
    
    if (!body.razorpayPaymentId || !body.amount || !body.currency) {
      throw badRequest('Missing required fields: razorpayPaymentId, amount, currency');
    }

    logger.info('[PaymentsController] POST /payments/capture initiated', {
      razorpayPaymentId: body.razorpayPaymentId,
      amount: body.amount,
      tenantId: tenant.id
    });

    const result = await paymentsService.capturePayment(
      tenant.id,
      user.id,
      body.razorpayPaymentId,
      body.amount,
      body.currency
    );

    return successResponse(c, result, 'Payment captured successfully', 200);
  },

  /**
   * Process refund (Owner/Admin only)
   */
  async refundPayment(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const body = c.get('validatedBody') as any;

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw forbidden('Only owners or admins are authorized to process refunds');
    }

    logger.info('[PaymentsController] POST /payments/refund initiated', {
      paymentTransactionId: body.paymentTransactionId,
      amount: body.amount,
      tenantId: tenant.id,
      userId: user.id
    });

    const refund = await paymentsService.refundPayment(
      tenant.id,
      user.id,
      body.paymentTransactionId,
      body.amount,
      body.reason
    );

    return successResponse(c, refund, 'Refund processed successfully', 200);
  },

  /**
   * Verify checkout signatures dynamically
   */
  async verifyPayment(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const body = c.get('validatedBody') as any;

    const razorpayOrderId = body.razorpayOrderId || body.razorpay_order_id;
    const razorpayPaymentId = body.razorpayPaymentId || body.razorpay_payment_id;
    const razorpaySignature = body.razorpaySignature || body.razorpay_signature;

    const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
    const expectedSignature = createHmac('sha256', secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!timingSafeEqualHex(expectedSignature, String(razorpaySignature ?? ''))) {
      logger.warn('[PaymentsController] Invalid payment signature verification attempt', {
        razorpayOrderId
      });
      throw badRequest('Invalid payment signature');
    }

    const lockKey = `payment:confirm:${razorpayPaymentId}`;
    const lockAcquired = await cacheService.lock(lockKey, 15);
    if (!lockAcquired) {
      const existingTx = await paymentsRepository.findPaymentTransactionByRazorpayPaymentId(db, razorpayPaymentId);
      if (existingTx && existingTx.status === 'captured') {
        return successResponse(c, { verified: true }, 'Payment verified and captured (already processed)', 200);
      }
      throw badRequest('Payment verification is already in progress');
    }

    try {
      const reservationId = body.reservationId;
      const reservationToken = body.reservationToken;

      // Call service to confirm the payment
      await paymentsService.confirmPaymentAndOrder(razorpayOrderId, razorpayPaymentId, {
        checkout_verified: true
      }, {
        lockAcquired: true,
        reservationId,
        reservationToken
      });
    } finally {
      await cacheService.unlock(lockKey);
    }

    return successResponse(c, { verified: true }, 'Payment verified and captured', 200);
  },

  /**
   * Get specific payment order detail
   */
  async getPaymentById(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');

    const paymentOrder = await paymentsRepository.findPaymentOrderById(db, tenant.id, id);
    if (!paymentOrder) {
      throw notFound('Payment order not found');
    }

    return successResponse(c, paymentOrder, 'Payment order details fetched', 200);
  },

  async syncPaymentState(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const result = await paymentsService.syncPaymentState(tenant.id, id);
    return successResponse(c, result, 'Payment state synchronized with provider', 200);
  },

  async getPaymentTimeline(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const timeline = await paymentsService.getPaymentTimeline(tenant.id, id);
    return successResponse(c, timeline, 'Payment history timeline fetched successfully', 200);
  },

  /**
   * Customer-facing refund request
   */
  async requestCustomerRefund(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const body = c.get('validatedBody') as any;

    const refund = await paymentsService.requestCustomerRefund(
      tenant.id,
      body.bookingOrderId,
      user.id,
      body.reason
    );

    return successResponse(c, refund, 'Customer refund processed successfully', 200);
  },

  /**
   * List customer payments history
   */
  async getCustomerHistory(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.tenantId, tenant.id), eq(paymentOrders.createdBy, user.id)))
      .orderBy(desc(paymentOrders.createdAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Payment history fetched successfully', 200, {
      page,
      limit
    });
  },

  /**
   * List customer refund requests history
   */
  async getCustomerRefunds(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const items = await db
      .select({
        id: paymentRefunds.id,
        tenantId: paymentRefunds.tenantId,
        amount: paymentRefunds.amount,
        status: paymentRefunds.status,
        reason: paymentRefunds.reason,
        createdAt: paymentRefunds.createdAt,
        bookingOrderId: paymentOrders.bookingOrderId
      })
      .from(paymentRefunds)
      .innerJoin(paymentTransactions, eq(paymentTransactions.id, paymentRefunds.paymentTransactionId))
      .innerJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
      .where(and(eq(paymentRefunds.tenantId, tenant.id), eq(paymentOrders.createdBy, user.id)))
      .orderBy(desc(paymentRefunds.createdAt));

    return successResponse(c, items, 'Customer refunds fetched successfully', 200);
  },

  /**
   * Get detail of a specific refund request
   */
  async getCustomerRefundById(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const [refund] = await db
      .select({
        id: paymentRefunds.id,
        tenantId: paymentRefunds.tenantId,
        amount: paymentRefunds.amount,
        status: paymentRefunds.status,
        reason: paymentRefunds.reason,
        createdAt: paymentRefunds.createdAt,
        bookingOrderId: paymentOrders.bookingOrderId
      })
      .from(paymentRefunds)
      .innerJoin(paymentTransactions, eq(paymentTransactions.id, paymentRefunds.paymentTransactionId))
      .innerJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
      .where(and(eq(paymentRefunds.id, id), eq(paymentRefunds.tenantId, tenant.id), eq(paymentOrders.createdBy, user.id)))
      .limit(1);

    if (!refund) {
      throw notFound('Refund not found');
    }
    return successResponse(c, refund, 'Refund details fetched', 200);
  },

  /**
   * Fetch organizer profile (helper)
   */
  async getOrganizerOrThrow(tenantId: string, userId: string) {
    const [organizer] = await db
      .select()
      .from(organizers)
      .where(and(eq(organizers.tenantId, tenantId), eq(organizers.createdByUserId, userId), isNull(organizers.deletedAt)))
      .limit(1);

    if (!organizer) {
      throw forbidden('Only organizer accounts can perform wallet actions');
    }
    return organizer;
  },

  /**
   * Get organizer wallet
   */
  async getOrganizerWallet(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const organizer = await paymentsController.getOrganizerOrThrow(tenant.id, user.id);

    let wallet = await paymentsRepository.findOrganizerWallet(db, tenant.id, organizer.id);
    if (!wallet) {
      wallet = await paymentsRepository.createOrganizerWallet(db, { tenantId: tenant.id, organizerId: organizer.id });
    }

    return successResponse(c, wallet, 'Organizer wallet details fetched', 200);
  },

  /**
   * Get organizer wallet transactions
   */
  async getOrganizerWalletTransactions(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const organizer = await paymentsController.getOrganizerOrThrow(tenant.id, user.id);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;
    const offset = (page - 1) * limit;

    const txs = await db
      .select()
      .from(organizerWalletTransactions)
      .where(and(eq(organizerWalletTransactions.tenantId, tenant.id), eq(organizerWalletTransactions.organizerId, organizer.id)))
      .orderBy(desc(organizerWalletTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, txs, 'Wallet transactions list fetched', 200, { page, limit });
  },

  /**
   * Submit withdrawal request
   */
  async requestWithdrawal(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const body = c.get('validatedBody') as any;

    const organizer = await paymentsController.getOrganizerOrThrow(tenant.id, user.id);

    if (body.organizerId !== organizer.id) {
      throw forbidden('You are not authorized to withdraw for this organizer');
    }

    const request = await paymentsService.requestWithdrawal(
      tenant.id,
      organizer.id,
      body.amount
    );

    return successResponse(c, request, 'Withdrawal request submitted successfully', 201);
  },

  /**
   * Get withdrawal list for organizer
   */
  async getOrganizerWithdrawals(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const organizer = await paymentsController.getOrganizerOrThrow(tenant.id, user.id);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;
    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.tenantId, tenant.id), eq(withdrawalRequests.organizerId, organizer.id)))
      .orderBy(desc(withdrawalRequests.requestedAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Withdrawals history fetched', 200, { page, limit });
  },

  /**
   * Admin APIs
   */
  async getLedgerAccounts(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;
    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenant.id))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Ledger accounts fetched successfully', 200, { page, limit });
  },

  async getLedgerTransactions(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;
    const offset = (page - 1) * limit;

    const txs = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenant.id))
      .orderBy(desc(ledgerTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    const result = [];
    for (const tx of txs) {
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerTransactionId, tx.id));
      result.push({
        ...tx,
        entries
      });
    }

    return successResponse(c, result, 'Ledger transactions fetched successfully', 200, { page, limit });
  },

  async runSettlements(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const result = await paymentsService.processSettlements(tenant.id);
    return successResponse(c, result, 'Settlements run completed successfully', 200);
  },

  async getSettlementReports(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;
    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(settlementRuns)
      .where(eq(settlementRuns.tenantId, tenant.id))
      .orderBy(desc(settlementRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Settlements reports list fetched', 200, { page, limit });
  },

  async getWithdrawalsAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;
    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.tenantId, tenant.id))
      .orderBy(desc(withdrawalRequests.requestedAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Organizer withdrawal requests fetched', 200, { page, limit });
  },

  async processWithdrawalAdmin(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const body = c.get('validatedBody') as any;

    const request = await paymentsService.processWithdrawal(tenant.id, id, body.status, user.id);
    return successResponse(c, request, `Withdrawal request status updated to ${body.status}`, 200);
  },

  async runIntegrityCheck(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const report = await paymentsService.runIntegrityCheck(tenant.id);
    return successResponse(c, report, 'Financial integrity check completed', 200);
  },

  /**
   * Handle incoming public Razorpay Webhooks
   */
  async handleWebhook(c: Context<AppEnv>) {
    const signature = c.req.header('X-Razorpay-Signature') || c.req.header('x-razorpay-signature') || '';
    const rawBody = await c.req.text();

    incrementMetric('razorpay_webhook_total');
    incrementMetric('payment_webhooks_total');

    await cacheService.set('revelis:webhook:last_heartbeat', String(Date.now()));

    const isValid = razorpayClient.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn('[PaymentsController] Webhook validation failure: invalid signature', {
        hasSignature: !!signature
      });
      incrementMetric('razorpay_webhook_failures_total');
      incrementMetric('payment_webhook_failures_total');
      return c.json({ success: false, message: 'Unauthorized: Invalid signature' }, 401);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.error('[PaymentsController] Webhook failed parsing JSON body');
      return c.json({ success: false, message: 'Invalid JSON body' }, 400);
    }

    const eventId = payload.id;
    const eventName = payload.event;
    
    if (!eventId) {
      logger.warn('[PaymentsController] Missing event ID in webhook payload');
      return c.json({ success: false, message: 'Invalid payload: missing id' }, 400);
    }

    logger.info('[PaymentsController] Webhook signature verified, processing event', { event: eventName, eventId });

    const lockKey = `payment:webhook:${eventId}`;
    const lockAcquired = await cacheService.lock(lockKey, 15);
    if (!lockAcquired) {
      // A failed lock is ambiguous: either another worker holds it, or Redis is
      // unavailable (breaker OPEN). We must NOT blindly ACK — that would silently
      // drop a capture on a Redis outage. Consult the durable DB record: ACK only
      // if it is already fully processed; otherwise ask Razorpay to retry.
      const durable = await db
        .select({ status: paymentWebhookEvents.status })
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.razorpayEventId, eventId))
        .limit(1)
        .then((res) => res[0] ?? null)
        .catch(() => null);

      if (durable?.status === 'processed') {
        return c.json({ success: true, duplicated: true }, 200);
      }
      logger.warn('[PaymentsController] Could not acquire webhook lock and event not yet processed; requesting retry', { eventId });
      return c.json({ success: false, message: 'Webhook processing contended, retry later' }, 503);
    }

    try {
      const existingEvent = await db
        .select()
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.razorpayEventId, eventId))
        .limit(1)
        .then((res) => res[0] ?? null);

      if (existingEvent) {
        if (existingEvent.status === 'processed') {
          logger.info('[PaymentsController] Webhook event already processed. Short-circuiting.', { eventId });
          return c.json({ success: true, duplicated: true }, 200);
        }
        if (existingEvent.status === 'pending') {
          logger.info('[PaymentsController] Webhook event is currently processing. Short-circuiting.', { eventId });
          return c.json({ success: true, processing: true }, 200);
        }
      }

      if (existingEvent) {
        await db
          .update(paymentWebhookEvents)
          .set({ status: 'pending', receivedAt: new Date(), processedAt: null })
          .where(eq(paymentWebhookEvents.razorpayEventId, eventId));
      } else {
        await db
          .insert(paymentWebhookEvents)
          .values({
            razorpayEventId: eventId,
            eventType: eventName,
            status: 'pending',
            receivedAt: new Date()
          });
      }

      try {
        switch (eventName) {
          case 'payment.authorized': {
            const payment = payload.payload?.payment?.entity;
            logger.info('[PaymentsController] Webhook: payment.authorized event logged', {
              razorpayPaymentId: payment?.id,
              razorpayOrderId: payment?.order_id,
              amount: payment?.amount
            });
            break;
          }

          case 'payment.captured':
          case 'order.paid': {
            const payment = payload.payload?.payment?.entity;
            const razorpayOrderId = payment?.order_id || payload.payload?.order?.entity?.id;
            const razorpayPaymentId = payment?.id;

            if (!razorpayOrderId || !razorpayPaymentId) {
              logger.warn('[PaymentsController] Missing razorpayOrderId or paymentId in webhook capture event', {
                razorpayOrderId,
                razorpayPaymentId
              });
              break;
            }

            const confirmLockKey = `payment:confirm:${razorpayPaymentId}`;
            const confirmLockAcquired = await cacheService.lock(confirmLockKey, 15);
            if (!confirmLockAcquired) {
              logger.info('[PaymentsController] Webhook: payment confirmation is already in progress via another thread. Skipping.', { razorpayPaymentId });
              break;
            }

            try {
              logger.info('[PaymentsController] Webhook: processing payment confirmation', {
                razorpayOrderId,
                razorpayPaymentId,
                email: maskSensitiveData(payment?.email),
                phone: maskSensitiveData(payment?.contact)
              });

              await paymentsService.confirmPaymentAndOrder(razorpayOrderId, razorpayPaymentId, payment);
            } finally {
              await cacheService.unlock(confirmLockKey);
            }
            break;
          }

          case 'payment.failed': {
            const payment = payload.payload?.payment?.entity;
            const razorpayOrderId = payment?.order_id;
            const razorpayPaymentId = payment?.id;

            if (razorpayOrderId && razorpayPaymentId) {
              logger.error('[PaymentsController] Webhook: payment failure recorded', {
                razorpayOrderId,
                razorpayPaymentId,
                errorCode: payment?.error_code,
                errorDescription: payment?.error_description,
                email: maskSensitiveData(payment?.email),
                phone: maskSensitiveData(payment?.contact)
              });

              await paymentsService.handlePaymentFailure(razorpayOrderId, razorpayPaymentId, payment);
            }
            break;
          }

          case 'refund.created': {
            const refund = payload.payload?.refund?.entity;
            logger.info('[PaymentsController] Webhook: refund.created logged', {
              razorpayRefundId: refund?.id,
              razorpayPaymentId: refund?.payment_id,
              amount: refund?.amount
            });
            break;
          }

          case 'refund.processed': {
            const refund = payload.payload?.refund?.entity;
            logger.info('[PaymentsController] Webhook: refund.processed logged', {
              razorpayRefundId: refund?.id,
              razorpayPaymentId: refund?.payment_id,
              amount: refund?.amount
            });
            break;
          }

          case 'refund.failed': {
            const refund = payload.payload?.refund?.entity;
            logger.error('[PaymentsController] Webhook: refund.failed logged', {
              razorpayRefundId: refund?.id,
              razorpayPaymentId: refund?.payment_id
            });
            break;
          }

          case 'dispute.created': {
            const dispute = payload.payload?.dispute?.entity;
            if (dispute) {
              await paymentsService.handleDisputeCreated(dispute);
            }
            break;
          }

          case 'dispute.under_review': {
            const dispute = payload.payload?.dispute?.entity;
            if (dispute) {
              await paymentsService.handleDisputeUnderReview(dispute);
            }
            break;
          }

          case 'dispute.won': {
            const dispute = payload.payload?.dispute?.entity;
            if (dispute) {
              await paymentsService.handleDisputeWon(dispute);
            }
            break;
          }

          case 'dispute.lost': {
            const dispute = payload.payload?.dispute?.entity;
            if (dispute) {
              await paymentsService.handleDisputeLost(dispute);
            }
            break;
          }

          default:
            logger.info('[PaymentsController] Webhook: unhandled event type received', { event: eventName });
            break;
        }

        await db
          .update(paymentWebhookEvents)
          .set({ status: 'processed', processedAt: new Date() })
          .where(eq(paymentWebhookEvents.razorpayEventId, eventId));

        return c.json({ success: true, received: true }, 200);
      } catch (error: any) {
        logger.error('[PaymentsController] Error processing webhook event', {
          event: eventName,
          error: error.message,
          stack: error.stack
        });

        await db
          .update(paymentWebhookEvents)
          .set({ status: 'failed', processedAt: new Date() })
          .where(eq(paymentWebhookEvents.razorpayEventId, eventId));

        return c.json({ success: false, error: error.message }, 500);
      }
    } finally {
      await cacheService.unlock(lockKey);
    }
  },

  /**
   * Trigger manual reconciliation run (Admin only)
   */
  async runReconciliation(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    logger.info('[PaymentsController] Triggering reconciliation run', { tenantId: tenant.id, userId: user.id });
    const result = await reconciliationService.runReconciliation(tenant.id, user.id);
    return successResponse(c, result, 'Reconciliation run completed successfully', 200);
  },

  /**
   * Get reconciliation discrepancy reports (Admin only)
   */
  async getReconciliationReports(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

    logger.info('[PaymentsController] Fetching reconciliation reports', { tenantId: tenant.id, page, limit });
    const result = await reconciliationRepository.listReports(db, tenant.id, page, limit);
    return successResponse(c, result.items, 'Reconciliation reports fetched successfully', 200, result.meta);
  },

  /**
   * List all refund requests for the tenant (Owner/Admin only).
   * Joins through transaction → order → booking → event/purchaser so the
   * dashboard can show who requested what, for which event, and how much.
   * Optional filter: ?approvalStatus=pending|approved|rejected
   */
  async listRefundsAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;
    const offset = (page - 1) * limit;
    const approvalStatus = c.req.query('approvalStatus');

    const conditions = [eq(paymentRefunds.tenantId, tenant.id)];
    if (approvalStatus) {
      conditions.push(eq(paymentRefunds.approvalStatus, approvalStatus));
    }

    const items = await db
      .select({
        id: paymentRefunds.id,
        amount: paymentRefunds.amount,
        status: paymentRefunds.status,
        approvalStatus: paymentRefunds.approvalStatus,
        reason: paymentRefunds.reason,
        rejectionReason: paymentRefunds.rejectionReason,
        razorpayRefundId: paymentRefunds.razorpayRefundId,
        createdAt: paymentRefunds.createdAt,
        currency: paymentTransactions.currency,
        paymentTransactionId: paymentRefunds.paymentTransactionId,
        bookingOrderId: paymentOrders.bookingOrderId,
        orderNumber: bookingOrders.orderNumber,
        eventId: bookingOrders.eventId,
        eventTitle: events.title,
        purchaserName: users.fullName
      })
      .from(paymentRefunds)
      .innerJoin(paymentTransactions, eq(paymentTransactions.id, paymentRefunds.paymentTransactionId))
      .innerJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
      .innerJoin(bookingOrders, eq(bookingOrders.id, paymentOrders.bookingOrderId))
      .innerJoin(events, eq(events.id, bookingOrders.eventId))
      .innerJoin(users, eq(users.id, bookingOrders.purchaserUserId))
      .where(and(...conditions))
      .orderBy(desc(paymentRefunds.createdAt))
      .limit(limit)
      .offset(offset);

    return successResponse(c, items, 'Refunds fetched successfully', 200, { page, limit });
  },

  async approveRefundAdmin(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    logger.info('[PaymentsController] Approving refund request', { refundId: id, tenantId: tenant.id, userId: user.id });
    const refund = await paymentsService.approveRefundAdmin(tenant.id, id, user.id);
    return successResponse(c, refund, 'Refund request approved and processed successfully', 200);
  },

  async rejectRefundAdmin(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const body = await c.req.json().catch(() => ({}));
    logger.info('[PaymentsController] Rejecting refund request', { refundId: id, tenantId: tenant.id, userId: user.id });
    const refund = await paymentsService.rejectRefundAdmin(tenant.id, id, user.id, body.rejectionReason || body.reason);
    return successResponse(c, refund, 'Refund request rejected successfully', 200);
  },

  async handleWithdrawalCallback(c: Context<AppEnv>) {
    const body = await c.req.json().catch(() => ({}));
    if (!body.gatewayPayoutId || !body.status) {
      throw badRequest('gatewayPayoutId and status are required');
    }
    const request = await paymentsService.handleWithdrawalCallback(
      body.gatewayPayoutId,
      body.status,
      body.errorMessage
    );
    return successResponse(c, request, `Withdrawal callback processed successfully with status ${body.status}`, 200);
  },

  async generateSettlementRun(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const result = await paymentsService.generateSettlementRun(tenant.id);
    return successResponse(c, result, 'Settlement run generated pending approval', 201);
  },

  async approveSettlementRun(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const result = await paymentsService.approveSettlementRun(tenant.id, id, user.id);
    return successResponse(c, result, 'Settlement run approved and processed successfully', 200);
  },

  async rejectSettlementRun(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const result = await paymentsService.rejectSettlementRun(tenant.id, id, user.id);
    return successResponse(c, result, 'Settlement run rejected successfully', 200);
  },

  async listDisputesAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

    const result = await paymentsService.listDisputesAdmin(tenant.id, page, limit);
    return successResponse(c, result.items, 'Disputes fetched successfully', 200, result.meta);
  },

  async getDisputeByIdAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');

    const result = await paymentsService.getDisputeByIdAdmin(tenant.id, id);
    return successResponse(c, result, 'Dispute details fetched successfully', 200);
  },

  async uploadEvidenceAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const body = await c.req.json().catch(() => ({}));

    if (!body.documentUrl || !body.documentType) {
      throw badRequest('documentUrl and documentType are required');
    }

    const evidence = await paymentsService.uploadDisputeEvidence(tenant.id, id, body.documentUrl, body.documentType);
    return successResponse(c, evidence, 'Dispute evidence uploaded successfully', 201);
  },

  async resolveDisputeAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = requireParam(c, 'id');
    const body = await c.req.json().catch(() => ({}));

    if (!body.resolution || !['won', 'lost'].includes(body.resolution)) {
      throw badRequest('resolution must be either "won" or "lost"');
    }

    const dispute = await paymentsService.resolveDisputeAdmin(tenant.id, id, body.resolution);
    return successResponse(c, dispute, `Dispute resolved as ${body.resolution} successfully`, 200);
  },

  async createPromotionAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));

    if (!body.code || !body.type || !body.amount) {
      throw badRequest('code, type, and amount are required');
    }

    const promo = await paymentsService.createPromotion(tenant.id, body.code, body.type, Number(body.amount), body.currency);
    return successResponse(c, promo, 'Promotion code created successfully', 201);
  },

  async listPromotionsAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

    const promos = await paymentsService.listPromotions(tenant.id, page, limit);
    return successResponse(c, promos, 'Promotions fetched successfully', 200);
  },

  async applyPromotionalCreditAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));

    if (!body.customerId || !body.amount || !body.idempotencyKey) {
      throw badRequest('customerId, amount, and idempotencyKey are required');
    }

    const result = await paymentsService.applyPromotionalCredit(tenant.id, body.customerId, Number(body.amount), body.currency, body.idempotencyKey);
    return successResponse(c, result, 'Promotional credit applied successfully', 201);
  },

  async reversePromotionalCreditAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));

    if (!body.customerId || !body.amount || !body.idempotencyKey) {
      throw badRequest('customerId, amount, and idempotencyKey are required');
    }

    const result = await paymentsService.reversePromotionalCredit(tenant.id, body.customerId, Number(body.amount), body.currency, body.idempotencyKey);
    return successResponse(c, result, 'Promotional credit reversed successfully', 201);
  },

  async cancelEventAdmin(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const eventId = requireParam(c, 'eventId');

    const result = await paymentsService.processEventCancellation(tenant.id, eventId, user.id);
    return successResponse(c, result, 'Event cancelled and booking refunds initiated', 200);
  },

  async upgradeBookingAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const bookingOrderId = requireParam(c, 'bookingOrderId');
    const body = await c.req.json().catch(() => ({}));

    if (!body.amountDiff || !body.idempotencyKey) {
      throw badRequest('amountDiff and idempotencyKey are required');
    }

    const result = await paymentsService.processBookingUpgrade(tenant.id, bookingOrderId, Number(body.amountDiff), body.idempotencyKey);
    return successResponse(c, result, 'Booking upgraded and ledger adjusted successfully', 200);
  },

  async downgradeBookingAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const bookingOrderId = requireParam(c, 'bookingOrderId');
    const body = await c.req.json().catch(() => ({}));

    if (!body.amountDiff || !body.idempotencyKey) {
      throw badRequest('amountDiff and idempotencyKey are required');
    }

    const result = await paymentsService.processBookingDowngrade(tenant.id, bookingOrderId, Number(body.amountDiff), body.idempotencyKey);
    return successResponse(c, result, 'Booking downgraded and ledger adjusted successfully', 200);
  },

  async rescheduleBookingAdmin(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const bookingOrderId = requireParam(c, 'bookingOrderId');
    const body = await c.req.json().catch(() => ({}));

    if (body.changeFee === undefined || !body.idempotencyKey) {
      throw badRequest('changeFee and idempotencyKey are required');
    }

    const result = await paymentsService.processBookingReschedule(tenant.id, bookingOrderId, Number(body.changeFee), body.idempotencyKey);
    return successResponse(c, result, 'Booking rescheduled and change fee ledgered successfully', 200);
  }
};
