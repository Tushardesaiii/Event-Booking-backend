import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { env } from '../config/env.js';
import { logger } from './logger.js';
import { r2Client } from './r2.js';

const execAsync = promisify(exec);

/**
 * Create a logical (pg_dump custom-format) database backup and upload it to R2
 * under the `backups/` prefix. Intended to be driven by the recurring `db_backup`
 * QStash schedule. Requires the `pg_dump` binary to be available on PATH (the
 * production image installs `postgresql-client`).
 *
 * This is a SECONDARY safety net. The primary recovery strategy for a financial
 * platform should be the managed database provider's PITR/WAL archiving — see the
 * README "Backups & Recovery" section.
 */
export async function runDatabaseBackup(): Promise<{ key: string; bytes: number }> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set; cannot run backup');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempFile = path.join(os.tmpdir(), `revelis-backup-${timestamp}.dump`);
  const key = `backups/revelis-${timestamp}.dump`;

  logger.info('[Backup] Starting pg_dump', { tempFile });

  try {
    // -F c: compressed custom format; -b: include large objects.
    await execAsync(`pg_dump "${env.DATABASE_URL}" -F c -b -f "${tempFile}"`, {
      maxBuffer: 1024 * 1024 * 64,
    });

    const buffer = await fs.promises.readFile(tempFile);
    await r2Client.uploadBuffer(key, buffer, 'application/octet-stream');

    logger.info('[Backup] Uploaded database backup to R2', { key, bytes: buffer.length });
    return { key, bytes: buffer.length };
  } finally {
    await fs.promises.unlink(tempFile).catch(() => {});
  }
}
