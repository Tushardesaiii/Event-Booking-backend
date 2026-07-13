import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const emailAuditLogs = pgTable(
  'email_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    action: text('action').notNull(), // e.g. send, unsubscribe, preference_change, suppression_add, webhook_received
    email: text('email').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_audit_logs_tenant_id_idx').on(table.tenantId),
    userIdx: index('email_audit_logs_user_id_idx').on(table.userId),
    emailIdx: index('email_audit_logs_email_idx').on(table.email),
    createdAtIdx: index('email_audit_logs_created_at_idx').on(table.createdAt)
  })
);
