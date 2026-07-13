import { qstashService } from '../lib/qstash.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Recurring maintenance / financial-integrity jobs. These MUST run on a schedule
 * in production; previously they depended on out-of-band Upstash dashboard config
 * that could not be verified from source (audit B8). We now register them in code
 * at boot, idempotently, so a fresh deployment is self-sufficient.
 *
 * Each entry posts `{ jobType, data }` to the `/qstash/jobs` inbound handler, the
 * same contract used by ad-hoc publishes. Handlers with no `tenantId` in `data`
 * sweep every tenant (see qstash.route.ts).
 */
interface ScheduledJob {
  name: string;
  cron: string;
  jobType: string;
  data?: Record<string, unknown>;
}

const SCHEDULED_JOBS: ScheduledJob[] = [
  // Release expired holds so inventory is not leaked. Every 5 minutes.
  { name: 'expire-reservations', cron: '*/5 * * * *', jobType: 'expire_reservations' },
  // Repair any cached sold/reserved drift against the derived source of truth. Hourly.
  { name: 'reconcile-inventory', cron: '0 * * * *', jobType: 'reconcile_inventory' },
  // Flush the transactional email outbox (covers scale-to-zero where the in-process
  // worker is frozen). Every minute.
  { name: 'email-outbox', cron: '* * * * *', jobType: 'process_email_outbox' },
  // Clean up orphaned/incomplete storage objects. Daily at 02:00.
  { name: 'cleanup-orphans', cron: '0 2 * * *', jobType: 'cleanup_orphans' },
  // Verify stored-object integrity (checksums). Daily at 03:00.
  { name: 'verify-storage-integrity', cron: '0 3 * * *', jobType: 'verify_storage_integrity' },
  // Financial reconciliation + ledger integrity. Daily at 04:00.
  { name: 'financial-reconciliation', cron: '0 4 * * *', jobType: 'financial_reconciliation' },
  // Logical database backup. Daily at 01:00.
  { name: 'db-backup', cron: '0 1 * * *', jobType: 'db_backup' },
];

/**
 * Register (idempotently) every recurring schedule. Best-effort: a failure to
 * register one schedule is logged but never blocks startup.
 */
export async function registerRecurringSchedules(): Promise<void> {
  if (!env.QSTASH_TOKEN) {
    logger.warn('[Schedules] QSTASH_TOKEN not set — recurring jobs will NOT run. Set it in production.');
    return;
  }

  const base = env.EMAIL_PUBLIC_URL.replace(/\/+$/, '');
  const destination = `${base}/qstash/jobs`;

  for (const job of SCHEDULED_JOBS) {
    try {
      const id = await qstashService.ensureSchedule(job.cron, destination, {
        jobType: job.jobType,
        data: job.data ?? {},
      });
      if (id) {
        logger.info('[Schedules] Ensured recurring job', { name: job.name, cron: job.cron, scheduleId: id });
      }
    } catch (err: any) {
      logger.error('[Schedules] Failed to register recurring job', { name: job.name, error: err.message });
    }
  }
}
