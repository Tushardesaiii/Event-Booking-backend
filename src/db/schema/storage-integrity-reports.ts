import { integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const storageIntegrityReports = pgTable(
  'storage_integrity_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    anomaliesFound: jsonb('anomalies_found').notNull().default(sql`'[]'::jsonb`),
    repairedRecords: jsonb('repaired_records').notNull().default(sql`'[]'::jsonb`),
    unrecoverableAssets: jsonb('unrecoverable_assets').notNull().default(sql`'[]'::jsonb`),
    executionDurationMs: integer('execution_duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  }
);
