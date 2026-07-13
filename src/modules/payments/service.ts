import { randomUUID, createHash } from 'node:crypto';
import { and, eq, gte, isNull, sql, desc, inArray, asc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { paymentOrders, paymentTransactions, paymentRefunds, paymentLifecycleEvents, paymentDisputes, paymentDisputeEvidence, promotions } from '../../db/schema/payments.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { bookingOrderItems } from '../../db/schema/booking-order-items.js';
import { inventoryReservations } from '../../db/schema/inventory-reservations.js';
import { inventoryEvents } from '../../db/schema/inventory-events.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';
import { users } from '../../db/schema/users.js';
import { events } from '../../db/schema/events.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import {
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  organizerWallets,
  organizerWalletTransactions,
  withdrawalRequests,
  settlementRuns
} from '../../db/schema/ledger.js';
import { userWallets, userWalletTransactions } from '../../db/schema/user-wallets.js';
import { organizers } from '../organizer-profiles/schema.js';
import { paymentsRepository } from './repository.js';
import { razorpayClient } from '../../lib/razorpay.js';
import { qstashService } from '../../lib/qstash.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { incrementMetric } from '../../lib/metrics.js';
import inventory, { validateReservationStateTransition } from '../inventory/service.js';
import { issueIssuedTicketsForBookingOrder, applyIssuedTicketStatusForBookingOrder } from '../issued-tickets/service.js';
import { getConvenienceFeeBps } from '../platform-admin/settings.service.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { validatePaymentStateTransition } from './state-machine.js';
import type { PaymentState } from './state-machine.js';
import { logPaymentAudit } from './audit.js';
import { cacheService } from '../../lib/cache.js';
import {
  EscrowPostingService,
  SettlementPostingService,
  RefundPostingService,
  WithdrawalPostingService,
  LedgerAuditService,
  FinancialOperationsService,
  LedgerTransactionBuilder
} from '../finance/index.js';
import { FinanceTaxService } from '../finance/tax/service.js';

// Helper to convert decimal string amount to minor units (integer cents/paise)
function toMinorUnits(decimalStr: string | number): number {
  const num = typeof decimalStr === 'number' ? decimalStr : parseFloat(decimalStr);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

// Helper to convert minor units back to decimal string (precision 14, scale 2)
function toDecimalString(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

// Payout abstraction provider interface for future integrations
export interface PayoutProvider {
  createPayout(params: {
    tenantId: string;
    organizerId: string;
    amount: number; // in minor units
    currency: string;
    withdrawalRequestId: string;
  }): Promise<{ success: boolean; gatewayPayoutId?: string; error?: string; }>;
}

export const mockPayoutProvider: PayoutProvider = {
  async createPayout(params) {
    // SAFETY: this provider does NOT move real money. In production it must not
    // report a successful payout unless auto-payouts are explicitly opted into
    // (ALLOW_MOCK_PAYOUTS), otherwise a withdrawal would be marked processed with
    // no funds actually disbursed. When gated off, the caller's transaction fails
    // and the withdrawal must be settled through the manual settlements flow.
    if (env.NODE_ENV === 'production' && !env.ALLOW_MOCK_PAYOUTS) {
      logger.error('[PayoutProvider] Refusing mock payout in production (no real payout provider configured)', {
        withdrawalRequestId: params.withdrawalRequestId
      });
      return {
        success: false,
        error: 'No production payout provider configured. Use the manual settlements flow or set ALLOW_MOCK_PAYOUTS.'
      };
    }
    logger.info('[PayoutProvider] Creating payout via gateway (mock)', params);
    return { success: true, gatewayPayoutId: `pout_${Date.now()}` };
  }
};

export const paymentsService = {
  /**
   * Phase 12.2: Calculate booking amount dynamically on the server
   */
  async calculateBookingAmount(bookingOrderId: string) {
    const order = await db
      .select()
      .from(bookingOrders)
      .where(eq(bookingOrders.id, bookingOrderId))
      .limit(1)
      .then((res) => res[0] ?? null);

    if (!order) {
      throw notFound('Booking order not found');
    }

    const items = await db
      .select()
      .from(bookingOrderItems)
      .where(eq(bookingOrderItems.bookingOrderId, bookingOrderId));

    let subtotalMinor = 0;
    for (const item of items) {
      subtotalMinor += toMinorUnits(item.unitPrice) * item.quantity;
    }

    // Platform-wide convenience fee set by the superadmin (default 9%). It is the
    // EXACT percentage charged on every booking — the same rate across all
    // transactions, applied to the ticket subtotal.
    const convenienceFeeBps = await getConvenienceFeeBps();
    const convenienceFeeMinor = FinanceTaxService.calculateByBps(subtotalMinor, convenienceFeeBps);

    // Discount
    const discountMinor = toMinorUnits(order.discountAmount);

    // Total payable = tickets + convenience fee − discount.
    const totalMinor = subtotalMinor + convenienceFeeMinor - discountMinor;

    if (totalMinor < 0) {
      throw badRequest('Discount amount exceeds the total order amount');
    }

    const newSubtotal = toDecimalString(subtotalMinor);
    // taxAmount carries the convenience fee (the platform's collected fee line).
    const newTax = toDecimalString(convenienceFeeMinor);
    const newTotal = toDecimalString(totalMinor);

    // Update booking order in the database
    await db
      .update(bookingOrders)
      .set({
        subtotalAmount: newSubtotal,
        taxAmount: newTax,
        totalAmount: newTotal,
        metadata: {
          ...((order.metadata as Record<string, any>) ?? {}),
          convenienceFee: toDecimalString(convenienceFeeMinor),
          convenienceFeeBps,
          ticketPrice: newSubtotal
        },
        updatedAt: new Date()
      })
      .where(eq(bookingOrders.id, bookingOrderId));

    return {
      ticketPrice: newSubtotal,
      convenienceFee: toDecimalString(convenienceFeeMinor),
      convenienceFeeBps,
      tax: toDecimalString(0),
      discount: order.discountAmount,
      finalPayableAmount: newTotal
    };
  },

  /**
   * Helper to write balanced double-entry transactions
   */
  async postLedgerTransaction(
    tx: any,
    params: {
      tenantId: string;
      transactionType: string;
      amount: number;
      currency: string;
      referenceType: string;
      referenceId: string;
      entries: Array<{
        accountId: string;
        amount: number;
        direction: 'debit' | 'credit';
        metadata?: any;
      }>;
    }
  ) {
    const connection = tx || db;

    let debitSum = 0;
    let creditSum = 0;
    for (const entry of params.entries) {
      if (entry.direction === 'debit') {
        debitSum += entry.amount;
      } else if (entry.direction === 'credit') {
        creditSum += entry.amount;
      }
    }

    if (debitSum !== creditSum) {
      throw new Error(`Unbalanced ledger transaction: debits (${debitSum}) must equal credits (${creditSum})`);
    }

    const ledgerTx = await paymentsRepository.createLedgerTransaction(connection, {
      tenantId: params.tenantId,
      transactionType: params.transactionType,
      amount: toDecimalString(params.amount),
      currency: params.currency,
      referenceType: params.referenceType,
      referenceId: params.referenceId
    });

    await paymentsRepository.createLedgerEntries(
      connection,
      params.entries.map((e) => ({
        tenantId: params.tenantId,
        accountId: e.accountId,
        ledgerTransactionId: ledgerTx.id,
        amount: toDecimalString(e.amount),
        direction: e.direction,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        metadata: e.metadata
      }))
    );

    incrementMetric('ledger_transactions_total');
    return ledgerTx;
  },

  /**
   * Create Razorpay order and persist payment_order
   */
  async createPaymentOrder(tenantId: string, actorUserId: string, bookingOrderId: string) {
    logger.info('[PaymentsService] Initiating order creation', { bookingOrderId, tenantId });

    const order = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)))
      .limit(1)
      .then((res) => res[0] ?? null);

    if (!order) {
      throw notFound('Booking order not found');
    }

    if (order.status !== 'pending' && order.status !== 'draft') {
      throw badRequest(`Invalid booking order status: ${order.status}. Order must be pending or draft.`);
    }

    const activeReservations = await db
      .select()
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.tenantId, tenantId),
          eq(inventoryReservations.bookingOrderId, bookingOrderId),
          inArray(inventoryReservations.status, [
            'active',
            'created',
            'locking_inventory',
            'reserved',
            'payment_pending',
            'payment_started',
            'payment_processing',
            'payment_verified',
            'converting'
          ]),
          isNull(inventoryReservations.deletedAt),
          isNull(inventoryReservations.convertedAt),
          isNull(inventoryReservations.releasedAt),
          gte(inventoryReservations.expiresAt, new Date())
        )
      );

    if (activeReservations.length === 0) {
      throw badRequest('Booking order does not have any active inventory reservations or they have expired');
    }

    const reservationIds = activeReservations.map(r => r.id).join(',');
    const reservationTokens = activeReservations.map(r => r.reservationToken).join(',');

    // Server calculates amount dynamically and updates the order first
    const calculated = await this.calculateBookingAmount(bookingOrderId);
    const amountInMinor = toMinorUnits(calculated.finalPayableAmount);

    if (amountInMinor <= 0) {
      throw badRequest('Booking order total amount must be greater than zero');
    }

    const event = await db
      .select()
      .from(events)
      .where(eq(events.id, order.eventId))
      .limit(1)
      .then((res) => res[0] ?? null);

    const purchaser = await db
      .select({ email: authAccounts.email, phone: users.phoneNumber, fullName: users.fullName })
      .from(authAccounts)
      .innerJoin(users, eq(users.id, authAccounts.userId))
      .where(eq(authAccounts.userId, actorUserId))
      .limit(1)
      .then((res) => res[0] ?? null);

    const activeKeyId = razorpayClient.getKeyId();

    const buildPayload = (rzpOrderId: string, amt: number, curr: string) => {
      return {
        // CamelCase properties
        orderId: rzpOrderId,
        amount: amt,
        currency: curr,
        bookingId: bookingOrderId,
        notes: {
          bookingOrderId: bookingOrderId,
          eventTitle: event?.title || 'Event Booking',
          reservationIds,
          reservationTokens
        },
        keyId: activeKeyId,

        // Snake_case properties for compatibility
        razorpay_order_id: rzpOrderId,
        order_id: rzpOrderId,
        booking_id: bookingOrderId,
        key_id: activeKeyId,
        key: activeKeyId,
        name: event?.title || 'Revelis',
        description: event?.shortDescription || 'Ticket Booking',
        prefill: {
          name: purchaser?.fullName || '',
          email: purchaser?.email || '',
          contact: purchaser?.phone || ''
        },
        theme: {
          color: '#3182ce'
        }
      };
    };

    const existingPaymentOrder = await db
      .select()
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.tenantId, tenantId),
          eq(paymentOrders.bookingOrderId, bookingOrderId),
          eq(paymentOrders.status, 'pending')
        )
      )
      .limit(1)
      .then((res) => res[0] ?? null);

    if (existingPaymentOrder) {
      logger.info('[PaymentsService] Retrying payment order. Returning existing Razorpay order details.', {
        razorpayOrderId: existingPaymentOrder.razorpayOrderId
      });
      await db
        .update(paymentOrders)
        .set({
          retryCount: existingPaymentOrder.retryCount + 1,
          updatedAt: new Date()
        })
        .where(eq(paymentOrders.id, existingPaymentOrder.id));

      await this.logPaymentLifecycleEvent(db, {
        tenantId,
        paymentOrderId: existingPaymentOrder.id,
        entityType: 'payment_order',
        entityId: existingPaymentOrder.id,
        eventType: 'payment_order.retried',
        fromStatus: 'pending',
        toStatus: 'pending',
        actorId: actorUserId,
        metadata: { retryCount: existingPaymentOrder.retryCount + 1 }
      });

      incrementMetric('payments_created_total');
      return buildPayload(
        existingPaymentOrder.razorpayOrderId,
        toMinorUnits(existingPaymentOrder.amount),
        existingPaymentOrder.currency
      );
    }

    const rzpOrder = await razorpayClient.createOrder({
      amount: amountInMinor,
      currency: order.currency,
      receipt: order.id
    });

    if (!rzpOrder.id || !rzpOrder.id.startsWith('order_')) {
      throw badRequest(`Invalid Razorpay Order ID returned: ${rzpOrder.id}`);
    }

    const paymentOrderRecord = await paymentsRepository.createPaymentOrder(db, {
      tenantId,
      bookingOrderId: order.id,
      razorpayOrderId: rzpOrder.id,
      amount: calculated.finalPayableAmount,
      currency: order.currency,
      status: 'pending',
      createdBy: actorUserId
    });

    await this.logPaymentLifecycleEvent(db, {
      tenantId,
      paymentOrderId: paymentOrderRecord.id,
      entityType: 'payment_order',
      entityId: paymentOrderRecord.id,
      eventType: 'payment_order.created',
      fromStatus: null,
      toStatus: 'pending',
      actorId: actorUserId,
      metadata: { razorpayOrderId: rzpOrder.id }
    });

    await logPaymentAudit(db, {
      actorId: actorUserId,
      tenantId,
      entityType: 'payment_order',
      entityId: paymentOrderRecord.id,
      action: 'create',
      afterState: { status: 'pending' },
      metadata: { razorpayOrderId: rzpOrder.id }
    });

    incrementMetric('payments_created_total');

    return buildPayload(rzpOrder.id, amountInMinor, order.currency);
  },

  /**
   * Capture authorized Razorpay payment manually (if needed)
   */
  async capturePayment(tenantId: string, actorUserId: string, razorpayPaymentId: string, amount: number, currency: string) {
    logger.info('[PaymentsService] Capturing payment manually', { razorpayPaymentId, amount });
    
    const rzpResponse = await razorpayClient.capturePayment(razorpayPaymentId, amount, currency);
    
    const rzpOrderId = rzpResponse.order_id;
    if (!rzpOrderId) {
      throw badRequest('Payment does not have an associated order_id');
    }

    const paymentOrder = await paymentsRepository.findPaymentOrderByRazorpayOrderId(db, rzpOrderId);
    if (!paymentOrder || paymentOrder.tenantId !== tenantId) {
      throw notFound('Associated payment order not found');
    }

    await this.confirmPaymentAndOrder(paymentOrder.razorpayOrderId, razorpayPaymentId, rzpResponse);

    return rzpResponse;
  },

  /**
   * Confirm payment, finalize inventory, allocate tickets, and post double-entry ledger entries
   */
  async confirmPaymentAndOrder(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    gatewayResponse: any,
    options?: { lockAcquired?: boolean; reservationId?: string; reservationToken?: string }
  ) {
    const startTime = Date.now();
    logger.info('[PaymentsService] Webhook/Capture processing confirmation', { razorpayOrderId, razorpayPaymentId });

    await cacheService.set('revelis:payment:last_heartbeat', String(Date.now()));

    const paymentOrder = await paymentsRepository.findPaymentOrderByRazorpayOrderId(db, razorpayOrderId);
    if (!paymentOrder) {
      logger.error('[PaymentsService] Payment order lookup failed for Razorpay Order ID', { razorpayOrderId });
      throw notFound('Payment order not found');
    }

    const tenantId = paymentOrder.tenantId;
    const bookingOrderId = paymentOrder.bookingOrderId;

    const existingTx = await paymentsRepository.findPaymentTransactionByRazorpayPaymentId(db, razorpayPaymentId);
    if (existingTx && existingTx.status === 'captured') {
      logger.info('[PaymentsService] Payment transaction already captured. Skipping confirmation.', { razorpayPaymentId });
      return;
    }

    const lockKey = `payment:confirm:${razorpayPaymentId}`;
    let lockAcquiredInternally = false;
    if (!options?.lockAcquired) {
      const lockAcquired = await cacheService.lock(lockKey, 15);
      if (!lockAcquired) {
        throw badRequest('Payment verification is already in progress');
      }
      lockAcquiredInternally = true;
    }

    try {
      const systemMembership: TenantMembershipRecord = {
        id: '00000000-0000-0000-0000-000000000000',
        tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        role: 'owner',
        invitedByUserId: null,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      let latePaymentInfo: {
        isLatePayment: boolean;
        refundRecordId: string;
        paymentTransactionId: string;
        amountMinor: number;
        razorpayPaymentId: string;
      } | null = null;

      await db.transaction(async (tx) => {
        const [bookingOrder] = await tx
          .select()
          .from(bookingOrders)
          .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId)))
          .for('update');

        if (!bookingOrder) {
          throw notFound('Booking order not found within transaction');
        }

        const reservations = await tx
          .select()
          .from(inventoryReservations)
          .where(and(eq(inventoryReservations.bookingOrderId, bookingOrderId), eq(inventoryReservations.tenantId, tenantId)))
          .orderBy(asc(inventoryReservations.id))
          .for('update');

        if (reservations.length === 0) {
          throw notFound('No inventory reservations found for this booking order');
        }

        // Cryptographic token verification:
        const suppliedId = options?.reservationId || gatewayResponse?.notes?.reservationId || gatewayResponse?.notes?.reservationIds;
        const suppliedToken = options?.reservationToken || gatewayResponse?.notes?.reservationToken || gatewayResponse?.notes?.reservationTokens;

        if (!suppliedId || !suppliedToken) {
          throw badRequest('Cryptographic token verification failed: reservationId and reservationToken must be supplied');
        }

        const suppliedIds = String(suppliedId).split(',').map(s => s.trim());
        const suppliedTokens = String(suppliedToken).split(',').map(s => s.trim());

        for (const res of reservations) {
          const idIndex = suppliedIds.indexOf(res.id);
          if (idIndex === -1) {
            throw forbidden(`Cryptographic token verification failed: reservation ID ${res.id} not in payload`);
          }
          if (suppliedTokens[idIndex] !== res.reservationToken) {
            throw forbidden(`Cryptographic token verification failed: reservation token mismatch for ID ${res.id}`);
          }
        }

        // Ownership and Match validations
        for (const res of reservations) {
          if (res.tenantId !== tenantId) {
            throw forbidden('Tenant mismatch on reservation');
          }
          if (res.eventId !== bookingOrder.eventId) {
            throw forbidden('Event mismatch on reservation');
          }
          if (res.createdByUserId && res.createdByUserId !== paymentOrder.createdBy) {
            throw forbidden('Ownership mismatch on reservation');
          }
        }

        // Expiry / Late Payment Detection
        let isLatePayment = false;
        const now = new Date();
        for (const res of reservations) {
          if (res.status === 'expired' || res.expiresAt <= now) {
            isLatePayment = true;
          } else if (['cancelled', 'released', 'failed', 'force_released', 'refund_pending', 'refunded'].includes(res.status)) {
            throw conflict(`Reservation is in terminal/invalid state: ${res.status}`);
          }
        }

        if (isLatePayment) {
          // LATE PAYMENT FLOW
          logger.warn('[PaymentsService] Late payment detected. Executing refund path.', { bookingOrderId, razorpayPaymentId });

          // Update booking order status
          await tx
            .update(bookingOrders)
            .set({
              status: 'expired',
              updatedAt: now
            })
            .where(eq(bookingOrders.id, bookingOrderId));

          // Transition reservations
          for (const res of reservations) {
            const initialStatus = res.status;
            if (res.status !== 'expired') {
              if (!validateReservationStateTransition(res.status, 'expired')) {
                throw conflict(`Invalid transition from ${res.status} to expired`);
              }
              await tx
                .update(inventoryReservations)
                .set({
                  status: 'expired',
                  releasedAt: now,
                  updatedAt: now,
                  version: sql`${inventoryReservations.version} + 1`
                })
                .where(eq(inventoryReservations.id, res.id));

              await tx.insert(inventoryEvents).values({
                tenantId,
                eventId: res.eventId,
                ticketTypeId: res.ticketTypeId,
                reservationId: res.id,
                bookingOrderId,
                eventType: 'reservation_expired',
                actorUserId: paymentOrder.createdBy,
                source: 'confirm_payment_order_late',
                previousValues: { status: initialStatus },
                newValues: { status: 'expired', releasedAt: now },
                metadata: {}
              });
            }

            // Transition from expired to refund_pending
            if (!validateReservationStateTransition('expired', 'refund_pending')) {
              throw conflict(`Invalid transition from expired to refund_pending`);
            }
            await tx
              .update(inventoryReservations)
              .set({
                status: 'refund_pending',
                updatedAt: now,
                version: sql`${inventoryReservations.version} + 1`
              })
              .where(eq(inventoryReservations.id, res.id));
          }

          // Create captured payment transaction (even though late, payment is captured)
          validatePaymentStateTransition(paymentOrder.status as PaymentState, 'captured');
          await paymentsRepository.updatePaymentOrderStatus(tx, tenantId, paymentOrder.id, 'captured');

          const txRecord = await paymentsRepository.createPaymentTransaction(tx, {
            tenantId,
            paymentOrderId: paymentOrder.id,
            razorpayPaymentId,
            amount: paymentOrder.amount,
            currency: paymentOrder.currency,
            status: 'captured',
            gatewayResponse: gatewayResponse ?? {}
          });

          await this.logPaymentLifecycleEvent(tx, {
            tenantId,
            paymentOrderId: paymentOrder.id,
            paymentTransactionId: txRecord.id,
            entityType: 'payment_order',
            entityId: paymentOrder.id,
            eventType: 'payment_order.captured',
            fromStatus: paymentOrder.status,
            toStatus: 'captured',
            metadata: { razorpayPaymentId, razorpayOrderId, note: 'late_payment_captured' }
          });

          // Generate dummy/temp refund ID, status pending
          const pendingRefundId = `rfnd_pending_${randomUUID().replace(/-/g, '')}`;
          const refundRecord = await paymentsRepository.createPaymentRefund(tx, {
            tenantId,
            paymentTransactionId: txRecord.id,
            razorpayRefundId: pendingRefundId,
            amount: paymentOrder.amount,
            status: 'pending',
            reason: 'Late payment auto-refund'
          });

          await this.logPaymentLifecycleEvent(tx, {
            tenantId,
            paymentOrderId: paymentOrder.id,
            paymentRefundId: refundRecord.id,
            entityType: 'payment_refund',
            entityId: refundRecord.id,
            eventType: 'refund.created',
            fromStatus: 'captured',
            toStatus: 'refund_pending',
            actorId: paymentOrder.createdBy,
            metadata: { note: 'late_payment_refund_created' }
          });

          // Credit & Debit Organizer Wallet
          const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, bookingOrder.eventId))
            .limit(1);

          if (event && event.organizerId) {
            let wallet = await paymentsRepository.findOrganizerWallet(tx, tenantId, event.organizerId);
            if (!wallet) {
              wallet = await paymentsRepository.createOrganizerWallet(tx, { tenantId, organizerId: event.organizerId });
            }

            const amountMinor = toMinorUnits(paymentOrder.amount);
            const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
            const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
            const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
            const netOrganizerRevenueMinor = amountMinor - platformFeeMinor - taxMinor;

            const walletLocked = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, event.organizerId);
            if (walletLocked) {
              let currentPending = toMinorUnits(walletLocked.pendingBalance);
              currentPending += netOrganizerRevenueMinor; // credit
              currentPending -= netOrganizerRevenueMinor; // debit immediate reversal

              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                walletLocked.id,
                walletLocked.availableBalance,
                toDecimalString(currentPending),
                walletLocked.withdrawnBalance
              );

              // Credit Wallet Transaction
              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: walletLocked.id,
                type: 'credit',
                status: 'pending',
                amount: toDecimalString(netOrganizerRevenueMinor),
                currency: bookingOrder.currency,
                referenceType: 'booking_order',
                referenceId: bookingOrderId,
                description: `Pending revenue for booking ${bookingOrder.orderNumber}`
              });

              // Reversal Debit Wallet Transaction
              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: walletLocked.id,
                type: 'debit',
                status: 'failed',
                amount: toDecimalString(netOrganizerRevenueMinor),
                currency: bookingOrder.currency,
                referenceType: 'payment_refund',
                referenceId: refundRecord.id,
                description: `Pending revenue cancellation due to late payment refund of booking ${bookingOrder.orderNumber}`
              });
            }
          }

          // Ledger postings
          const amountMinor = toMinorUnits(paymentOrder.amount);
          await EscrowPostingService.postPaymentCapture({
            tenantId,
            bookingId: bookingOrderId,
            paymentId: txRecord.id,
            amount: amountMinor,
            currency: paymentOrder.currency,
            idempotencyKey: `capture:${txRecord.id}`,
            userId: paymentOrder.createdBy
          }, tx);

          await RefundPostingService.postRefund({
            tenantId,
            refundId: refundRecord.id,
            refundAmount: amountMinor,
            isSettled: false,
            idempotencyKey: `refund:${refundRecord.id}`,
            userId: paymentOrder.createdBy
          }, tx);

          await logPaymentAudit(tx, {
            actorId: paymentOrder.createdBy,
            tenantId,
            entityType: 'payment_order',
            entityId: paymentOrder.id,
            action: 'capture',
            beforeState: { status: paymentOrder.status },
            afterState: { status: 'captured' },
            metadata: { razorpayPaymentId, razorpayOrderId, note: 'late_payment_flow' }
          });

          latePaymentInfo = {
            isLatePayment: true,
            refundRecordId: refundRecord.id,
            paymentTransactionId: txRecord.id,
            amountMinor,
            razorpayPaymentId
          };
        } else {
          // NORMAL CONFIRMATION FLOW
          for (const res of reservations) {
            if (!validateReservationStateTransition(res.status, 'converting')) {
              throw conflict(`Invalid transition from ${res.status} to converting`);
            }
            if (!validateReservationStateTransition('converting', 'booked')) {
              throw conflict(`Invalid transition from converting to booked`);
            }

            await tx
              .update(inventoryReservations)
              .set({
                status: 'booked',
                convertedAt: now,
                updatedAt: now,
                version: sql`${inventoryReservations.version} + 1`
              })
              .where(eq(inventoryReservations.id, res.id));

            // Sync cached inventory counters: a converted reservation is no longer
            // "reserved" — it is "sold". Without this the cached reserved_quantity
            // climbs monotonically (booked reservations never expire) until it trips
            // the reserved<=total CHECK and produces false "sold out" 409s.
            await tx
              .update(ticketTypes)
              .set({
                reservedQuantity: sql`GREATEST(0, ${ticketTypes.reservedQuantity} - ${res.quantity})`,
                soldQuantity: sql`${ticketTypes.soldQuantity} + ${res.quantity}`,
                updatedAt: now
              })
              .where(and(eq(ticketTypes.id, res.ticketTypeId), eq(ticketTypes.tenantId, tenantId)));

            await tx.insert(inventoryEvents).values({
              tenantId,
              eventId: res.eventId,
              ticketTypeId: res.ticketTypeId,
              reservationId: res.id,
              bookingOrderId,
              eventType: 'reservation_converted',
              actorUserId: paymentOrder.createdBy,
              source: 'confirm_payment_order',
              previousValues: { status: res.status },
              newValues: { status: 'booked', convertedAt: now },
              metadata: {}
            });
          }

          if (bookingOrder.status !== 'confirmed' && bookingOrder.status !== 'paid' && bookingOrder.status !== 'completed') {
            await tx
              .update(bookingOrders)
              .set({
                status: 'paid',
                confirmedAt: bookingOrder.confirmedAt ?? now,
                updatedAt: now
              })
              .where(eq(bookingOrders.id, bookingOrderId));

            await issueIssuedTicketsForBookingOrder(tx, tenantId, bookingOrderId, systemMembership);
          }

          validatePaymentStateTransition(paymentOrder.status as PaymentState, 'captured');
          await paymentsRepository.updatePaymentOrderStatus(tx, tenantId, paymentOrder.id, 'captured');

          // Generate invoice PDF
          try {
            const { storageService } = await import('../../lib/storage.js');
            const mockInvoice = `INVOICE: ORDER=${paymentOrder.razorpayOrderId}, AMOUNT=${paymentOrder.amount}, DATE=${new Date().toISOString()}`;
            await storageService.uploadSystemAsset(
              tenantId,
              paymentOrder.id,
              'payments',
              `invoice-${paymentOrder.id}.pdf`,
              Buffer.from(mockInvoice),
              'application/pdf'
            );
          } catch (invoiceErr: any) {
            logger.error('[PaymentsService] Failed to generate invoice PDF', { error: invoiceErr.message });
          }

          const txRecord = await paymentsRepository.createPaymentTransaction(tx, {
            tenantId,
            paymentOrderId: paymentOrder.id,
            razorpayPaymentId,
            amount: paymentOrder.amount,
            currency: paymentOrder.currency,
            status: 'captured',
            gatewayResponse: gatewayResponse ?? {}
          });

          await this.logPaymentLifecycleEvent(tx, {
            tenantId,
            paymentOrderId: paymentOrder.id,
            paymentTransactionId: txRecord.id,
            entityType: 'payment_order',
            entityId: paymentOrder.id,
            eventType: 'payment_order.captured',
            fromStatus: paymentOrder.status,
            toStatus: 'captured',
            metadata: { razorpayPaymentId, razorpayOrderId }
          });

          // Post capture ledger entries
          const amountMinor = toMinorUnits(paymentOrder.amount);
          await EscrowPostingService.postPaymentCapture({
            tenantId,
            bookingId: bookingOrderId,
            paymentId: txRecord.id,
            amount: amountMinor,
            currency: paymentOrder.currency,
            idempotencyKey: `capture:${txRecord.id}`,
            userId: paymentOrder.createdBy
          }, tx);

          // Wallet Staging
          const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, bookingOrder.eventId))
            .limit(1);

          if (event && event.organizerId) {
            let wallet = await paymentsRepository.findOrganizerWallet(tx, tenantId, event.organizerId);
            if (!wallet) {
              wallet = await paymentsRepository.createOrganizerWallet(tx, { tenantId, organizerId: event.organizerId });
            }

            const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
            const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
            const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
            const netOrganizerRevenueMinor = amountMinor - platformFeeMinor - taxMinor;

            const walletLocked = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, event.organizerId);
            if (walletLocked) {
              const newPending = toMinorUnits(walletLocked.pendingBalance) + netOrganizerRevenueMinor;
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                walletLocked.id,
                walletLocked.availableBalance,
                toDecimalString(newPending),
                walletLocked.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: walletLocked.id,
                type: 'credit',
                status: 'pending',
                amount: toDecimalString(netOrganizerRevenueMinor),
                currency: bookingOrder.currency,
                referenceType: 'booking_order',
                referenceId: bookingOrderId,
                description: `Pending revenue for booking ${bookingOrder.orderNumber}`
              });
            }
          }

          await logPaymentAudit(tx, {
            actorId: paymentOrder.createdBy,
            tenantId,
            entityType: 'payment_order',
            entityId: paymentOrder.id,
            action: 'capture',
            beforeState: { status: paymentOrder.status },
            afterState: { status: 'captured' },
            metadata: { razorpayPaymentId, razorpayOrderId }
          });
        }
      });

      // OUTSIDE DATABASE TRANSACTION: Late Payment Refund Action
      const lpInfo = latePaymentInfo as {
        isLatePayment: boolean;
        refundRecordId: string;
        paymentTransactionId: string;
        amountMinor: number;
        razorpayPaymentId: string;
      } | null;
      if (lpInfo) {
        try {
          const rzpRefund = await razorpayClient.refundPayment({
            payment_id: lpInfo.razorpayPaymentId,
            amount: lpInfo.amountMinor,
            notes: {
              reason: 'Late payment auto-refund',
              initiatedBy: 'system'
            }
          });

          if (rzpRefund.id && rzpRefund.id.startsWith('rfnd_')) {
            // Update refund record
            await db
              .update(paymentRefunds)
              .set({
                razorpayRefundId: rzpRefund.id,
                status: 'processed',
                providerState: rzpRefund
              })
              .where(eq(paymentRefunds.id, lpInfo.refundRecordId));

            // Update reservations status
            await db
              .update(inventoryReservations)
              .set({
                status: 'refunded',
                updatedAt: new Date()
              })
              .where(and(eq(inventoryReservations.bookingOrderId, bookingOrderId), eq(inventoryReservations.tenantId, tenantId)));

            // Update payment order status
            await paymentsRepository.updatePaymentOrderStatus(db, tenantId, paymentOrder.id, 'refunded');

            incrementMetric('late_payment_refunds_total');
          } else {
            throw new Error(`Invalid refund response from Razorpay: ${JSON.stringify(rzpRefund)}`);
          }
        } catch (err: any) {
          logger.error('[PaymentsService] Razorpay auto-refund API call failed for late payment', {
            error: err.message,
            bookingOrderId,
            paymentOrderId: paymentOrder.id
          });

          await db
            .update(paymentRefunds)
            .set({
              status: 'failed',
              reason: `Auto-refund api failed: ${err.message}`
            })
            .where(eq(paymentRefunds.id, lpInfo.refundRecordId));

          await db
             .update(inventoryReservations)
             .set({
               status: 'failed',
               updatedAt: new Date()
             })
             .where(and(eq(inventoryReservations.bookingOrderId, bookingOrderId), eq(inventoryReservations.tenantId, tenantId)));
        }
      }

      incrementMetric('payments_success_total');
      incrementMetric('payments_captured_total');

      const duration = Date.now() - startTime;
      db.execute(sql`SELECT 1`);
      incrementMetric('payment_processing_duration_ms', duration);

      const [purchaser] = await db
        .select({ email: authAccounts.email, phone: users.phoneNumber })
        .from(authAccounts)
        .innerJoin(users, eq(users.id, authAccounts.userId))
        .where(eq(authAccounts.userId, paymentOrder.createdBy))
        .limit(1);

      const email = purchaser?.email || '';
      const phone = purchaser?.phone || '';

      const qstashJobs = [
        { jobType: 'booking_email', data: { bookingOrderId, tenantId, email } },
        { jobType: 'booking_sms', data: { bookingOrderId, tenantId, phone } },
        { jobType: 'receipt_generation', data: { bookingOrderId, tenantId, paymentOrderId: paymentOrder.id } },
        { jobType: 'invoice_generation', data: { bookingOrderId, tenantId, paymentOrderId: paymentOrder.id } },
        { jobType: 'analytics_aggregation', data: { bookingOrderId, tenantId, amount: paymentOrder.amount } },
        { jobType: 'marketing_events', data: { bookingOrderId, tenantId, email, userId: paymentOrder.createdBy } }
      ];

      const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
      for (const job of qstashJobs) {
        qstashService.publish(targetUrl, job).catch((err) => {
          logger.error('[PaymentsService] Failed to publish background job to QStash', { jobType: job.jobType, error: err.message });
        });
      }

      logger.info('[PaymentsService] Payment and booking order confirmed successfully', { bookingOrderId, razorpayPaymentId });
    } finally {
      if (lockAcquiredInternally) {
        await cacheService.unlock(lockKey);
      }
    }
  },

  /**
   * Record payment failures
   */
  async handlePaymentFailure(razorpayOrderId: string, razorpayPaymentId: string, gatewayResponse: any) {
    logger.info('[PaymentsService] Handling payment failure webhook event', { razorpayOrderId, razorpayPaymentId });
    
    await cacheService.set('revelis:payment:last_heartbeat', String(Date.now()));

    const paymentOrder = await paymentsRepository.findPaymentOrderByRazorpayOrderId(db, razorpayOrderId);
    if (!paymentOrder) {
      logger.warn('[PaymentsService] Associated payment order not found for failed payment lookup', { razorpayOrderId });
      return;
    }

    const tenantId = paymentOrder.tenantId;

    await db.transaction(async (tx) => {
      validatePaymentStateTransition(paymentOrder.status as PaymentState, 'failed');

      await paymentsRepository.updatePaymentOrderStatus(tx, tenantId, paymentOrder.id, 'failed');

      const txRecord = await paymentsRepository.createPaymentTransaction(tx, {
        tenantId,
        paymentOrderId: paymentOrder.id,
        razorpayPaymentId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        status: 'failed',
        gatewayResponse: gatewayResponse ?? {}
      });

      await this.logPaymentLifecycleEvent(tx, {
        tenantId,
        paymentOrderId: paymentOrder.id,
        paymentTransactionId: txRecord.id,
        entityType: 'payment_order',
        entityId: paymentOrder.id,
        eventType: 'payment_order.failed',
        fromStatus: paymentOrder.status,
        toStatus: 'failed',
        metadata: { razorpayPaymentId, razorpayOrderId }
      });

      await logPaymentAudit(tx, {
        actorId: paymentOrder.createdBy,
        tenantId,
        entityType: 'payment_order',
        entityId: paymentOrder.id,
        action: 'capture',
        beforeState: { status: paymentOrder.status },
        afterState: { status: 'failed' },
        metadata: { razorpayPaymentId, razorpayOrderId }
      });

      const [bookingOrder] = await tx
        .select({ status: bookingOrders.status })
        .from(bookingOrders)
        .where(eq(bookingOrders.id, paymentOrder.bookingOrderId));

      if (bookingOrder && bookingOrder.status !== 'confirmed' && bookingOrder.status !== 'paid' && bookingOrder.status !== 'completed') {
        await tx
          .update(bookingOrders)
          .set({
            status: 'cancelled',
            cancellationReason: 'Payment failed or declined',
            cancelledAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(bookingOrders.id, paymentOrder.bookingOrderId));

        await inventory.releaseReservationsForBookingOrder(tx, {
          tenantId,
          bookingOrderId: paymentOrder.bookingOrderId,
          actorUserId: paymentOrder.createdBy,
          source: 'payment_failed_release'
        });
      }
    });

    try {
      const [purchaser] = await db
        .select({
          email: authAccounts.email
        })
        .from(authAccounts)
        .where(eq(authAccounts.userId, paymentOrder.createdBy))
        .limit(1);

      if (purchaser?.email) {
        const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
        const job = {
          jobType: 'payment_failed_email',
          data: {
            bookingOrderId: paymentOrder.bookingOrderId,
            tenantId,
            email: purchaser.email,
            reason: gatewayResponse?.error_description || 'Transaction declined by bank'
          }
        };
        qstashService.publish(targetUrl, job).catch((err) => {
          logger.error('[PaymentsService] Failed to publish payment failed email job to QStash', { error: err.message });
        });
      }
    } catch (err: any) {
      logger.error('[PaymentsService] Failed to lookup user for failed payment email dispatch', { error: err.message });
    }

    incrementMetric('payments_failed_total');
  },

  /**
   * Process refund, adjust ledger balances and organizer wallet
   */
  async refundPayment(tenantId: string, actorUserId: string, paymentTransactionId: string, amount?: number, reason?: string) {
    // Serialize all refund attempts for a given transaction so two concurrent
    // requests cannot both pass the "remaining refundable" check and issue two
    // real gateway refunds before either records its DB row (double-refund race).
    const refundLockKey = `refund:tx:${paymentTransactionId}`;
    const gotLock = await cacheService.lock(refundLockKey, 30);
    if (!gotLock) {
      throw conflict('A refund for this transaction is already in progress');
    }
    try {
      return await this._refundPaymentLocked(tenantId, actorUserId, paymentTransactionId, amount, reason);
    } finally {
      await cacheService.unlock(refundLockKey).catch(() => {});
    }
  },

  async _refundPaymentLocked(tenantId: string, actorUserId: string, paymentTransactionId: string, amount?: number, reason?: string) {
    logger.info('[PaymentsService] Initiating refund request', { paymentTransactionId, amount, reason });

    incrementMetric('refund_attempts_total');
    await cacheService.set('revelis:payment:last_heartbeat', String(Date.now()));

    const transaction = await paymentsRepository.findPaymentTransactionById(db, tenantId, paymentTransactionId);
    if (!transaction) {
      throw notFound('Payment transaction not found');
    }

    if (transaction.status !== 'captured') {
      throw badRequest('Only captured payment transactions can be refunded');
    }

    const paymentOrder = await paymentsRepository.findPaymentOrderById(db, tenantId, transaction.paymentOrderId);
    if (!paymentOrder) {
      throw notFound('Associated payment order not found');
    }

    const bookingOrderId = paymentOrder.bookingOrderId;

    const [bookingOrder] = await db
      .select()
      .from(bookingOrders)
      .where(eq(bookingOrders.id, bookingOrderId))
      .limit(1);

    if (!bookingOrder) {
      throw notFound('Associated booking order not found');
    }

    const existingRefunds = await paymentsRepository.findRefundsForTransaction(db, tenantId, transaction.id);
    const totalRefundedMinor = existingRefunds
      .filter((r) => r.status !== 'failed' && r.status !== 'rejected')
      .reduce((sum, r) => sum + toMinorUnits(r.amount), 0);

    const transactionAmountMinor = toMinorUnits(transaction.amount);
    const remainingAmountMinor = transactionAmountMinor - totalRefundedMinor;

    if (remainingAmountMinor <= 0) {
      throw badRequest('This transaction is already fully refunded');
    }

    const refundAmountMinor = amount ? toMinorUnits(amount) : remainingAmountMinor;

    if (refundAmountMinor <= 0) {
      throw badRequest('Refund amount must be positive');
    }

    if (refundAmountMinor > remainingAmountMinor) {
      throw badRequest(`Refund amount exceeds remaining refundable balance. Max allowed: ${toDecimalString(remainingAmountMinor)}`);
    }

    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, bookingOrder.eventId))
      .limit(1);

    const isFullyRefunded = (totalRefundedMinor + refundAmountMinor) === transactionAmountMinor;

    // Check if the purchase has already been settled in the organizer wallet
    let isSettled = false;
    let walletTx = null;
    if (event && event.organizerId) {
      [walletTx] = await db
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.organizerId, event.organizerId),
            eq(organizerWalletTransactions.referenceType, 'booking_order'),
            eq(organizerWalletTransactions.referenceId, bookingOrderId)
          )
        )
        .limit(1);

      if (walletTx && walletTx.status === 'settled') {
        isSettled = true;
      }
    }

    // Net organizer share of this refund amount
    const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
    const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
    const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
    const netOrganizerRevenueMinor = transactionAmountMinor - platformFeeMinor - taxMinor;
    
    // Pro-rata mapping of organizer share to this refund amount
    const organizerRefundShareMinor = Math.round((refundAmountMinor / transactionAmountMinor) * netOrganizerRevenueMinor);

    // Deterministic gateway idempotency key: same logical refund (this transaction,
    // this cumulative refunded position, this amount) always yields the same key,
    // so a retried/raced call is deduped by Razorpay rather than double-charged.
    const refundIdempotencyKey = createHash('sha256')
      .update(`${tenantId}:${transaction.id}:${totalRefundedMinor}:${refundAmountMinor}`)
      .digest('hex');

    // Call Razorpay API
    const rzpRefund = await razorpayClient.refundPayment({
      payment_id: transaction.razorpayPaymentId,
      amount: refundAmountMinor,
      notes: {
        reason: reason || 'Merchant refund',
        initiatedBy: actorUserId
      },
      idempotencyKey: refundIdempotencyKey
    });

    if (!rzpRefund.id || !rzpRefund.id.startsWith('rfnd_')) {
      throw badRequest(`Invalid Razorpay Refund ID returned: ${rzpRefund.id}`);
    }

    const refundStatus = rzpRefund.status === 'failed' ? 'failed' : 'processed';

    const refundRecord = await db.transaction(async (tx) => {
      const [lockTx] = await tx
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.id, transaction.id), eq(paymentTransactions.tenantId, tenantId)))
        .for('update');

      if (!lockTx) {
        throw notFound('Payment transaction not found inside transaction');
      }

      const [lockOrder] = await tx
        .select()
        .from(paymentOrders)
        .where(and(eq(paymentOrders.id, paymentOrder.id), eq(paymentOrders.tenantId, tenantId)))
        .for('update');

      if (!lockOrder) {
        throw notFound('Associated payment order not found inside transaction');
      }

      const lockRefunds = await tx
        .select()
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, lockTx.id)));

      const lockTotalRefundedMinor = lockRefunds
        .filter((r) => r.status !== 'failed' && r.status !== 'rejected')
        .reduce((sum, r) => sum + toMinorUnits(r.amount), 0);

      const lockRemainingAmountMinor = transactionAmountMinor - lockTotalRefundedMinor;
      if (refundAmountMinor > lockRemainingAmountMinor) {
        throw conflict(`Concurrency check failed: Refund amount exceeds remaining refundable balance. Max allowed: ${toDecimalString(lockRemainingAmountMinor)}`);
      }

      const refund = await paymentsRepository.createPaymentRefund(tx, {
        tenantId,
        paymentTransactionId: transaction.id,
        razorpayRefundId: rzpRefund.id,
        amount: toDecimalString(refundAmountMinor),
        status: refundStatus,
        reason: reason || null
      });

      if (refundStatus === 'processed') {
        const newPaymentStatus = isFullyRefunded ? 'refunded' : 'partially_refunded';

        validatePaymentStateTransition(lockOrder.status as PaymentState, newPaymentStatus);

        await paymentsRepository.updatePaymentOrderStatus(tx, tenantId, paymentOrder.id, newPaymentStatus);

        await this.logPaymentLifecycleEvent(tx, {
          tenantId,
          paymentOrderId: paymentOrder.id,
          paymentRefundId: refund.id,
          entityType: 'payment_refund',
          entityId: refund.id,
          eventType: `refund.${refundStatus}`,
          fromStatus: lockOrder.status,
          toStatus: newPaymentStatus,
          actorId: actorUserId,
          metadata: { razorpayRefundId: rzpRefund.id, amount: toDecimalString(refundAmountMinor) }
        });

        // Generate and upload Refund Receipt PDF to R2 (Phase 13.9 platform integration)
        try {
          const { storageService } = await import('../../lib/storage.js');
          const mockReceipt = `REFUND_RECEIPT: REFUND_ID=${rzpRefund.id}, AMOUNT=${toDecimalString(refundAmountMinor)}, DATE=${new Date().toISOString()}`;
          await storageService.uploadSystemAsset(
            tenantId,
            paymentOrder.id,
            'payments',
            `refund-receipt-${rzpRefund.id}.pdf`,
            Buffer.from(mockReceipt),
            'application/pdf'
          );
          logger.info('[PaymentsService] Generated and uploaded refund receipt PDF to R2', { refundId: rzpRefund.id });
        } catch (receiptErr: any) {
          logger.error('[PaymentsService] Failed to generate refund receipt PDF', { error: receiptErr.message });
        }

        const newBookingStatus = isFullyRefunded ? 'refunded' : 'partially_refunded';
        await tx
          .update(bookingOrders)
          .set({
            status: newBookingStatus,
            cancelledAt: isFullyRefunded ? new Date() : null,
            cancellationReason: isFullyRefunded ? `Refund: ${reason || 'Merchant initiated'}` : null,
            updatedAt: new Date(),
            updatedByUserId: actorUserId
          })
          .where(eq(bookingOrders.id, bookingOrderId));

        await applyIssuedTicketStatusForBookingOrder(tx, tenantId, bookingOrderId, newBookingStatus);

        if (isFullyRefunded) {
          await inventory.releaseReservationsForBookingOrder(tx, {
            tenantId,
            bookingOrderId,
            actorUserId,
            source: 'booking-order-refund-release'
          });
        }

        // Ledger postings for refund
        if (event && event.organizerId) {
          const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, event.organizerId);

          if (isSettled) {
            // Reversing post-settlement: Debit organizer balance, revenue, tax; Credit clearing
            const platformFeeRefundMinor = FinanceTaxService.prorateTax(platformFeeMinor, refundAmountMinor, transactionAmountMinor);
            const taxRefundMinor = FinanceTaxService.prorateTax(taxMinor, refundAmountMinor, transactionAmountMinor);

            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: true,
              organizerId: event.organizerId,
              platformFeeRefund: platformFeeRefundMinor,
              taxRefund: taxRefundMinor,
              netOrganizerRefund: organizerRefundShareMinor,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newAvailable = Math.max(0, toMinorUnits(wallet.availableBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                toDecimalString(newAvailable),
                wallet.pendingBalance,
                wallet.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'settled',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Settled revenue reversal due to refund of booking ${bookingOrder.orderNumber}`
              });
            }
          } else {
            // Reversing pre-settlement: Debit platform escrow; Credit clearing
            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: false,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newPending = Math.max(0, toMinorUnits(wallet.pendingBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                wallet.availableBalance,
                toDecimalString(newPending),
                wallet.withdrawnBalance
              );

              // Cancel or post reversal pending wallet transaction
              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'failed',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Pending revenue cancellation due to refund of booking ${bookingOrder.orderNumber}`
              });
            }
          }
        }

        await logPaymentAudit(tx, {
          actorId: actorUserId,
          tenantId,
          entityType: 'payment_refund',
          entityId: refund.id,
          action: 'refund',
          beforeState: { status: lockOrder.status },
          afterState: { status: newPaymentStatus },
          metadata: {
            razorpayRefundId: rzpRefund.id,
            razorpayPaymentId: transaction.razorpayPaymentId,
            amountRefunded: toDecimalString(refundAmountMinor),
            remainingAmount: toDecimalString(lockRemainingAmountMinor - refundAmountMinor)
          }
        });
      }

      return refund;
    });

    if (refundStatus === 'processed') {
      incrementMetric('payments_refunded_total');
      logger.info('[PaymentsService] Refund processed successfully', { refundId: rzpRefund.id, amount: toDecimalString(refundAmountMinor) });

      try {
        const [purchaser] = await db
          .select({
            email: authAccounts.email
          })
          .from(authAccounts)
          .where(eq(authAccounts.userId, paymentOrder.createdBy))
          .limit(1);

        if (purchaser?.email) {
          const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
          const job = {
            jobType: 'refund_email',
            data: {
              bookingOrderId: paymentOrder.bookingOrderId,
              tenantId,
              email: purchaser.email,
              amount: toDecimalString(refundAmountMinor),
              currency: transaction.currency
            }
          };
          qstashService.publish(targetUrl, job).catch((err) => {
            logger.error('[PaymentsService] Failed to publish refund email job to QStash', { error: err.message });
          });
        }
      } catch (err: any) {
        logger.error('[PaymentsService] Failed to lookup user for refund email dispatch', { error: err.message });
      }
    } else {
      logger.error('[PaymentsService] Razorpay refund failed', { refundId: rzpRefund.id });
    }

    return refundRecord;
  },

  /**
   * Phase 12.8: Scheduled Settlement processor (reconciles and releases escrow to organizer balances)
   */
  async processSettlements(tenantId: string) {
    const run = await this.generateSettlementRun(tenantId);
    return this.approveSettlementRun(tenantId, run.id, 'system');
  },

  async generateSettlementRun(tenantId: string) {
    const lockKey = `settlement:lock:${tenantId}`;
    const lockAcquired = await cacheService.lock(lockKey, 30);
    if (!lockAcquired) {
      throw conflict('A settlement run is already in progress');
    }

    try {
      const pendingTxns = await db
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.tenantId, tenantId),
            eq(organizerWalletTransactions.type, 'credit'),
            eq(organizerWalletTransactions.status, 'pending'),
            eq(organizerWalletTransactions.referenceType, 'booking_order')
          )
        );

      let totalSettledMinor = 0;
      const discrepancies: any[] = [];

      for (const walletTx of pendingTxns) {
        const [bookingOrder] = await db
          .select()
          .from(bookingOrders)
          .where(eq(bookingOrders.id, walletTx.referenceId))
          .limit(1);

        if (!bookingOrder) {
          discrepancies.push({ walletTxId: walletTx.id, error: 'Booking order not found' });
          continue;
        }

        const [event] = await db
          .select()
          .from(events)
          .where(eq(events.id, bookingOrder.eventId))
          .limit(1);

        if (!event) {
          discrepancies.push({ walletTxId: walletTx.id, error: 'Associated event not found' });
          continue;
        }

        const settlementDelayMs = 3 * 24 * 60 * 60 * 1000;
        const isEligible = event.status === 'completed' || (event.endDateTime.getTime() + settlementDelayMs <= Date.now());

        if (isEligible) {
          totalSettledMinor += toMinorUnits(walletTx.amount);
        }
      }

      const runStatus = 'pending_approval';
      const settlementRun = await paymentsRepository.createSettlementRun(db, {
        tenantId,
        amount: toDecimalString(totalSettledMinor),
        status: runStatus,
        discrepancies
      });

      return settlementRun;
    } finally {
      await cacheService.unlock(lockKey);
    }
  },

  async approveSettlementRun(tenantId: string, runId: string, approvedByUserId: string) {
    const lockKey = `settlement:lock:${tenantId}`;
    const lockAcquired = await cacheService.lock(lockKey, 120);
    if (!lockAcquired) {
      throw conflict('A settlement run is already in progress');
    }

    try {
      const [run] = await db
        .select()
        .from(settlementRuns)
        .where(and(eq(settlementRuns.id, runId), eq(settlementRuns.tenantId, tenantId)))
        .limit(1);

      if (!run) {
        throw notFound('Settlement run not found');
      }

      if (run.status !== 'pending_approval' && run.status !== 'scheduled') {
        throw badRequest(`Cannot approve settlement run with status '${run.status}'`);
      }

      await db
        .update(settlementRuns)
        .set({ status: 'processing' })
        .where(eq(settlementRuns.id, run.id));

      const pendingTxns = await db
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.tenantId, tenantId),
            eq(organizerWalletTransactions.type, 'credit'),
            eq(organizerWalletTransactions.status, 'pending'),
            eq(organizerWalletTransactions.referenceType, 'booking_order')
          )
        );

      let totalSettledMinor = 0;
      const discrepancies: any[] = [];
      const organizerSettledAmounts: Record<string, number> = {};

      for (const walletTx of pendingTxns) {
        try {
          const [bookingOrder] = await db
            .select()
            .from(bookingOrders)
            .where(eq(bookingOrders.id, walletTx.referenceId))
            .limit(1);

          if (!bookingOrder) {
            discrepancies.push({ walletTxId: walletTx.id, error: 'Booking order not found' });
            continue;
          }

          const [event] = await db
            .select()
            .from(events)
            .where(eq(events.id, bookingOrder.eventId))
            .limit(1);

          if (!event) {
            discrepancies.push({ walletTxId: walletTx.id, error: 'Associated event not found' });
            continue;
          }

          const settlementDelayMs = 3 * 24 * 60 * 60 * 1000;
          const isEligible = event.status === 'completed' || (event.endDateTime.getTime() + settlementDelayMs <= Date.now());

          if (!isEligible) {
            continue;
          }

          await db.transaction(async (tx) => {
            const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, walletTx.organizerId);
            if (!wallet) {
              throw new Error(`Organizer wallet not found: ${walletTx.organizerId}`);
            }

            const grossMinor = toMinorUnits(bookingOrder.totalAmount);
            const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
            const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
            const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
            const netOrganizerRevenueMinor = toMinorUnits(walletTx.amount);

            await SettlementPostingService.postSettlement({
              tenantId,
              settlementRunId: walletTx.id,
              organizerId: walletTx.organizerId,
              grossAmount: grossMinor,
              platformFee: platformFeeMinor,
              tax: taxMinor,
              netOrganizerShare: netOrganizerRevenueMinor,
              idempotencyKey: `settlement:${walletTx.id}`
            }, tx);

            const walletPending = toMinorUnits(wallet.pendingBalance);
            const walletAvailable = toMinorUnits(wallet.availableBalance);
            const newPending = Math.max(0, walletPending - netOrganizerRevenueMinor);
            const newAvailable = walletAvailable + netOrganizerRevenueMinor;

            await paymentsRepository.updateOrganizerWalletBalances(
              tx,
              wallet.id,
              toDecimalString(newAvailable),
              toDecimalString(newPending),
              wallet.withdrawnBalance
            );

            await tx
              .update(organizerWalletTransactions)
              .set({ status: 'settled' })
              .where(eq(organizerWalletTransactions.id, walletTx.id));

            totalSettledMinor += netOrganizerRevenueMinor;
            organizerSettledAmounts[walletTx.organizerId] = (organizerSettledAmounts[walletTx.organizerId] || 0) + netOrganizerRevenueMinor;
          });
        } catch (err: any) {
          logger.error('[PaymentsService] Settlement transaction failure', { walletTxId: walletTx.id, error: err.message });
          discrepancies.push({ walletTxId: walletTx.id, error: err.message });
        }
      }

      const runStatus = discrepancies.length > 0 ? 'discrepancies_found' : 'completed';
      const [updatedRun] = await db
        .update(settlementRuns)
        .set({
          status: runStatus,
          approvedBy: approvedByUserId,
          approvedAt: new Date(),
          processedAt: new Date(),
          amount: toDecimalString(totalSettledMinor),
          discrepancies
        })
        .where(eq(settlementRuns.id, run.id))
        .returning();

      for (const [organizerId, settledAmountMinor] of Object.entries(organizerSettledAmounts)) {
        if (settledAmountMinor <= 0) continue;

        try {
          const [organizerUser] = await db
            .select({
              email: authAccounts.email,
              supportEmail: organizers.supportEmail
            })
            .from(organizers)
            .innerJoin(authAccounts, eq(authAccounts.userId, organizers.createdByUserId))
            .where(eq(organizers.id, organizerId))
            .limit(1);

          const orgEmail = organizerUser?.supportEmail || organizerUser?.email || '';
          if (orgEmail) {
            const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
            const job = {
              jobType: 'settlement_email',
              data: {
                organizerId,
                tenantId,
                email: orgEmail,
                amount: toDecimalString(settledAmountMinor),
                currency: 'INR',
                status: 'completed'
              }
            };
            qstashService.publish(targetUrl, job).catch((err) => {
              logger.error('[PaymentsService] Failed to publish settlement email to QStash', { error: err.message });
            });
          }
        } catch (err: any) {
          logger.error('[PaymentsService] Failed to look up organizer email for settlement notification', { error: err.message });
        }
      }

      incrementMetric('settlements_total');
      return updatedRun;
    } finally {
      await cacheService.unlock(lockKey);
    }
  },

  async rejectSettlementRun(tenantId: string, runId: string, actorUserId: string) {
    const [run] = await db
      .select()
      .from(settlementRuns)
      .where(and(eq(settlementRuns.id, runId), eq(settlementRuns.tenantId, tenantId)))
      .limit(1);

    if (!run) {
      throw notFound('Settlement run not found');
    }

    if (run.status !== 'pending_approval') {
      throw badRequest(`Cannot reject settlement run with status '${run.status}'`);
    }

    const [updated] = await db
      .update(settlementRuns)
      .set({
        status: 'rejected',
        approvedBy: actorUserId,
        approvedAt: new Date()
      })
      .where(eq(settlementRuns.id, runId))
      .returning();

    return updated;
  },

  /**
   * Phase 12.6: Organizer Withdrawal request
   */
  async requestWithdrawal(tenantId: string, organizerId: string, amount: number) {
    if (amount <= 0) {
      throw badRequest('Withdrawal amount must be greater than zero');
    }

    const minWithdrawal = 10.00;
    if (amount < minWithdrawal) {
      throw badRequest(`Minimum withdrawal amount is ${minWithdrawal.toFixed(2)} INR`);
    }

    const result = await db.transaction(async (tx) => {
      const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, organizerId);
      if (!wallet) {
        throw notFound('Organizer wallet not found');
      }

      const available = parseFloat(wallet.availableBalance);
      if (available < amount) {
        throw badRequest('Insufficient available balance for withdrawal');
      }

      const [organizer] = await tx
        .select()
        .from(organizers)
        .where(and(eq(organizers.id, organizerId), eq(organizers.tenantId, tenantId)))
        .limit(1);

      if (!organizer) {
        throw notFound('Organizer profile not found');
      }

      if (organizer.verificationStatus !== 'verified') {
        throw forbidden('Withdrawals are only allowed for verified organizers (KYC verified)');
      }

      const maxDailyLimit = 50000.00;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const withdrawalsToday = await tx
        .select({ amount: withdrawalRequests.amount })
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.organizerId, organizerId),
            eq(withdrawalRequests.tenantId, tenantId),
            gte(withdrawalRequests.requestedAt, startOfToday)
          )
        );

      const totalWithdrawnToday = withdrawalsToday.reduce((sum, w) => sum + parseFloat(w.amount), 0);
      if (totalWithdrawnToday + amount > maxDailyLimit) {
        throw badRequest(`Withdrawal exceeds maximum daily limit of ${maxDailyLimit.toFixed(2)} INR`);
      }

      const request = await paymentsRepository.createWithdrawalRequest(tx, {
        tenantId,
        organizerId,
        amount: amount.toFixed(2),
        status: 'pending'
      });

      const newAvailable = available - amount;
      const newPending = parseFloat(wallet.pendingBalance) + amount;
      await paymentsRepository.updateOrganizerWalletBalances(
        tx,
        wallet.id,
        newAvailable.toFixed(2),
        newPending.toFixed(2),
        wallet.withdrawnBalance
      );

      await paymentsRepository.createOrganizerWalletTransaction(tx, {
        tenantId,
        organizerId,
        walletId: wallet.id,
        type: 'debit',
        status: 'pending_withdrawal',
        amount: amount.toFixed(2),
        currency: 'INR',
        referenceType: 'withdrawal_request',
        referenceId: request.id,
        description: `Withdrawal request ${request.id} pending approval`
      });

      return request;
    });

    try {
      const [organizerUser] = await db
        .select({
          email: authAccounts.email,
          supportEmail: organizers.supportEmail
        })
        .from(organizers)
        .innerJoin(authAccounts, eq(authAccounts.userId, organizers.createdByUserId))
        .where(eq(organizers.id, organizerId))
        .limit(1);

      const orgEmail = organizerUser?.supportEmail || organizerUser?.email || '';
      if (orgEmail) {
        const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
        const job = {
          jobType: 'withdrawal_email',
          data: {
            organizerId,
            tenantId,
            email: orgEmail,
            amount: amount.toFixed(2),
            currency: 'INR',
            status: 'pending'
          }
        };
        qstashService.publish(targetUrl, job).catch((err) => {
          logger.error('[PaymentsService] Failed to publish withdrawal request email to QStash', { error: err.message });
        });
      }
    } catch (err: any) {
      logger.error('[PaymentsService] Failed to look up organizer email for withdrawal request notification', { error: err.message });
    }

    return result;
  },

  /**
   * Complete or fail a withdrawal request
   */
  async processWithdrawal(tenantId: string, id: string, status: 'approved' | 'completed' | 'failed' | 'rejected', actorUserId: string) {
    const result = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(withdrawalRequests)
        .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.tenantId, tenantId)))
        .for('update');

      if (!request) {
        throw notFound('Withdrawal request not found');
      }

      if (request.status !== 'pending' && request.status !== 'processing') {
        throw badRequest(`Cannot process withdrawal request with status '${request.status}'`);
      }

      const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, request.organizerId);
      if (!wallet) {
        throw notFound('Organizer wallet not found');
      }

      const requestAmountMinor = toMinorUnits(request.amount);

      if (status === 'approved') {
        const payout = await mockPayoutProvider.createPayout({
          tenantId,
          organizerId: request.organizerId,
          amount: requestAmountMinor,
          currency: 'INR',
          withdrawalRequestId: request.id
        });

        if (!payout.success) {
          throw new Error(`Payout provider failed: ${payout.error}`);
        }

        const updatedRequest = await paymentsRepository.updateWithdrawalRequestStatus(tx, tenantId, id, 'processing', actorUserId);
        await tx
          .update(withdrawalRequests)
          .set({
            gatewayPayoutId: payout.gatewayPayoutId || `pout_${Date.now()}`,
            gatewayStatus: 'processing',
            updatedAt: new Date()
          })
          .where(eq(withdrawalRequests.id, id));

        await tx
          .update(organizerWalletTransactions)
          .set({ status: 'processing_withdrawal' })
          .where(
            and(
              eq(organizerWalletTransactions.referenceType, 'withdrawal_request'),
              eq(organizerWalletTransactions.referenceId, request.id)
            )
          );

        return updatedRequest;
      } else if (status === 'completed') {
        const payout = await mockPayoutProvider.createPayout({
          tenantId,
          organizerId: request.organizerId,
          amount: requestAmountMinor,
          currency: 'INR',
          withdrawalRequestId: request.id
        });

        if (!payout.success) {
          throw new Error(`Payout provider failed: ${payout.error}`);
        }

        // Post ledger entries
        await WithdrawalPostingService.postWithdrawal({
          tenantId,
          withdrawalRequestId: request.id,
          organizerId: request.organizerId,
          amount: requestAmountMinor,
          idempotencyKey: `withdrawal:${request.id}`,
          userId: actorUserId
        }, tx);

        // Wallet balances update
        const newPending = Math.max(0, toMinorUnits(wallet.pendingBalance) - requestAmountMinor);
        const newWithdrawn = toMinorUnits(wallet.withdrawnBalance) + requestAmountMinor;

        await paymentsRepository.updateOrganizerWalletBalances(
          tx,
          wallet.id,
          wallet.availableBalance,
          toDecimalString(newPending),
          toDecimalString(newWithdrawn)
        );

        // Update wallet transaction status
        await tx
          .update(organizerWalletTransactions)
          .set({ status: 'completed' })
          .where(
            and(
              eq(organizerWalletTransactions.referenceType, 'withdrawal_request'),
              eq(organizerWalletTransactions.referenceId, request.id)
            )
          );

        await paymentsRepository.updateWithdrawalRequestStatus(tx, tenantId, id, 'completed', actorUserId);
        incrementMetric('withdrawals_total');

        // Generate and upload withdrawal proof document directly to R2 (Phase 13.9 platform integration)
        try {
          const { storageService } = await import('../../lib/storage.js');
          const mockProofData = `WITHDRAWAL_PROOF: ID=${request.id}, AMOUNT=${request.amount}, TENANT=${tenantId}, DATE=${new Date().toISOString()}`;
          const buffer = Buffer.from(mockProofData);
          const fileName = `withdrawal-proof-${request.id}.pdf`;
          
          await storageService.uploadSystemAsset(
            tenantId,
            request.id,
            'payments',
            fileName,
            buffer,
            'application/pdf'
          );
          logger.info('[PaymentsService] Generated and stored withdrawal proof in R2', { id: request.id });
        } catch (err: any) {
          logger.error('[PaymentsService] Failed to generate withdrawal proof', { error: err.message });
        }
      } else {
        // Return funds to available balance
        const newAvailable = toMinorUnits(wallet.availableBalance) + requestAmountMinor;
        const newPending = Math.max(0, toMinorUnits(wallet.pendingBalance) - requestAmountMinor);

        await paymentsRepository.updateOrganizerWalletBalances(
          tx,
          wallet.id,
          toDecimalString(newAvailable),
          toDecimalString(newPending),
          wallet.withdrawnBalance
        );

        await tx
          .update(organizerWalletTransactions)
          .set({ status: 'failed' })
          .where(
            and(
              eq(organizerWalletTransactions.referenceType, 'withdrawal_request'),
              eq(organizerWalletTransactions.referenceId, request.id)
            )
          );

        await paymentsRepository.updateWithdrawalRequestStatus(tx, tenantId, id, status, actorUserId);
        incrementMetric('withdrawal_failures_total');
      }

      return request;
    });

    try {
      const [organizerUser] = await db
        .select({
          email: authAccounts.email,
          supportEmail: organizers.supportEmail
        })
        .from(organizers)
        .innerJoin(authAccounts, eq(authAccounts.userId, organizers.createdByUserId))
        .where(eq(organizers.id, result.organizerId))
        .limit(1);

      const orgEmail = organizerUser?.supportEmail || organizerUser?.email || '';
      if (orgEmail) {
        const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
        const job = {
          jobType: 'withdrawal_email',
          data: {
            organizerId: result.organizerId,
            tenantId,
            email: orgEmail,
            amount: result.amount,
            currency: 'INR',
            status: status, // completed, failed, or rejected
            reason: status === 'rejected' ? 'Declined by administrator' : undefined
          }
        };
        qstashService.publish(targetUrl, job).catch((err) => {
          logger.error('[PaymentsService] Failed to publish withdrawal completion email to QStash', { error: err.message });
        });
      }
    } catch (err: any) {
      logger.error('[PaymentsService] Failed to look up organizer email for withdrawal completion notification', { error: err.message });
    }

    return result;
  },

  /**
   * Phase 12.7: Customer initiated refund request
   */
  async requestCustomerRefund(tenantId: string, bookingOrderId: string, actorUserId: string, reason?: string, refundTo: 'wallet' | 'original' = 'original') {
    const [bookingOrder] = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId)))
      .limit(1);

    if (!bookingOrder) {
      throw notFound('Booking order not found');
    }

    if (bookingOrder.purchaserUserId !== actorUserId) {
      throw forbidden('You are not authorized to refund this booking order');
    }

    if (bookingOrder.status !== 'paid' && bookingOrder.status !== 'confirmed') {
      throw badRequest(`Cannot refund booking order with status '${bookingOrder.status}'`);
    }

    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, bookingOrder.eventId))
      .limit(1);

    if (!event) {
      throw notFound('Event not found');
    }

    if (event.status === 'cancelled' || event.status === 'archived' || event.status === 'completed') {
      throw badRequest(`Cannot refund booking for event with status '${event.status}'`);
    }

    if (event.startDateTime.getTime() <= Date.now()) {
      throw badRequest('Cannot request refund after the event has started');
    }

    const items = await db
      .select()
      .from(bookingOrderItems)
      .where(eq(bookingOrderItems.bookingOrderId, bookingOrderId));

    for (const item of items) {
      const [ticketType] = await db
        .select()
        .from(ticketTypes)
        .where(eq(ticketTypes.id, item.ticketTypeId))
        .limit(1);

      if (!ticketType || !ticketType.isRefundable) {
        throw badRequest(`Ticket type '${item.ticketNameSnapshot}' is not refundable`);
      }
    }

    const [paymentOrder] = await db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.bookingOrderId, bookingOrderId), eq(paymentOrders.tenantId, tenantId)))
      .limit(1);

    if (!paymentOrder) {
      throw notFound('Payment order not found');
    }

    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.paymentOrderId, paymentOrder.id), eq(paymentTransactions.status, 'captured')))
      .limit(1);

    if (!transaction) {
      throw badRequest('No captured payment transaction found for this booking');
    }

    let isSettled = false;
    if (event.organizerId) {
      const [walletTx] = await db
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.organizerId, event.organizerId),
            eq(organizerWalletTransactions.referenceType, 'booking_order'),
            eq(organizerWalletTransactions.referenceId, bookingOrderId)
          )
        )
        .limit(1);

      if (walletTx && walletTx.status === 'settled') {
        isSettled = true;
      }
    }

    const transactionAmountMinor = toMinorUnits(transaction.amount);
    const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
    const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
    const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
    const netOrganizerRevenueMinor = transactionAmountMinor - platformFeeMinor - taxMinor;

    if (isSettled && event.organizerId) {
      const wallet = await paymentsRepository.findOrganizerWallet(db, tenantId, event.organizerId);
      if (!wallet || parseFloat(wallet.availableBalance) < (netOrganizerRevenueMinor / 100)) {
        throw badRequest('Refund cannot be processed: insufficient organizer available balance');
      }
    }

    const now = new Date();

    if (refundTo === 'wallet') {
      const refundResult = await db.transaction(async (tx) => {
        const [lockTx] = await tx
          .select()
          .from(paymentTransactions)
          .where(and(eq(paymentTransactions.id, transaction.id), eq(paymentTransactions.tenantId, tenantId)))
          .for('update');

        if (!lockTx) {
          throw notFound('Payment transaction not found inside transaction');
        }

        const lockRefunds = await tx
          .select()
          .from(paymentRefunds)
          .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, lockTx.id)));

        const lockTotalRefundedMinor = lockRefunds
          .filter((r) => r.status !== 'failed' && r.status !== 'rejected')
          .reduce((sum, r) => sum + toMinorUnits(r.amount), 0);

        const refundAmountMinor = toMinorUnits(bookingOrder.totalAmount);
        const lockRemainingAmountMinor = transactionAmountMinor - lockTotalRefundedMinor;
        if (refundAmountMinor > lockRemainingAmountMinor) {
          throw badRequest(`Refund amount exceeds remaining refundable balance. Max allowed: ${toDecimalString(lockRemainingAmountMinor)}`);
        }

        const refund = await paymentsRepository.createPaymentRefund(tx, {
          tenantId,
          paymentTransactionId: transaction.id,
          razorpayRefundId: `req_instant_${randomUUID().replace(/-/g, '')}`,
          amount: toDecimalString(refundAmountMinor),
          status: 'processed',
          reason: reason || 'Instant wallet refund request'
        });

        await tx
          .update(paymentRefunds)
          .set({ approvalStatus: 'approved' })
          .where(eq(paymentRefunds.id, refund.id));

        refund.status = 'processed';
        refund.approvalStatus = 'approved';

        await this.logPaymentLifecycleEvent(tx, {
          tenantId,
          paymentOrderId: paymentOrder.id,
          paymentRefundId: refund.id,
          entityType: 'payment_refund',
          entityId: refund.id,
          eventType: 'refund.processed',
          fromStatus: paymentOrder.status,
          toStatus: 'refunded',
          actorId: actorUserId,
          metadata: { amount: toDecimalString(refundAmountMinor), type: 'instant_wallet' }
        });

        await tx
          .update(bookingOrders)
          .set({
            status: 'refunded',
            cancelledAt: now,
            cancellationReason: `Instant Coins Refund: ${reason || 'User requested'}`,
            updatedAt: now,
            updatedByUserId: actorUserId
          })
          .where(eq(bookingOrders.id, bookingOrderId));

        await applyIssuedTicketStatusForBookingOrder(tx, tenantId, bookingOrderId, 'refunded');

        await inventory.releaseReservationsForBookingOrder(tx, {
          tenantId,
          bookingOrderId,
          actorUserId,
          source: 'booking-order-refund-release'
        });

        if (event && event.organizerId) {
          const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, event.organizerId);
          const organizerRefundShareMinor = netOrganizerRevenueMinor;

          if (isSettled) {
            const platformFeeRefundMinor = FinanceTaxService.prorateTax(platformFeeMinor, refundAmountMinor, transactionAmountMinor);
            const taxRefundMinor = FinanceTaxService.prorateTax(taxMinor, refundAmountMinor, transactionAmountMinor);

            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: true,
              organizerId: event.organizerId,
              platformFeeRefund: platformFeeRefundMinor,
              taxRefund: taxRefundMinor,
              netOrganizerRefund: organizerRefundShareMinor,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newAvailable = Math.max(0, toMinorUnits(wallet.availableBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                toDecimalString(newAvailable),
                wallet.pendingBalance,
                wallet.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'settled',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Settled revenue reversal due to instant coins refund of booking ${bookingOrder.orderNumber}`
              });
            }
          } else {
            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: false,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newPending = Math.max(0, toMinorUnits(wallet.pendingBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                wallet.availableBalance,
                toDecimalString(newPending),
                wallet.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'failed',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Pending revenue cancellation due to instant coins refund of booking ${bookingOrder.orderNumber}`
              });
            }
          }
        }

        let [userWallet] = await tx
          .select()
          .from(userWallets)
          .where(eq(userWallets.userId, actorUserId))
          .limit(1);

        if (!userWallet) {
          const [newUserWallet] = await tx
            .insert(userWallets)
            .values({
              userId: actorUserId,
              balance: '0.00'
            })
            .returning();
          userWallet = newUserWallet;
        }

        const currentBalance = parseFloat(userWallet.balance);
        const refundAmount = parseFloat(bookingOrder.totalAmount);
        const newBalance = (currentBalance + refundAmount).toFixed(2);

        await tx
          .update(userWallets)
          .set({
            balance: newBalance,
            updatedAt: now
          })
          .where(eq(userWallets.id, userWallet.id));

        await tx.insert(userWalletTransactions).values({
          userId: actorUserId,
          walletId: userWallet.id,
          type: 'credit',
          amount: bookingOrder.totalAmount,
          description: `Instant coins refund for booking order ${bookingOrder.orderNumber}`,
          referenceType: 'refund',
          referenceId: refund.id
        });

        await logPaymentAudit(tx, {
          actorId: actorUserId,
          tenantId,
          entityType: 'payment_refund',
          entityId: refund.id,
          action: 'instant_refund_processed',
          beforeState: { status: 'captured' },
          afterState: { status: 'processed', approvalStatus: 'approved' },
          metadata: { amount: refund.amount, refundTo: 'wallet' }
        });

        return refund;
      });

      return refundResult;
    } else {
      const refundResult = await db.transaction(async (tx) => {
        const [lockTx] = await tx
          .select()
          .from(paymentTransactions)
          .where(and(eq(paymentTransactions.id, transaction.id), eq(paymentTransactions.tenantId, tenantId)))
          .for('update');

        if (!lockTx) {
          throw notFound('Payment transaction not found inside transaction');
        }

        const lockRefunds = await tx
          .select()
          .from(paymentRefunds)
          .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, lockTx.id)));

        const lockTotalRefundedMinor = lockRefunds
          .filter((r) => r.status !== 'failed' && r.status !== 'rejected')
          .reduce((sum, r) => sum + toMinorUnits(r.amount), 0);

        const refundAmountMinor = toMinorUnits(bookingOrder.totalAmount);
        const lockRemainingAmountMinor = transactionAmountMinor - lockTotalRefundedMinor;
        if (refundAmountMinor > lockRemainingAmountMinor) {
          throw badRequest(`Refund amount exceeds remaining refundable balance. Max allowed: ${toDecimalString(lockRemainingAmountMinor)}`);
        }

        const refund = await paymentsRepository.createPaymentRefund(tx, {
          tenantId,
          paymentTransactionId: transaction.id,
          razorpayRefundId: `req_${randomUUID().replace(/-/g, '')}`,
          amount: toDecimalString(refundAmountMinor),
          status: 'requested',
          reason: reason || 'Customer refund request'
        });

        await tx
          .update(paymentRefunds)
          .set({ approvalStatus: 'pending' })
          .where(eq(paymentRefunds.id, refund.id));

        refund.status = 'requested';
        refund.approvalStatus = 'pending';

        await this.logPaymentLifecycleEvent(tx, {
          tenantId,
          paymentOrderId: paymentOrder.id,
          paymentRefundId: refund.id,
          entityType: 'payment_refund',
          entityId: refund.id,
          eventType: 'refund.requested',
          fromStatus: paymentOrder.status,
          toStatus: 'requested',
          actorId: actorUserId,
          metadata: { amount: toDecimalString(refundAmountMinor) }
        });

        return refund;
      });

      return refundResult;
    }
  },

  /**
   * Phase 12.9: Administrative Financial Integrity Checker
   */
  async runIntegrityCheck(tenantId: string) {
    const errors: string[] = [];

    // 1. Validate negative balances in organizer wallets
    const wallets = await db
      .select()
      .from(organizerWallets)
      .where(eq(organizerWallets.tenantId, tenantId));

    for (const w of wallets) {
      if (parseFloat(w.availableBalance) < 0 || parseFloat(w.pendingBalance) < 0 || parseFloat(w.withdrawnBalance) < 0) {
        errors.push(`Organizer wallet ${w.organizerId} has negative balance: available=${w.availableBalance}, pending=${w.pendingBalance}`);
      }
    }

    // 2. Validate unbalanced ledger transactions (debit !== credit)
    const ledgerTxns = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenantId));

    for (const tx of ledgerTxns) {
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerTransactionId, tx.id));

      let debits = 0;
      let credits = 0;
      for (const ent of entries) {
        if (ent.direction === 'debit') debits += toMinorUnits(ent.amount);
        else if (ent.direction === 'credit') credits += toMinorUnits(ent.amount);
      }

      if (debits !== credits) {
        errors.push(`Unbalanced ledger transaction ${tx.id} (${tx.transactionType}): debits=${debits}, credits=${credits}`);
      }
    }

    // 3. Validate withdrawals exceeding total organizer wallet balances
    const completedWithdrawals = await db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.tenantId, tenantId), eq(withdrawalRequests.status, 'completed')));

    for (const orgWallet of wallets) {
      const orgWithdrawals = completedWithdrawals.filter(w => w.organizerId === orgWallet.organizerId);
      const totalRequestedWithdrawalsMinor = orgWithdrawals.reduce((sum, w) => sum + toMinorUnits(w.amount), 0);
      const walletWithdrawnMinor = toMinorUnits(orgWallet.withdrawnBalance);

      if (totalRequestedWithdrawalsMinor > walletWithdrawnMinor) {
        errors.push(`Organizer ${orgWallet.organizerId} has withdrawals mismatch: requestSum=${toDecimalString(totalRequestedWithdrawalsMinor)}, walletWithdrawn=${orgWallet.withdrawnBalance}`);
      }
    }

    // 4. Validate refund exceeding captured payment
    const transactions = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.tenantId, tenantId), eq(paymentTransactions.status, 'captured')));

    for (const tx of transactions) {
      const refunds = await db
        .select()
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, tx.id), eq(paymentRefunds.status, 'processed')));

      const totalRefundedMinor = refunds.reduce((sum, r) => sum + toMinorUnits(r.amount), 0);
      const originalAmountMinor = toMinorUnits(tx.amount);

      if (totalRefundedMinor > originalAmountMinor) {
        errors.push(`Refund exceeds captured payment on transaction ${tx.id}: original=${tx.amount}, refunded=${toDecimalString(totalRefundedMinor)}`);
      }
    }

    // 5. Validate duplicate settlements (no multiple settlements processed for the same wallet transaction)
    const runReports = await db
      .select()
      .from(settlementRuns)
      .where(eq(settlementRuns.tenantId, tenantId));

    // 6. Validate orphaned ledger entries
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.tenantId, tenantId));

    for (const entry of entries) {
      const existsTx = ledgerTxns.some(t => t.id === entry.ledgerTransactionId);
      if (!existsTx) {
        errors.push(`Orphaned ledger entry ${entry.id}: referencing non-existent transaction ${entry.ledgerTransactionId}`);
      }

      const [existsAccount] = await db
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.id, entry.accountId))
        .limit(1);

      if (!existsAccount) {
        errors.push(`Orphaned ledger entry ${entry.id}: referencing non-existent account ${entry.accountId}`);
      }
    }

    // 7. Validate orphaned Razorpay transactions
    for (const tx of transactions) {
      const hasLedgerTx = ledgerTxns.some(lt => lt.referenceType === 'payment_transaction' && lt.referenceId === tx.id);
      if (!hasLedgerTx) {
        errors.push(`Captured payment transaction ${tx.id} (${tx.razorpayPaymentId}) has no corresponding ledger record`);
      }
    }

    // Cryptographic Chain Integrity Verification
    try {
      const chainReport = await LedgerAuditService.verifyChainIntegrity(tenantId);
      if (!chainReport.healthy) {
        errors.push(...chainReport.errors);
      }
    } catch (err: any) {
      errors.push(`Cryptographic chain verification failed to run: ${err.message}`);
    }

    const isHealthy = errors.length === 0;
    return {
      healthy: isHealthy,
      timestamp: new Date(),
      errors
    };
  },

  async logPaymentLifecycleEvent(
    dbConn: any,
    params: {
      tenantId: string;
      paymentOrderId?: string | null;
      paymentTransactionId?: string | null;
      paymentRefundId?: string | null;
      entityType: string;
      entityId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorId?: string | null;
      requestId?: string | null;
      correlationId?: string | null;
      providerEventId?: string | null;
      idempotencyKey?: string | null;
      metadata?: any;
    }
  ) {
    const [record] = await dbConn
      .insert(paymentLifecycleEvents)
      .values({
        tenantId: params.tenantId,
        paymentOrderId: params.paymentOrderId ?? null,
        paymentTransactionId: params.paymentTransactionId ?? null,
        paymentRefundId: params.paymentRefundId ?? null,
        entityType: params.entityType,
        entityId: params.entityId,
        eventType: params.eventType,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        actorId: params.actorId ?? null,
        requestId: params.requestId ?? null,
        correlationId: params.correlationId ?? null,
        providerEventId: params.providerEventId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        metadata: params.metadata ?? {}
      })
      .returning();
    return record;
  },

  async getPaymentTimeline(tenantId: string, paymentOrderId: string) {
    return db
      .select()
      .from(paymentLifecycleEvents)
      .where(and(eq(paymentLifecycleEvents.tenantId, tenantId), eq(paymentLifecycleEvents.paymentOrderId, paymentOrderId)))
      .orderBy(desc(paymentLifecycleEvents.createdAt));
  },

  async syncPaymentState(tenantId: string, paymentOrderId: string) {
    const paymentOrder = await paymentsRepository.findPaymentOrderById(db, tenantId, paymentOrderId);
    if (!paymentOrder) {
      throw notFound('Payment order not found');
    }

    let rzpOrder: any;
    try {
      rzpOrder = await razorpayClient.fetchOrder(paymentOrder.razorpayOrderId);
    } catch (err: any) {
      logger.error('[PaymentsService] Failed to fetch Razorpay order for sync', { orderId: paymentOrder.razorpayOrderId, error: err.message });
      throw badRequest(`Razorpay sync failed: ${err.message}`);
    }

    const gatewayStatus = rzpOrder.status; // 'created', 'attempted', 'paid'
    const paymentsList = await razorpayClient.listPayments({ count: 100 });
    const orderPayments = (paymentsList?.items || []).filter((p: any) => p.order_id === paymentOrder.razorpayOrderId);

    // Sync provider state json
    await db
      .update(paymentOrders)
      .set({
        providerState: {
          ...(paymentOrder.providerState as Record<string, any>),
          rzpOrder,
          orderPayments
        },
        updatedAt: new Date()
      })
      .where(eq(paymentOrders.id, paymentOrderId));

    if (gatewayStatus === 'paid') {
      const capturedPayment = orderPayments.find((p: any) => p.status === 'captured');
      if (capturedPayment) {
        await this.confirmPaymentAndOrder(paymentOrder.razorpayOrderId, capturedPayment.id, capturedPayment);
      }
    } else if (orderPayments.some((p: any) => p.status === 'authorized')) {
      const authorizedPayment = orderPayments.find((p: any) => p.status === 'authorized');
      if (authorizedPayment) {
        validatePaymentStateTransition(paymentOrder.status as PaymentState, 'authorized');
        await db
          .update(paymentOrders)
          .set({ status: 'authorized', updatedAt: new Date() })
          .where(eq(paymentOrders.id, paymentOrderId));
        
        await paymentsRepository.createPaymentTransaction(db, {
          tenantId,
          paymentOrderId: paymentOrder.id,
          razorpayPaymentId: authorizedPayment.id,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          status: 'authorized',
          gatewayResponse: authorizedPayment
        });
      }
    } else if (orderPayments.some((p: any) => p.status === 'failed')) {
      const failedPayment = orderPayments.find((p: any) => p.status === 'failed');
      if (failedPayment) {
        await this.handlePaymentFailure(paymentOrder.razorpayOrderId, failedPayment.id, failedPayment);
      }
    }

    const updated = await paymentsRepository.findPaymentOrderById(db, tenantId, paymentOrderId);
    return updated;
  },

  async approveRefundAdmin(tenantId: string, refundId: string, actorUserId: string) {
    const [refund] = await db
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.id, refundId), eq(paymentRefunds.tenantId, tenantId)))
      .limit(1);

    if (!refund) {
      throw notFound('Refund request not found');
    }

    if (refund.approvalStatus !== 'pending') {
      throw badRequest(`Refund request has already been ${refund.approvalStatus}`);
    }

    const transaction = await paymentsRepository.findPaymentTransactionById(db, tenantId, refund.paymentTransactionId);
    if (!transaction) {
      throw notFound('Associated payment transaction not found');
    }

    const paymentOrder = await paymentsRepository.findPaymentOrderById(db, tenantId, transaction.paymentOrderId);
    if (!paymentOrder) {
      throw notFound('Associated payment order not found');
    }

    const bookingOrderId = paymentOrder.bookingOrderId;
    const [bookingOrder] = await db
      .select()
      .from(bookingOrders)
      .where(eq(bookingOrders.id, bookingOrderId))
      .limit(1);

    if (!bookingOrder) {
      throw notFound('Associated booking order not found');
    }

    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, bookingOrder.eventId))
      .limit(1);

    const transactionAmountMinor = toMinorUnits(transaction.amount);
    const refundAmountMinor = toMinorUnits(refund.amount);

    let isSettled = false;
    let walletTx = null;
    if (event && event.organizerId) {
      [walletTx] = await db
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.organizerId, event.organizerId),
            eq(organizerWalletTransactions.referenceType, 'booking_order'),
            eq(organizerWalletTransactions.referenceId, bookingOrderId)
          )
        )
        .limit(1);

      if (walletTx && walletTx.status === 'settled') {
        isSettled = true;
      }
    }

    const subtotalMinor = toMinorUnits(bookingOrder.subtotalAmount);
    const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
    const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, bookingOrder.currency).totalTax;
    const netOrganizerRevenueMinor = transactionAmountMinor - platformFeeMinor - taxMinor;
    const organizerRefundShareMinor = Math.round((refundAmountMinor / transactionAmountMinor) * netOrganizerRevenueMinor);

    const rzpRefund = await razorpayClient.refundPayment({
      payment_id: transaction.razorpayPaymentId,
      amount: refundAmountMinor,
      notes: {
        reason: refund.reason || 'Admin approved refund',
        initiatedBy: actorUserId
      }
    });

    if (!rzpRefund.id || !rzpRefund.id.startsWith('rfnd_')) {
      throw badRequest(`Invalid Razorpay Refund ID returned: ${rzpRefund.id}`);
    }

    const refundStatus = rzpRefund.status === 'failed' ? 'failed' : 'processed';

    const updatedRefund = await db.transaction(async (tx) => {
      const [lockRefund] = await tx
        .select()
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.tenantId, tenantId)))
        .for('update');

      if (!lockRefund) {
        throw notFound('Refund request not found inside transaction');
      }

      if (lockRefund.approvalStatus !== 'pending') {
        throw conflict('Concurrency check failed: Refund has already been processed or approved');
      }

      const [lockTx] = await tx
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.id, transaction.id), eq(paymentTransactions.tenantId, tenantId)))
        .for('update');

      if (!lockTx) {
        throw notFound('Payment transaction not found inside transaction');
      }

      const [lockOrder] = await tx
        .select()
        .from(paymentOrders)
        .where(and(eq(paymentOrders.id, paymentOrder.id), eq(paymentOrders.tenantId, tenantId)))
        .for('update');

      if (!lockOrder) {
        throw notFound('Associated payment order not found inside transaction');
      }

      const lockRefunds = await tx
        .select()
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, lockTx.id)));

      const lockTotalRefundedMinor = lockRefunds
        .filter((r) => r.id !== refund.id && r.status !== 'failed' && r.status !== 'rejected')
        .reduce((sum, r) => sum + toMinorUnits(r.amount), 0);

      const lockRemainingAmountMinor = transactionAmountMinor - lockTotalRefundedMinor;
      if (refundAmountMinor > lockRemainingAmountMinor) {
        throw conflict(`Concurrency check failed: Refund amount exceeds remaining refundable balance. Max allowed: ${toDecimalString(lockRemainingAmountMinor)}`);
      }

      const [record] = await tx
        .update(paymentRefunds)
        .set({
          razorpayRefundId: rzpRefund.id,
          status: refundStatus,
          approvalStatus: refundStatus === 'processed' ? 'approved' : 'failed',
          providerState: rzpRefund
        })
        .where(eq(paymentRefunds.id, refund.id))
        .returning();

      if (refundStatus === 'processed') {
        const isFullyRefunded = (lockTotalRefundedMinor + refundAmountMinor) === transactionAmountMinor;
        const newPaymentStatus = isFullyRefunded ? 'refunded' : 'partially_refunded';

        validatePaymentStateTransition(lockOrder.status as PaymentState, newPaymentStatus);
        await paymentsRepository.updatePaymentOrderStatus(tx, tenantId, paymentOrder.id, newPaymentStatus);

        await this.logPaymentLifecycleEvent(tx, {
          tenantId,
          paymentOrderId: paymentOrder.id,
          paymentRefundId: refund.id,
          entityType: 'payment_refund',
          entityId: refund.id,
          eventType: `refund.${refundStatus}`,
          fromStatus: lockOrder.status,
          toStatus: newPaymentStatus,
          actorId: actorUserId,
          metadata: { razorpayRefundId: rzpRefund.id, amount: toDecimalString(refundAmountMinor) }
        });

        try {
          const { storageService } = await import('../../lib/storage.js');
          const mockReceipt = `REFUND_RECEIPT: REFUND_ID=${rzpRefund.id}, AMOUNT=${toDecimalString(refundAmountMinor)}, DATE=${new Date().toISOString()}`;
          await storageService.uploadSystemAsset(
            tenantId,
            paymentOrder.id,
            'payments',
            `refund-receipt-${rzpRefund.id}.pdf`,
            Buffer.from(mockReceipt),
            'application/pdf'
          );
          logger.info('[PaymentsService] Generated and uploaded refund receipt PDF to R2', { refundId: rzpRefund.id });
        } catch (receiptErr: any) {
          logger.error('[PaymentsService] Failed to generate refund receipt PDF', { error: receiptErr.message });
        }

        const newBookingStatus = isFullyRefunded ? 'refunded' : 'partially_refunded';
        await tx
          .update(bookingOrders)
          .set({
            status: newBookingStatus,
            cancelledAt: isFullyRefunded ? new Date() : null,
            cancellationReason: isFullyRefunded ? `Refund: ${refund.reason || 'Admin approved'}` : null,
            updatedAt: new Date(),
            updatedByUserId: actorUserId
          })
          .where(eq(bookingOrders.id, bookingOrderId));

        await applyIssuedTicketStatusForBookingOrder(tx, tenantId, bookingOrderId, newBookingStatus);

        if (isFullyRefunded) {
          await inventory.releaseReservationsForBookingOrder(tx, {
            tenantId,
            bookingOrderId,
            actorUserId,
            source: 'booking-order-refund-release'
          });
        }

        if (event && event.organizerId) {
          const wallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, event.organizerId);

          if (isSettled) {
            const platformFeeRefundMinor = FinanceTaxService.prorateTax(platformFeeMinor, refundAmountMinor, transactionAmountMinor);
            const taxRefundMinor = FinanceTaxService.prorateTax(taxMinor, refundAmountMinor, transactionAmountMinor);

            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: true,
              organizerId: event.organizerId,
              platformFeeRefund: platformFeeRefundMinor,
              taxRefund: taxRefundMinor,
              netOrganizerRefund: organizerRefundShareMinor,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newAvailable = Math.max(0, toMinorUnits(wallet.availableBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                toDecimalString(newAvailable),
                wallet.pendingBalance,
                wallet.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'settled',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Settled revenue reversal due to refund of booking ${bookingOrder.orderNumber}`
              });
            }
          } else {
            await RefundPostingService.postRefund({
              tenantId,
              refundId: refund.id,
              refundAmount: refundAmountMinor,
              isSettled: false,
              idempotencyKey: `refund:${refund.id}`,
              userId: actorUserId
            }, tx);

            if (wallet) {
              const newPending = Math.max(0, toMinorUnits(wallet.pendingBalance) - organizerRefundShareMinor);
              await paymentsRepository.updateOrganizerWalletBalances(
                tx,
                wallet.id,
                wallet.availableBalance,
                toDecimalString(newPending),
                wallet.withdrawnBalance
              );

              await paymentsRepository.createOrganizerWalletTransaction(tx, {
                tenantId,
                organizerId: event.organizerId,
                walletId: wallet.id,
                type: 'debit',
                status: 'failed',
                amount: toDecimalString(organizerRefundShareMinor),
                currency: transaction.currency,
                referenceType: 'payment_refund',
                referenceId: refund.id,
                description: `Pending revenue cancellation due to refund of booking ${bookingOrder.orderNumber}`
              });
            }
          }
        }

        await logPaymentAudit(tx, {
          actorId: actorUserId,
          tenantId,
          entityType: 'payment_refund',
          entityId: refund.id,
          action: 'refund_approved',
          beforeState: { status: lockRefund.status, approvalStatus: 'pending' },
          afterState: { status: refundStatus, approvalStatus: 'approved' },
          metadata: { amount: refund.amount }
        });
      }

      return record;
    });

    return updatedRefund;
  },

  async rejectRefundAdmin(tenantId: string, refundId: string, actorUserId: string, rejectionReason?: string) {
    const [refund] = await db
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.id, refundId), eq(paymentRefunds.tenantId, tenantId)))
      .limit(1);

    if (!refund) {
      throw notFound('Refund request not found');
    }

    if (refund.approvalStatus !== 'pending') {
      throw badRequest(`Refund request has already been ${refund.approvalStatus}`);
    }

    const updated = await db.transaction(async (tx) => {
      const [lockRefund] = await tx
        .select()
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.tenantId, tenantId)))
        .for('update');

      if (!lockRefund) {
        throw notFound('Refund request not found inside transaction');
      }

      if (lockRefund.approvalStatus !== 'pending') {
        throw conflict('Concurrency check failed: Refund has already been processed or approved');
      }

      const [record] = await tx
        .update(paymentRefunds)
        .set({
          status: 'rejected',
          approvalStatus: 'rejected',
          rejectionReason: rejectionReason || 'Rejected by administrator'
        })
        .where(eq(paymentRefunds.id, refund.id))
        .returning();

      const transaction = await paymentsRepository.findPaymentTransactionById(tx, tenantId, refund.paymentTransactionId);
      const paymentOrderId = transaction ? transaction.paymentOrderId : null;

      await this.logPaymentLifecycleEvent(tx, {
        tenantId,
        paymentOrderId,
        paymentRefundId: refund.id,
        entityType: 'payment_refund',
        entityId: refund.id,
        eventType: 'refund.rejected',
        fromStatus: refund.status,
        toStatus: 'rejected',
        actorId: actorUserId,
        metadata: { rejectionReason }
      });

      await logPaymentAudit(tx, {
        actorId: actorUserId,
        tenantId,
        entityType: 'payment_refund',
        entityId: refund.id,
        action: 'refund_rejected',
        beforeState: { status: refund.status, approvalStatus: 'pending' },
        afterState: { status: 'rejected', approvalStatus: 'rejected' },
        metadata: { rejectionReason }
      });

      return record;
    });

    return updated;
  },

  async handleWithdrawalCallback(
    gatewayPayoutId: string,
    status: 'completed' | 'failed' | 'reversed',
    errorMessage?: string
  ) {
    logger.info('[PaymentsService] Received withdrawal callback', { gatewayPayoutId, status });
    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.gatewayPayoutId, gatewayPayoutId))
      .limit(1);

    if (!request) {
      throw notFound(`Withdrawal request with gateway payout ID ${gatewayPayoutId} not found`);
    }

    if (request.status !== 'processing') {
      logger.warn('[PaymentsService] Withdrawal request is not in processing state. Ignoring callback.', { requestId: request.id, currentStatus: request.status });
      return request;
    }

    const tenantId = request.tenantId;
    const wallet = await paymentsRepository.findOrganizerWallet(db, tenantId, request.organizerId);
    if (!wallet) {
      throw notFound('Organizer wallet not found');
    }

    const requestAmountMinor = toMinorUnits(request.amount);

    const result = await db.transaction(async (tx) => {
      const [lockRequest] = await tx
        .select()
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.id, request.id))
        .for('update');
      
      const lockWallet = await paymentsRepository.findOrganizerWalletForUpdate(tx, tenantId, request.organizerId);
      if (!lockWallet) {
        throw notFound('Organizer wallet not found inside transaction');
      }

      if (lockRequest.status !== 'processing') {
        return lockRequest;
      }

      if (status === 'completed') {
        // Payout completed! Post ledger entries and release from pending to withdrawn
        await WithdrawalPostingService.postWithdrawal({
          tenantId,
          withdrawalRequestId: request.id,
          organizerId: request.organizerId,
          amount: requestAmountMinor,
          idempotencyKey: `withdrawal:${request.id}`,
          userId: 'system'
        }, tx);

        const newPending = Math.max(0, toMinorUnits(lockWallet.pendingBalance) - requestAmountMinor);
        const newWithdrawn = toMinorUnits(lockWallet.withdrawnBalance) + requestAmountMinor;

        await paymentsRepository.updateOrganizerWalletBalances(
          tx,
          lockWallet.id,
          lockWallet.availableBalance,
          toDecimalString(newPending),
          toDecimalString(newWithdrawn)
        );

        await tx
          .update(organizerWalletTransactions)
          .set({ status: 'completed' })
          .where(
            and(
              eq(organizerWalletTransactions.referenceType, 'withdrawal_request'),
              eq(organizerWalletTransactions.referenceId, request.id)
            )
          );

        const updated = await paymentsRepository.updateWithdrawalRequestStatus(tx, tenantId, request.id, 'completed');
        await tx
          .update(withdrawalRequests)
          .set({ gatewayStatus: 'completed' })
          .where(eq(withdrawalRequests.id, request.id));

        return updated;
      } else {
        // Payout failed/reversed! Return pending balance back to available balance
        const newAvailable = toMinorUnits(lockWallet.availableBalance) + requestAmountMinor;
        const newPending = Math.max(0, toMinorUnits(lockWallet.pendingBalance) - requestAmountMinor);

        await paymentsRepository.updateOrganizerWalletBalances(
          tx,
          lockWallet.id,
          toDecimalString(newAvailable),
          toDecimalString(newPending),
          lockWallet.withdrawnBalance
        );

        await tx
          .update(organizerWalletTransactions)
          .set({ status: 'failed' })
          .where(
            and(
              eq(organizerWalletTransactions.referenceType, 'withdrawal_request'),
              eq(organizerWalletTransactions.referenceId, request.id)
            )
          );

        const updated = await paymentsRepository.updateWithdrawalRequestStatus(tx, tenantId, request.id, 'failed');
        await tx
          .update(withdrawalRequests)
          .set({
            gatewayStatus: 'failed',
            errorMessage: errorMessage || 'Gateway payout failed'
          })
          .where(eq(withdrawalRequests.id, request.id));

        return updated;
      }
    });

    return result;
  },

  async handleDisputeCreated(disputePayload: any) {
    const razorpayDisputeId = disputePayload.id;
    const razorpayPaymentId = disputePayload.payment_id;
    const amountMinor = Number(disputePayload.amount);
    const amountStr = toDecimalString(amountMinor);
    const currency = disputePayload.currency || 'INR';
    const reason = disputePayload.reason || 'chargeback';

    logger.info('[PaymentsService] Webhook: handling dispute.created', { razorpayDisputeId, razorpayPaymentId, amountMinor });

    const [existingDispute] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.razorpayDisputeId, razorpayDisputeId))
      .limit(1);

    if (existingDispute) {
      logger.info('[PaymentsService] Dispute already registered. Skipping creation.', { razorpayDisputeId });
      return existingDispute;
    }

    // 1. Find the payment transaction
    const [txRecord] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.razorpayPaymentId, razorpayPaymentId))
      .limit(1);

    if (!txRecord) {
      logger.error('[PaymentsService] Webhook dispute.created: matching payment transaction not found', { razorpayPaymentId });
      throw notFound(`Payment transaction with Razorpay Payment ID ${razorpayPaymentId} not found`);
    }

    const tenantId = txRecord.tenantId;

    // 2. Find the organizer ID
    const [orderRecord] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, txRecord.paymentOrderId))
      .limit(1);
    
    if (!orderRecord) {
      logger.error('[PaymentsService] Webhook dispute.created: matching payment order not found', { orderId: txRecord.paymentOrderId });
      throw notFound('Payment order not found');
    }

    const [bookingRecord] = await db
      .select()
      .from(bookingOrders)
      .where(eq(bookingOrders.id, orderRecord.bookingOrderId))
      .limit(1);

    if (!bookingRecord) {
      logger.error('[PaymentsService] Webhook dispute.created: matching booking order not found', { bookingId: orderRecord.bookingOrderId });
      throw notFound('Booking order not found');
    }

    const [eventRecord] = await db
      .select()
      .from(events)
      .where(eq(events.id, bookingRecord.eventId))
      .limit(1);

    if (!eventRecord || !eventRecord.organizerId) {
      logger.error('[PaymentsService] Webhook dispute.created: event or organizer profile not found', { eventId: bookingRecord.eventId });
      throw notFound('Event or organizer not found');
    }

    const organizerId = eventRecord.organizerId;

    // 3. Create the dispute record
    const [disputeRecord] = await db
      .insert(paymentDisputes)
      .values({
        tenantId,
        paymentTransactionId: txRecord.id,
        razorpayDisputeId,
        amount: amountStr,
        currency,
        status: 'received',
        reason,
        evidenceDeadline: disputePayload.evidence_deadline ? new Date(disputePayload.evidence_deadline * 1000) : null,
        gatewayResponse: disputePayload
      })
      .returning();

    // 4. Reserve organizer funds (Hold)
    const idempotencyKey = `dispute:hold:${disputeRecord.id}`;
    
    await FinancialOperationsService.execute({
      tenantId,
      operationType: 'chargeback_received',
      amount: amountMinor,
      currency,
      referenceType: 'payment_dispute',
      referenceId: disputeRecord.id,
      idempotencyKey,
      organizerId,
      reason: `Dispute hold for ${razorpayDisputeId}`
    });

    // 5. Audit & metrics
    await logPaymentAudit(null, {
      actorId: null,
      tenantId,
      entityType: 'payment_disputes',
      entityId: disputeRecord.id,
      action: 'webhook',
      beforeState: null,
      afterState: { status: 'received' },
      metadata: {
        razorpayDisputeId,
        amount: amountStr,
        organizerId
      }
    });

    incrementMetric('disputes_received_total');
    logger.info('[PaymentsService] Webhook: dispute.created processed successfully', { disputeId: disputeRecord.id });
    return disputeRecord;
  },

  async handleDisputeUnderReview(disputePayload: any) {
    const razorpayDisputeId = disputePayload.id;
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.razorpayDisputeId, razorpayDisputeId))
      .limit(1);

    if (!dispute) {
      logger.warn('[PaymentsService] Webhook dispute.under_review: dispute not found', { razorpayDisputeId });
      return null;
    }

    const [updated] = await db
      .update(paymentDisputes)
      .set({
        status: 'under_review',
        gatewayResponse: disputePayload,
        updatedAt: new Date()
      })
      .where(eq(paymentDisputes.id, dispute.id))
      .returning();

    return updated;
  },

  async handleDisputeWon(disputePayload: any) {
    const razorpayDisputeId = disputePayload.id;
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.razorpayDisputeId, razorpayDisputeId))
      .limit(1);

    if (!dispute) {
      logger.warn('[PaymentsService] Webhook dispute.won: dispute not found', { razorpayDisputeId });
      return null;
    }

    if (dispute.status === 'won' || dispute.status === 'lost') {
      logger.info('[PaymentsService] Dispute already resolved. Short-circuiting.', { razorpayDisputeId });
      return dispute;
    }

    // Resolve organizerId
    const [txRecord] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, dispute.paymentTransactionId))
      .limit(1);

    const [orderRecord] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, txRecord.paymentOrderId))
      .limit(1);

    const [bookingRecord] = await db
      .select()
      .from(bookingOrders)
      .where(eq(bookingOrders.id, orderRecord.bookingOrderId))
      .limit(1);

    const [eventRecord] = await db
      .select()
      .from(events)
      .where(eq(events.id, bookingRecord.eventId))
      .limit(1);

    const organizerId = eventRecord!.organizerId!;
    const amountMinor = toMinorUnits(dispute.amount);

    // Release reserve funds back to organizer
    const idempotencyKey = `dispute:won:${dispute.id}`;
    await FinancialOperationsService.execute({
      tenantId: dispute.tenantId,
      operationType: 'chargeback_won',
      amount: amountMinor,
      currency: dispute.currency,
      referenceType: 'payment_dispute',
      referenceId: dispute.id,
      idempotencyKey,
      organizerId,
      reason: `Dispute won: releasing hold for ${razorpayDisputeId}`
    });

    const [updated] = await db
      .update(paymentDisputes)
      .set({
        status: 'won',
        gatewayResponse: disputePayload,
        updatedAt: new Date()
      })
      .where(eq(paymentDisputes.id, dispute.id))
      .returning();

    incrementMetric('disputes_won_total');
    return updated;
  },

  async handleDisputeLost(disputePayload: any) {
    const razorpayDisputeId = disputePayload.id;
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.razorpayDisputeId, razorpayDisputeId))
      .limit(1);

    if (!dispute) {
      logger.warn('[PaymentsService] Webhook dispute.lost: dispute not found', { razorpayDisputeId });
      return null;
    }

    if (dispute.status === 'won' || dispute.status === 'lost') {
      logger.info('[PaymentsService] Dispute already resolved. Short-circuiting.', { razorpayDisputeId });
      return dispute;
    }

    const amountMinor = toMinorUnits(dispute.amount);

    // Release hold to gateway clearing (finalize expense)
    const idempotencyKey = `dispute:lost:${dispute.id}`;
    await FinancialOperationsService.execute({
      tenantId: dispute.tenantId,
      operationType: 'chargeback_lost',
      amount: amountMinor,
      currency: dispute.currency,
      referenceType: 'payment_dispute',
      referenceId: dispute.id,
      idempotencyKey,
      reason: `Dispute lost: chargeback final for ${razorpayDisputeId}`
    });

    const [updated] = await db
      .update(paymentDisputes)
      .set({
        status: 'lost',
        gatewayResponse: disputePayload,
        updatedAt: new Date()
      })
      .where(eq(paymentDisputes.id, dispute.id))
      .returning();

    incrementMetric('disputes_lost_total');
    return updated;
  },

  async uploadDisputeEvidence(tenantId: string, disputeId: string, documentUrl: string, documentType: string) {
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(and(eq(paymentDisputes.id, disputeId), eq(paymentDisputes.tenantId, tenantId)))
      .limit(1);

    if (!dispute) {
      throw notFound(`Dispute with ID ${disputeId} not found`);
    }

    const [evidence] = await db
      .insert(paymentDisputeEvidence)
      .values({
        tenantId,
        disputeId,
        documentUrl,
        documentType
      })
      .returning();

    await db
      .update(paymentDisputes)
      .set({
        status: 'evidence_submitted',
        updatedAt: new Date()
      })
      .where(eq(paymentDisputes.id, disputeId));

    return evidence;
  },

  async resolveDisputeAdmin(tenantId: string, disputeId: string, resolution: 'won' | 'lost') {
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(and(eq(paymentDisputes.id, disputeId), eq(paymentDisputes.tenantId, tenantId)))
      .limit(1);

    if (!dispute) {
      throw notFound(`Dispute with ID ${disputeId} not found`);
    }

    if (dispute.status === 'won' || dispute.status === 'lost') {
      throw badRequest('Dispute is already resolved');
    }

    let updated: any;
    if (resolution === 'won') {
      updated = await this.handleDisputeWon({ id: dispute.razorpayDisputeId || `disp_${dispute.id}`, amount: toMinorUnits(dispute.amount), currency: dispute.currency });
    } else {
      updated = await this.handleDisputeLost({ id: dispute.razorpayDisputeId || `disp_${dispute.id}`, amount: toMinorUnits(dispute.amount), currency: dispute.currency });
    }

    return updated;
  },

  async listDisputesAdmin(tenantId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const items = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.tenantId, tenantId))
      .orderBy(desc(paymentDisputes.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentDisputes)
      .where(eq(paymentDisputes.tenantId, tenantId));

    return {
      items,
      meta: {
        page,
        limit,
        total: countResult?.count ?? 0
      }
    };
  },

  async getDisputeByIdAdmin(tenantId: string, disputeId: string) {
    const [dispute] = await db
      .select()
      .from(paymentDisputes)
      .where(and(eq(paymentDisputes.id, disputeId), eq(paymentDisputes.tenantId, tenantId)))
      .limit(1);

    if (!dispute) {
      throw notFound(`Dispute with ID ${disputeId} not found`);
    }

    const evidenceList = await db
      .select()
      .from(paymentDisputeEvidence)
      .where(and(eq(paymentDisputeEvidence.disputeId, disputeId), eq(paymentDisputeEvidence.tenantId, tenantId)));

    return {
      ...dispute,
      evidence: evidenceList
    };
  },

  async createPromotion(tenantId: string, code: string, type: 'coupon' | 'cashback' | 'promotional_credit', amount: number, currency = 'INR') {
    const [existing] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.tenantId, tenantId), eq(promotions.code, code)))
      .limit(1);

    if (existing) {
      throw conflict(`Promotion code '${code}' already exists`);
    }

    const [promo] = await db
      .insert(promotions)
      .values({
        tenantId,
        code,
        type,
        amount: toDecimalString(amount),
        currency,
        status: 'active'
      })
      .returning();

    return promo;
  },

  async listPromotions(tenantId: string, page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    return db
      .select()
      .from(promotions)
      .where(eq(promotions.tenantId, tenantId))
      .orderBy(desc(promotions.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async applyPromotionalCredit(tenantId: string, customerId: string, amount: number, currency = 'INR', idempotencyKey: string) {
    const result = await FinancialOperationsService.execute({
      tenantId,
      operationType: 'promotion_credit',
      amount,
      currency,
      referenceType: 'customer',
      referenceId: customerId,
      idempotencyKey,
      customerId,
      reason: 'Promotional credit applied'
    });

    return result;
  },

  async reversePromotionalCredit(tenantId: string, customerId: string, amount: number, currency = 'INR', idempotencyKey: string) {
    const result = await FinancialOperationsService.execute({
      tenantId,
      operationType: 'promotion_reversal',
      amount,
      currency,
      referenceType: 'customer',
      referenceId: customerId,
      idempotencyKey,
      customerId,
      reason: 'Promotional credit reversed'
    });

    return result;
  },

  async processEventCancellation(tenantId: string, eventId: string, actorUserId: string) {
    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId)))
      .limit(1);

    if (!event) {
      throw notFound('Event not found');
    }

    if (event.status === 'cancelled') {
      throw badRequest('Event is already cancelled');
    }

    // Find all booking orders for the event that are not cancelled/expired/refunded and have captured transactions
    const bookings = await db
      .select({
        bookingId: bookingOrders.id,
        bookingTotal: bookingOrders.totalAmount,
        transactionId: paymentTransactions.id
      })
      .from(bookingOrders)
      .innerJoin(paymentOrders, eq(paymentOrders.bookingOrderId, bookingOrders.id))
      .innerJoin(paymentTransactions, eq(paymentTransactions.paymentOrderId, paymentOrders.id))
      .where(
        and(
          eq(bookingOrders.eventId, eventId),
          eq(bookingOrders.tenantId, tenantId),
          eq(paymentTransactions.status, 'captured'),
          sql`${bookingOrders.status} NOT IN ('cancelled', 'expired', 'refunded')`
        )
      );

    // Cancel the event status in database
    await db
      .update(events)
      .set({
        status: 'cancelled',
        updatedAt: new Date()
      })
      .where(eq(events.id, eventId));

    const refundResults = [];

    for (const booking of bookings) {
      try {
        const refundAmount = parseFloat(booking.bookingTotal);
        const refundRecord = await this.refundPayment(
          tenantId,
          actorUserId,
          booking.transactionId,
          refundAmount,
          'Event cancelled by organizer'
        );
        refundResults.push({ bookingId: booking.bookingId, success: true, refundId: refundRecord.id });
      } catch (err: any) {
        logger.error('[PaymentsService] Failed to refund booking on event cancellation', { bookingId: booking.bookingId, error: err.message });
        refundResults.push({ bookingId: booking.bookingId, success: false, error: err.message });
      }
    }

    return { eventId, refundResults };
  },

  async processBookingUpgrade(tenantId: string, bookingOrderId: string, amountDiff: number, idempotencyKey: string) {
    const [booking] = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId)))
      .limit(1);
    if (!booking) throw notFound('Booking order not found');

    const newTotal = toMinorUnits(booking.totalAmount) + amountDiff;
    await db
      .update(bookingOrders)
      .set({
        totalAmount: toDecimalString(newTotal),
        updatedAt: new Date()
      })
      .where(eq(bookingOrders.id, bookingOrderId));

    await new LedgerTransactionBuilder()
      .organization(tenantId)
      .type('BOOKING_UPGRADE')
      .totalAmount(amountDiff)
      .currencyCode(booking.currency)
      .reference('booking_order', bookingOrderId)
      .idempotency(idempotencyKey)
      .debit('SYSTEM_ADJUSTMENT', amountDiff, 'System Adjustment Account')
      .credit('PLATFORM_ESCROW', amountDiff, 'Platform Escrow Custody')
      .post();

    return { bookingOrderId, amountDiff, newTotal: toDecimalString(newTotal) };
  },

  async processBookingDowngrade(tenantId: string, bookingOrderId: string, amountDiff: number, idempotencyKey: string) {
    const [booking] = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId)))
      .limit(1);
    if (!booking) throw notFound('Booking order not found');

    const newTotal = Math.max(0, toMinorUnits(booking.totalAmount) - amountDiff);
    await db
      .update(bookingOrders)
      .set({
        totalAmount: toDecimalString(newTotal),
        updatedAt: new Date()
      })
      .where(eq(bookingOrders.id, bookingOrderId));

    await new LedgerTransactionBuilder()
      .organization(tenantId)
      .type('BOOKING_DOWNGRADE')
      .totalAmount(amountDiff)
      .currencyCode(booking.currency)
      .reference('booking_order', bookingOrderId)
      .idempotency(idempotencyKey)
      .debit('PLATFORM_ESCROW', amountDiff, 'Platform Escrow Custody')
      .credit('SYSTEM_ADJUSTMENT', amountDiff, 'System Adjustment Account')
      .post();

    return { bookingOrderId, amountDiff, newTotal: toDecimalString(newTotal) };
  },

  async processBookingReschedule(tenantId: string, bookingOrderId: string, changeFee: number, idempotencyKey: string) {
    const [booking] = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.id, bookingOrderId), eq(bookingOrders.tenantId, tenantId)))
      .limit(1);
    if (!booking) throw notFound('Booking order not found');

    if (changeFee > 0) {
      await new LedgerTransactionBuilder()
        .organization(tenantId)
        .type('BOOKING_RESCHEDULE_FEE')
        .totalAmount(changeFee)
        .currencyCode(booking.currency)
        .reference('booking_order', bookingOrderId)
        .idempotency(idempotencyKey)
        .debit('SYSTEM_ADJUSTMENT', changeFee, 'System Adjustment Account')
        .credit('PLATFORM_REVENUE', changeFee, 'Platform Commission Revenue')
        .post();
    }

    return { bookingOrderId, changeFee };
  }
};

