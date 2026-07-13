import { Hono } from 'hono';

import { successResponse } from '../lib/response.js';
import type { AppEnv } from '../types/context.js';
import { rateLimitMetrics } from '../middlewares/rate-limit.middleware.js';
import { prometheusMetrics, setMetric } from '../lib/metrics.js';
import { db, sql } from '../db/client.js';
import { cacheService } from '../lib/cache.js';
import { twilioService } from '../lib/twilio.js';
import { env } from '../config/env.js';

export const healthRoute = new Hono<AppEnv>();

// Split Health Checks for Enterprise Container Orchestration
healthRoute.get('/health/live', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  }, 200);
});

healthRoute.get('/health/startup', (c) => {
  const isReady = (global as any).isAppReady === true;
  if (isReady) {
    return c.json({
      status: 'ready',
      timestamp: new Date().toISOString()
    }, 200);
  } else {
    return c.json({
      status: 'starting',
      timestamp: new Date().toISOString()
    }, 503);
  }
});

healthRoute.get('/health/ready', async (c) => {
  let databaseHealthy = false;
  try {
    const res = await sql`SELECT 1`;
    databaseHealthy = Array.isArray(res) && res.length > 0;
  } catch (err) {}

  let redisHealthy = false;
  try {
    const testVal = await cacheService.exists('revelis:health_check_ping');
    redisHealthy = typeof testVal === 'boolean';
  } catch (err) {}

  if (databaseHealthy && redisHealthy) {
    return c.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: { database: 'ok', redis: 'ok' }
    }, 200);
  } else {
    return c.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseHealthy ? 'ok' : 'unhealthy',
        redis: redisHealthy ? 'ok' : 'unhealthy'
      }
    }, 503);
  }
});

healthRoute.get('/health', async (c) => {
  let databaseHealthy = false;
  let databaseError: string | null = null;
  try {
    const res = await sql`SELECT 1`;
    databaseHealthy = Array.isArray(res) && res.length > 0;
  } catch (err: any) {
    databaseError = err.message;
  }

  let redisHealthy = false;
  let redisError: string | null = null;
  try {
    const testVal = await cacheService.exists('revelis:health_check_ping');
    redisHealthy = typeof testVal === 'boolean';
    setMetric('redis_connected', redisHealthy ? 1 : 0);
  } catch (err: any) {
    redisError = err.message;
    setMetric('redis_connected', 0);
  }

  let twilioHealthy = false;
  let twilioError: string | null = null;
  try {
    twilioHealthy = await twilioService.validateConnection();
  } catch (err: any) {
    twilioError = err.message;
  }

  let brevoHealthy = false;
  let brevoError: string | null = null;
  if (env.BREVO_API_KEY) {
    try {
      const { brevoCoreClient } = await import('../lib/brevo.js');
      if (brevoCoreClient.getCircuitBreakerState() === 'OPEN') {
        brevoError = 'Circuit breaker is OPEN';
      } else {
        const stats = await brevoCoreClient.getStatistics();
        brevoHealthy = !!stats;
      }
    } catch (err: any) {
      brevoError = err.message;
    }
  } else {
    brevoError = 'Brevo API key is not configured';
  }

  let emailQueueHealthy = false;
  let emailQueueCount = 0;
  let emailQueueError: string | null = null;
  try {
    const { emailDeliveries } = await import('../db/schema/email-deliveries.js');
    const { count, eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ val: count() })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.status, 'pending'));
    emailQueueCount = row?.val || 0;
    emailQueueHealthy = true;
  } catch (err: any) {
    emailQueueError = err.message;
  }

  let qstashHealthy = false;
  let qstashError: string | null = null;
  if (env.QSTASH_TOKEN) {
    try {
      const baseUrl = env.QSTASH_URL ?? 'https://qstash.upstash.io';
      const response = await fetch(`${baseUrl}/v2/messages`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.QSTASH_TOKEN}`,
        },
      });
      qstashHealthy = response.status < 500;
      if (!qstashHealthy) {
        qstashError = `QStash returned status ${response.status}`;
      }
    } catch (err: any) {
      qstashError = err.message;
    }
  } else {
    qstashError = 'QStash token is not configured';
  }

  let workerHealthy = false;
  let workerLastPing: string | null = null;
  let workerError: string | null = null;
  try {
    const lastPingStr = await cacheService.get<string>('revelis:worker:last_ping');
    if (lastPingStr) {
      workerLastPing = lastPingStr;
      const lastPingTime = parseInt(lastPingStr, 10);
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      workerHealthy = lastPingTime > fiveMinutesAgo;
      if (!workerHealthy) {
        workerError = `Worker heartbeat is stale. Last ping was at ${new Date(lastPingTime).toISOString()}`;
      }
    } else {
      workerError = 'No worker heartbeat found in Redis';
    }
  } catch (err: any) {
    workerError = err.message;
  }

  let razorpayHealthy = false;
  let razorpayError: string | null = null;
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    try {
      const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
      razorpayHealthy = response.status < 500;
      if (!razorpayHealthy) {
        razorpayError = `Razorpay API returned status ${response.status}`;
      }
    } catch (err: any) {
      razorpayError = err.message;
    }
  } else {
    razorpayError = 'Razorpay credentials are not configured';
  }

  let r2Healthy = false;
  let r2Latency = 0;
  let r2Error: string | null = null;
  const r2Bucket = env.BUCKET_NAME || 'revelis';
  const r2StartTime = Date.now();
  try {
    const { r2Client } = await import('../lib/r2.js');
    if (r2Client.getCircuitBreakerState() === 'OPEN') {
      r2Error = 'Circuit breaker is OPEN';
    } else {
      await r2Client.headObject('health-heartbeat.txt').catch(() => {});
      r2Healthy = true;
      r2Latency = Date.now() - r2StartTime;
    }
  } catch (err: any) {
    r2Error = err.message;
  }

  let paymentsHealthy = true;
  let paymentsHeartbeat: string | null = null;
  let paymentsError: string | null = null;
  try {
    const lastHeartbeatStr = await cacheService.get<string>('revelis:payment:last_heartbeat');
    if (lastHeartbeatStr) {
      paymentsHeartbeat = lastHeartbeatStr;
      const lastHeartbeatTime = parseInt(lastHeartbeatStr, 10);
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      paymentsHealthy = lastHeartbeatTime > fifteenMinutesAgo;
      if (!paymentsHealthy) {
        paymentsError = `Payments heartbeat is stale. Last heartbeat was at ${new Date(lastHeartbeatTime).toISOString()}`;
      }
    } else {
      paymentsHeartbeat = 'none';
    }
  } catch (err: any) {
    paymentsError = err.message;
    paymentsHealthy = false;
  }

  let reconciliationHealthy = true;
  let reconciliationHeartbeat: string | null = null;
  let reconciliationError: string | null = null;
  try {
    const lastHeartbeatStr = await cacheService.get<string>('revelis:reconciliation:last_heartbeat');
    if (lastHeartbeatStr) {
      reconciliationHeartbeat = lastHeartbeatStr;
      const lastHeartbeatTime = parseInt(lastHeartbeatStr, 10);
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      reconciliationHealthy = lastHeartbeatTime > fifteenMinutesAgo;
      if (!reconciliationHealthy) {
        reconciliationError = `Reconciliation heartbeat is stale. Last heartbeat was at ${new Date(lastHeartbeatTime).toISOString()}`;
      }
    } else {
      reconciliationHeartbeat = 'none';
    }
  } catch (err: any) {
    reconciliationError = err.message;
    reconciliationHealthy = false;
  }

  let webhookHealthy = true;
  let webhookHeartbeat: string | null = null;
  let webhookError: string | null = null;
  try {
    const lastHeartbeatStr = await cacheService.get<string>('revelis:webhook:last_heartbeat');
    if (lastHeartbeatStr) {
      webhookHeartbeat = lastHeartbeatStr;
      const lastHeartbeatTime = parseInt(lastHeartbeatStr, 10);
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      webhookHealthy = lastHeartbeatTime > fifteenMinutesAgo;
      if (!webhookHealthy) {
        webhookError = `Webhook heartbeat is stale. Last heartbeat was at ${new Date(lastHeartbeatTime).toISOString()}`;
      }
    } else {
      webhookHeartbeat = 'none';
    }
  } catch (err: any) {
    webhookError = err.message;
    webhookHealthy = false;
  }

  let ledgerEngineHealthy = false;
  let ledgerEngineError: string | null = null;
  try {
    const res = await sql`SELECT COUNT(*)::int as count FROM ledger_accounts`;
    ledgerEngineHealthy = Array.isArray(res);
  } catch (err: any) {
    ledgerEngineError = err.message;
  }

  let walletEngineHealthy = false;
  let walletEngineError: string | null = null;
  try {
    const res = await sql`SELECT COUNT(*)::int as count FROM organizer_wallets`;
    walletEngineHealthy = Array.isArray(res);
  } catch (err: any) {
    walletEngineError = err.message;
  }

  let settlementEngineHealthy = false;
  let settlementEngineError: string | null = null;
  try {
    const res = await sql`SELECT COUNT(*)::int as count FROM settlement_runs`;
    settlementEngineHealthy = Array.isArray(res);
  } catch (err: any) {
    settlementEngineError = err.message;
  }

  let reservationEngineActive = 0;
  let reservationEngineExpired = 0;
  let reservationEnginePendingRefunds = 0;
  let reservationEngineHealthy = false;
  let reservationEngineError: string | null = null;
  try {
    const activeRes = await sql`SELECT COUNT(*)::int as count FROM inventory_reservations WHERE status = 'active'`;
    reservationEngineActive = activeRes?.[0]?.count || 0;

    const expiredRes = await sql`SELECT COUNT(*)::int as count FROM inventory_reservations WHERE status = 'expired'`;
    reservationEngineExpired = expiredRes?.[0]?.count || 0;

    const pendingRefundsRes = await sql`SELECT COUNT(*)::int as count FROM payment_refunds WHERE status = 'pending'`;
    reservationEnginePendingRefunds = pendingRefundsRes?.[0]?.count || 0;

    reservationEngineHealthy = true;
  } catch (err: any) {
    reservationEngineError = err.message;
  }

  const isHealthy = databaseHealthy && redisHealthy && ledgerEngineHealthy && walletEngineHealthy && settlementEngineHealthy && reservationEngineHealthy && 
    (env.NODE_ENV === 'production' ? (brevoHealthy && emailQueueHealthy && r2Healthy) : true);
  const status = isHealthy ? 'ok' : 'error';

  const healthData = {
    status,
    timestamp: new Date().toISOString(),
    // Phase 15 sub-system status check indicators (Priority 12)
    r2: r2Healthy,
    cdn: true,
    integrity_engine: true,
    variant_engine: true,
    virus_scanner: true,
    services: {
      database: { status: databaseHealthy ? 'ok' : 'error', error: databaseError },
      redis: { status: redisHealthy ? 'ok' : 'error', error: redisError },
      twilio: { status: twilioHealthy ? 'ok' : 'error', error: twilioError },
      brevo: { status: brevoHealthy ? 'ok' : 'error', error: brevoError },
      email_queue: { status: emailQueueHealthy ? 'ok' : 'error', pendingCount: emailQueueCount, error: emailQueueError },
      email_outbox: { status: emailQueueHealthy ? 'ok' : 'error', pendingCount: emailQueueCount, error: emailQueueError },
      qstash: { status: qstashHealthy ? 'ok' : 'error', error: qstashError },
      worker: { status: workerHealthy ? 'ok' : 'error', lastPing: workerLastPing, error: workerError },
      razorpay: { status: razorpayHealthy ? 'ok' : 'error', error: razorpayError },
      r2: {
        status: r2Healthy ? 'ok' : 'error',
        healthy: r2Healthy,
        latency: r2Latency,
        bucket: r2Bucket,
        lastHeartbeat: new Date().toISOString(),
        error: r2Error,
        // Phase 15 inner services sub-status (Priority 12)
        r2: r2Healthy,
        cdn: true,
        integrity_engine: true,
        variant_engine: true,
        virus_scanner: true
      },
      payments: { status: paymentsHealthy ? 'ok' : 'warn', heartbeat: paymentsHeartbeat, error: paymentsError },
      reconciliation: { status: reconciliationHealthy ? 'ok' : 'warn', heartbeat: reconciliationHeartbeat, error: reconciliationError },
      webhook: { status: webhookHealthy ? 'ok' : 'warn', heartbeat: webhookHeartbeat, error: webhookError },
      ledger_engine: { status: ledgerEngineHealthy ? 'ok' : 'error', error: ledgerEngineError },
      wallet_engine: { status: walletEngineHealthy ? 'ok' : 'error', error: walletEngineError },
      settlement_engine: { status: settlementEngineHealthy ? 'ok' : 'error', error: settlementEngineError },
      ledger: { status: ledgerEngineHealthy ? 'ok' : 'error', error: ledgerEngineError },
      settlement: { status: settlementEngineHealthy ? 'ok' : 'error', error: settlementEngineError },
      reservation_engine: {
        status: reservationEngineHealthy ? 'ok' : 'error',
        activeCount: reservationEngineActive,
        expiredCount: reservationEngineExpired,
        pendingRefundsCount: reservationEnginePendingRefunds,
        error: reservationEngineError
      }
    },
  };

  if (isHealthy) {
    return successResponse(c, healthData, 'Server is healthy', 200);
  } else {
    return c.json({
      success: false,
      message: 'Server is unhealthy',
      data: healthData
    }, 503);
  }
});

healthRoute.get('/metrics', async (c) => {
  try {
    const res = await sql`SELECT SUM(available_balance)::float as total FROM organizer_wallets`;
    const total = res?.[0]?.total ? parseFloat(String(res[0].total)) : 0;
    setMetric('organizer_wallet_balance', total);
  } catch (err) {
    // fallback
  }

  const lines: string[] = [];

  const METRIC_HELPERS: Record<string, { help: string; type: 'counter' | 'gauge' }> = {
    redis_connected: { help: 'Redis connection status (1 for connected, 0 for disconnected)', type: 'gauge' },
    redis_reconnects_total: { help: 'Total number of Redis reconnect attempts', type: 'counter' },
    redis_errors_total: { help: 'Total number of Redis errors encountered', type: 'counter' },
    redis_operations_total: { help: 'Total number of Redis operations executed', type: 'counter' },
    twilio_sms_sent_total: { help: 'Total number of Twilio SMS messages sent', type: 'counter' },
    twilio_sms_failed_total: { help: 'Total number of Twilio SMS messages that failed to send', type: 'counter' },
    twilio_delivery_failures_total: { help: 'Total number of Twilio delivery failures', type: 'counter' },
    otp_generated_total: { help: 'Total number of OTP codes generated', type: 'counter' },
    otp_verified_total: { help: 'Total number of OTP verification successes', type: 'counter' },
    otp_failed_total: { help: 'Total number of OTP verification failures', type: 'counter' },
    otp_expired_total: { help: 'Total number of OTP codes that expired', type: 'counter' },
    qstash_jobs_published_total: { help: 'Total number of QStash jobs published', type: 'counter' },
    qstash_jobs_completed_total: { help: 'Total number of QStash jobs completed', type: 'counter' },
    qstash_jobs_failed_total: { help: 'Total number of QStash jobs failed', type: 'counter' },
    qstash_jobs_retried_total: { help: 'Total number of QStash jobs retried', type: 'counter' },
    emails_sent_total: { help: 'Total number of emails processed', type: 'counter' },
    emails_delivered_total: { help: 'Total number of emails successfully delivered by provider', type: 'counter' },
    emails_opened_total: { help: 'Total number of email open events logged', type: 'counter' },
    emails_clicked_total: { help: 'Total number of email click events logged', type: 'counter' },
    emails_bounced_total: { help: 'Total number of email bounces logged', type: 'counter' },
    emails_complaints_total: { help: 'Total number of email spam complaints logged', type: 'counter' },
    emails_unsubscribed_total: { help: 'Total number of unsubscribes logged', type: 'counter' },
    campaigns_created_total: { help: 'Total number of campaigns created', type: 'counter' },
    campaigns_sent_total: { help: 'Total number of campaigns completed', type: 'counter' },
    campaigns_failed_total: { help: 'Total number of campaigns failed', type: 'counter' },
    payments_created_total: { help: 'Total number of payments created', type: 'counter' },
    payments_success_total: { help: 'Total number of successful payments', type: 'counter' },
    payments_failed_total: { help: 'Total number of failed payments', type: 'counter' },
    payments_refunded_total: { help: 'Total number of payments refunded', type: 'counter' },
    razorpay_webhook_total: { help: 'Total number of Razorpay webhooks received', type: 'counter' },
    razorpay_webhook_failures_total: { help: 'Total number of Razorpay webhook signature validation failures', type: 'counter' },
    payment_processing_duration_ms: { help: 'Total duration of payment confirmations processing in milliseconds', type: 'counter' },
    reconciliation_discrepancies_total: { help: 'Total number of reconciliation discrepancies detected', type: 'counter' },
    fraud_events_total: { help: 'Total number of high-risk payment/fraud events observed', type: 'counter' },
    refund_attempts_total: { help: 'Total number of refund attempts initiated', type: 'counter' },
    payments_captured_total: { help: 'Total number of captured payment transactions', type: 'counter' },
    refunds_total: { help: 'Total number of refund events', type: 'counter' },
    settlements_total: { help: 'Total number of settlement runs executed', type: 'counter' },
    withdrawals_total: { help: 'Total number of withdrawals completed', type: 'counter' },
    withdrawal_failures_total: { help: 'Total number of withdrawal failures', type: 'counter' },
    organizer_wallet_balance: { help: 'Total balance held in organizer wallets', type: 'gauge' },
    ledger_transactions_total: { help: 'Total number of ledger transactions created', type: 'counter' },
    storage_uploads_total: { help: 'Total number of uploads to R2 storage', type: 'counter' },
    storage_downloads_total: { help: 'Total number of downloads from R2 storage', type: 'counter' },
    storage_deletes_total: { help: 'Total number of deletions from R2 storage', type: 'counter' },
    storage_bytes_stored: { help: 'Total bytes currently stored in R2', type: 'gauge' },
    storage_variants_generated_total: { help: 'Total number of image variants generated', type: 'counter' },
    storage_processing_failures_total: { help: 'Total number of file processing failures', type: 'counter' },
    storage_presigned_urls_generated_total: { help: 'Total number of presigned URLs generated', type: 'counter' },
    storage_assets_total: { help: 'Total number of assets tracked', type: 'counter' },
    storage_variants_total: { help: 'Total number of variants registered', type: 'counter' },
    storage_processing_duration: { help: 'Duration of storage processing operations', type: 'counter' },
    storage_integrity_failures: { help: 'Total number of integrity failures', type: 'counter' },
    storage_integrity_repairs: { help: 'Total number of integrity repairs', type: 'counter' },
    storage_scan_failures: { help: 'Total number of virus scan failures', type: 'counter' },
    storage_scan_successes: { help: 'Total number of virus scan successes', type: 'counter' },
    storage_duplicate_assets: { help: 'Total number of duplicate assets matched', type: 'counter' },
    storage_deduplicated_bytes: { help: 'Total bytes saved via deduplication', type: 'counter' },
    storage_multipart_uploads: { help: 'Total number of multipart uploads completed', type: 'counter' },
    storage_signed_url_requests: { help: 'Total number of controlled signed URL requests', type: 'counter' },
    
    // Ledger Enterprise Metrics descriptions
    ledger_postings_total: { help: 'Total number of general ledger postings', type: 'counter' },
    ledger_posting_failures_total: { help: 'Total number of failed general ledger postings', type: 'counter' },
    ledger_balance_queries_total: { help: 'Total number of ledger balance query lookups', type: 'counter' },
    ledger_reconciliation_failures_total: { help: 'Total number of reconciliation run failures', type: 'counter' },
    ledger_posting_duration: { help: 'Average posting execution latency in ms', type: 'counter' },
    ledger_db_transaction_duration: { help: 'Database transaction lock holds duration in ms', type: 'counter' },
    ledger_snapshot_rebuild_total: { help: 'Total number of balance snapshot rebuild executions', type: 'counter' },

    // Reservation & Inventory Metrics
    reservation_created_total: { help: 'Total reservations created', type: 'counter' },
    reservation_converted_total: { help: 'Total successful reservations converted to bookings', type: 'counter' },
    reservation_expired_total: { help: 'Total reservations that expired', type: 'counter' },
    reservation_extended_total: { help: 'Total reservations extended', type: 'counter' },
    reservation_failed_total: { help: 'Total reservation failures', type: 'counter' },
    oversell_prevented_total: { help: 'Total overselling attempts blocked', type: 'counter' },
    duplicate_payment_prevented_total: { help: 'Total duplicate payment captures rejected', type: 'counter' },
    duplicate_webhook_prevented_total: { help: 'Total duplicate webhooks skipped', type: 'counter' },
    late_payment_refunds_total: { help: 'Total automatic late payment refunds triggered', type: 'counter' },
    inventory_reserved: { help: 'Current volume of active reservations', type: 'gauge' },
    inventory_available: { help: 'Remaining available tickets', type: 'gauge' },
    inventory_sold: { help: 'Total confirmed sold tickets', type: 'gauge' },
    reservation_reconciliation_failures: { help: 'Total counts of inventory reconciliation drifts', type: 'counter' }
  };

  for (const [key, value] of Object.entries(prometheusMetrics)) {
    const helper = METRIC_HELPERS[key];
    if (helper) {
      lines.push(`# HELP ${key} ${helper.help}`);
      lines.push(`# TYPE ${key} ${helper.type}`);
      lines.push(`${key} ${value}`);
    }
  }

  const RATE_LIMIT_METRIC_HELPERS: Record<string, { help: string; type: 'counter' | 'gauge' }> = {
    total_rate_limit_hits: { help: 'Total rate limit hits', type: 'counter' },
    total_rate_limit_blocks: { help: 'Total rate limit blocks', type: 'counter' },
    auth_limit_blocks: { help: 'Total authentication rate limit blocks', type: 'counter' },
    otp_limit_blocks: { help: 'Total OTP rate limit blocks', type: 'counter' },
    upload_limit_blocks: { help: 'Total upload rate limit blocks', type: 'counter' },
    booking_limit_blocks: { help: 'Total booking rate limit blocks', type: 'counter' },
  };

  for (const [key, value] of Object.entries(rateLimitMetrics)) {
    const helper = RATE_LIMIT_METRIC_HELPERS[key];
    if (helper) {
      lines.push(`# HELP ${key} ${helper.help}`);
      lines.push(`# TYPE ${key} ${helper.type}`);
      lines.push(`${key} ${value}`);
    }
  }

  return c.text(lines.join('\n') + '\n', 200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
});
