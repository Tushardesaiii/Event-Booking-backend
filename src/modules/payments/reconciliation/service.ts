import { db } from '../../../db/client.js';
import { and, eq, gte } from 'drizzle-orm';
import { paymentTransactions, paymentRefunds } from '../../../db/schema/payments.js';
import { razorpayClient } from '../../../lib/razorpay.js';
import { reconciliationRepository } from './repository.js';
import { logPaymentAudit } from '../audit.js';
import { incrementMetric } from '../../../lib/metrics.js';
import { logger } from '../../../lib/logger.js';
import { cacheService } from '../../../lib/cache.js';

export const reconciliationService = {
  /**
   * Runs the reconciliation engine comparing local transaction records
   * against Razorpay records from the past 24 hours.
   */
  async runReconciliation(tenantId: string, actorUserId: string) {
    logger.info('[ReconciliationService] Running reconciliation pass for tenant', { tenantId });
    
    // Update reconciliation poller heartbeat
    await cacheService.set('revelis:reconciliation:last_heartbeat', String(Date.now()));

    const past24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Fetch local transactions in past 24h
    const localTxs = await db
      .select({
        id: paymentTransactions.id,
        razorpayPaymentId: paymentTransactions.razorpayPaymentId,
        amount: paymentTransactions.amount,
        currency: paymentTransactions.currency,
        status: paymentTransactions.status,
        paymentOrderId: paymentTransactions.paymentOrderId
      })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.tenantId, tenantId), gte(paymentTransactions.createdAt, past24Hours)));

    // 2. Fetch local refunds in past 24h
    const localRefunds = await db
      .select({
        id: paymentRefunds.id,
        razorpayRefundId: paymentRefunds.razorpayRefundId,
        amount: paymentRefunds.amount,
        paymentTransactionId: paymentRefunds.paymentTransactionId,
        status: paymentRefunds.status
      })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.tenantId, tenantId), gte(paymentRefunds.createdAt, past24Hours)));

    // 3. Fetch Razorpay records (payments and refunds)
    const rzpPaymentsResponse = await razorpayClient.listPayments({ count: 100 });
    const rzpRefundsResponse = await razorpayClient.listRefunds({ count: 100 });

    const rzpPayments = rzpPaymentsResponse?.items || [];
    const rzpRefunds = rzpRefundsResponse?.items || [];

    const anomalies: any[] = [];

    // Map local records for quick lookup
    const localTxMap = new Map<string, typeof localTxs[0]>();
    const localTxDupSet = new Set<string>();
    for (const tx of localTxs) {
      if (localTxMap.has(tx.razorpayPaymentId)) {
        localTxDupSet.add(tx.razorpayPaymentId);
      } else {
        localTxMap.set(tx.razorpayPaymentId, tx);
      }
    }

    const localRefundMap = new Map<string, typeof localRefunds[0]>();
    for (const ref of localRefunds) {
      localRefundMap.set(ref.razorpayRefundId, ref);
    }

    // Map Razorpay records for lookup
    const rzpPaymentMap = new Map<string, any>();
    for (const rzpPayment of rzpPayments) {
      rzpPaymentMap.set(rzpPayment.id, rzpPayment);
    }

    const rzpRefundMap = new Map<string, any>();
    for (const rzpRefund of rzpRefunds) {
      rzpRefundMap.set(rzpRefund.id, rzpRefund);
    }

    // Rule 1: Compare local captures against Razorpay payments
    for (const rzpPayment of rzpPayments) {
      if (rzpPayment.status !== 'captured') continue;

      const localTx = localTxMap.get(rzpPayment.id);

      if (!localTx) {
        // Missing Capture / Orphaned payment on Razorpay side
        anomalies.push({
          discrepancyType: 'missing_capture',
          razorpayPaymentId: rzpPayment.id,
          paymentTransactionId: null,
          details: {
            message: 'Payment captured on Razorpay but missing in local transactions database',
            rzpPayment
          }
        });
      } else {
        // Compare amounts (Razorpay is in minor units; local is in decimal format)
        const localAmountMinor = Math.round(parseFloat(localTx.amount) * 100);
        const rzpAmountMinor = rzpPayment.amount;

        if (localAmountMinor !== rzpAmountMinor) {
          anomalies.push({
            discrepancyType: 'amount_mismatch',
            razorpayPaymentId: rzpPayment.id,
            paymentTransactionId: localTx.id,
            details: {
              message: 'Amount mismatch detected between local and Razorpay records',
              localAmount: localTx.amount,
              rzpAmount: rzpAmountMinor / 100
            }
          });
        }

        // Compare currencies
        if (localTx.currency.toUpperCase() !== rzpPayment.currency.toUpperCase()) {
          anomalies.push({
            discrepancyType: 'currency_mismatch',
            razorpayPaymentId: rzpPayment.id,
            paymentTransactionId: localTx.id,
            details: {
              message: 'Currency mismatch detected between local and Razorpay records',
              localCurrency: localTx.currency,
              rzpCurrency: rzpPayment.currency
            }
          });
        }
      }
    }

    // Rule 2: Detect Duplicate Captures
    for (const dupId of localTxDupSet) {
      const tx = localTxMap.get(dupId);
      anomalies.push({
        discrepancyType: 'duplicate_capture',
        razorpayPaymentId: dupId,
        paymentTransactionId: tx?.id || null,
        details: {
          message: 'Multiple transaction records exist locally for the same Razorpay Payment ID',
          duplicateId: dupId
        }
      });
    }

    // Rule 3: Orphaned local transactions (captured locally but not captured/found on Razorpay)
    for (const tx of localTxs) {
      if (tx.status !== 'captured') continue;
      const rzpPayment = rzpPaymentMap.get(tx.razorpayPaymentId);
      if (!rzpPayment) {
        anomalies.push({
          discrepancyType: 'orphaned_payment',
          razorpayPaymentId: tx.razorpayPaymentId,
          paymentTransactionId: tx.id,
          details: {
            message: 'Transaction marked captured locally but not found in Razorpay records'
          }
        });
      }
    }

    // Rule 4: Orphaned refunds (refunded on Razorpay but missing locally)
    for (const rzpRefund of rzpRefunds) {
      if (rzpRefund.status !== 'processed') continue;
      const localRefund = localRefundMap.get(rzpRefund.id);
      if (!localRefund) {
        anomalies.push({
          discrepancyType: 'orphaned_refund',
          razorpayPaymentId: rzpRefund.payment_id,
          details: {
            message: 'Refund processed on Razorpay but missing in local refunds database',
            rzpRefund
          }
        });
      }
    }

    // Persist reports
    const createdReports = [];
    if (anomalies.length > 0) {
      logger.warn('[ReconciliationService] Discrepancies detected during reconciliation', { anomaliesCount: anomalies.length });
      for (const anomaly of anomalies) {
        const report = await reconciliationRepository.createReport(db, {
          tenantId,
          paymentTransactionId: anomaly.paymentTransactionId,
          razorpayPaymentId: anomaly.razorpayPaymentId,
          discrepancyType: anomaly.discrepancyType,
          details: anomaly.details
        });
        createdReports.push(report);
        incrementMetric('reconciliation_discrepancies_total');
      }
    }

    // Write audit log trail
    await logPaymentAudit(db, {
      actorId: actorUserId,
      tenantId,
      entityType: 'reconciliation_report',
      entityId: tenantId,
      action: 'reconcile',
      metadata: {
        reconciledAt: new Date().toISOString(),
        anomaliesCount: anomalies.length,
        localTxsCount: localTxs.length,
        localRefundsCount: localRefunds.length
      }
    });

    return {
      success: true,
      anomaliesCount: anomalies.length,
      reports: createdReports
    };
  }
};
