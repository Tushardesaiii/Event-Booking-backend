import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    recipientEmail: text('recipient_email').notNull(),
    subject: text('subject').notNull(),
    htmlContent: text('html_content').notNull(),
    textContent: text('text_content'),
    category: text('category').notNull(), // transactional, security, billing, system, marketing, campaign, notification
    status: text('status').notNull().default('pending'), // pending, processing, sent, delivered, failed
    providerMessageId: text('provider_message_id'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(5),
    lastError: text('last_error'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    sentAt: timestamp('sent_at', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_deliveries_tenant_id_idx').on(table.tenantId),
    userIdx: index('email_deliveries_user_id_idx').on(table.userId),
    emailIdx: index('email_deliveries_recipient_email_idx').on(table.recipientEmail),
    createdAtIdx: index('email_deliveries_created_at_idx').on(table.createdAt),
    providerMsgIdx: index('email_deliveries_provider_message_id_idx').on(table.providerMessageId),
    statusIdx: index('email_deliveries_status_idx').on(table.status)
  })
);
