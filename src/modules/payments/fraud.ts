import { db } from '../../db/client.js';
import { and, eq, gte, sql } from 'drizzle-orm';
import { paymentOrders, paymentTransactions, paymentRefunds, paymentRiskEvents } from '../../db/schema/payments.js';
import { users } from '../../db/schema/users.js';
import { incrementMetric } from '../../lib/metrics.js';
import { logger } from '../../lib/logger.js';

/**
 * Evaluates payment risk signals based on past transactions, cards, phone numbers, and burst rates.
 * Writes observed anomalies to the payment_risk_events table.
 */
export async function evaluateRisk(params: {
  tenantId: string;
  userId: string;
  ipAddress?: string | null;
}) {
  const { tenantId, userId, ipAddress } = params;
  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
  const oneMinAgo = new Date(Date.now() - 60 * 1000);

  let score = 0;
  const reasons: string[] = [];
  const details: Record<string, any> = {};

  try {
    // 1. Excessive payment failures (past 15 mins)
    const [failuresResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.createdBy, userId),
          eq(paymentOrders.tenantId, tenantId),
          eq(paymentOrders.status, 'failed'),
          gte(paymentOrders.createdAt, fifteenMinsAgo)
        )
      );
    const failureCount = failuresResult?.count ?? 0;
    if (failureCount >= 3) {
      score += 30;
      reasons.push(`Excessive payment failures (${failureCount} failed orders in 15m)`);
      details.failureCount = failureCount;
    }

    // 2. Excessive refund requests (past 15 mins in tenant)
    const [refundsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentRefunds)
      .where(
        and(
          eq(paymentRefunds.tenantId, tenantId),
          gte(paymentRefunds.createdAt, fifteenMinsAgo)
        )
      );
    const refundCount = refundsResult?.count ?? 0;
    if (refundCount >= 5) {
      score += 20;
      reasons.push(`Excessive refund requests (${refundCount} refunds processed in tenant in 15m)`);
      details.refundCount = refundCount;
    }

    // 3. Multiple cards on same account (past 24 hours)
    const distinctCardsResult = await db
      .select({
        cardId: sql<string>`(gateway_response->'card'->>'id')`
      })
      .from(paymentTransactions)
      .innerJoin(paymentOrders, eq(paymentOrders.id, paymentTransactions.paymentOrderId))
      .where(
        and(
          eq(paymentOrders.createdBy, userId),
          eq(paymentTransactions.status, 'captured'),
          gte(paymentTransactions.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
        )
      );
    const cardIds = distinctCardsResult.map(c => c.cardId).filter(Boolean);
    const uniqueCardsCount = new Set(cardIds).size;
    if (uniqueCardsCount >= 3) {
      score += 40;
      reasons.push(`Multiple cards used on same account (${uniqueCardsCount} distinct cards in 24h)`);
      details.uniqueCardsCount = uniqueCardsCount;
    }

    // 4. Multiple accounts on same phone
    const [user] = await db
      .select({ phoneNumber: users.phoneNumber })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.phoneNumber) {
      const [phoneUsersResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.phoneNumber, user.phoneNumber));
      const phoneUsersCount = phoneUsersResult?.count ?? 0;
      if (phoneUsersCount >= 2) {
        score += 25;
        reasons.push(`Multiple accounts linked to same phone number (${phoneUsersCount} accounts)`);
        details.phoneUsersCount = phoneUsersCount;
      }
    }

    // 5. Rapid checkout bursts (past 1 min)
    const [burstResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.createdBy, userId),
          gte(paymentOrders.createdAt, oneMinAgo)
        )
      );
    const burstCount = burstResult?.count ?? 0;
    if (burstCount >= 5) {
      score += 35;
      reasons.push(`Rapid checkout bursts (${burstCount} orders created in 1m)`);
      details.burstCount = burstCount;
    }

    // Record risk event if any score is triggered
    if (score > 0) {
      logger.warn('[FraudDetection] Fraud risk event generated', { userId, tenantId, score, reasons });
      await db.insert(paymentRiskEvents).values({
        tenantId,
        userId,
        score,
        reason: reasons.join('; '),
        metadata: {
          details,
          ipAddress: ipAddress ?? null
        }
      });
      incrementMetric('fraud_events_total');
    }
  } catch (error: any) {
    logger.error('[FraudDetection] Error executing risk assessment', { error: error.message });
  }

  return { score, reasons };
}
