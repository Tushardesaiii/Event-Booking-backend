import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { emailOutboxOperationEnum, emailOutboxStatusEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { emailCampaigns } from './email-campaigns.js';
import { emailCampaignRecipients } from './email-campaign-recipients.js';
import { tenants } from './tenants.js';

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    campaignId: uuid('campaign_id').references(() => emailCampaigns.id, {
      onDelete: 'set null'
    }),
    recipientId: uuid('recipient_id').references(() => emailCampaignRecipients.id, {
      onDelete: 'set null'
    }),
    operation: emailOutboxOperationEnum('operation').notNull().default('campaign_send'),
    provider: text('provider').notNull().default('brevo'),
    status: emailOutboxStatusEnum('status').notNull().default('pending'),
    payloadJson: jsonb('payload_json').notNull().default(sql`'{}'::jsonb`),
    dedupeKey: text('dedupe_key').notNull(),
    correlationId: text('correlation_id').notNull(),
    requestId: text('request_id'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(5),
    availableAt: timestamp('available_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', {
      withTimezone: true,
      mode: 'date'
    }),
    processedAt: timestamp('processed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    lastError: text('last_error'),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_outbox_tenant_id_idx').on(table.tenantId),
    tenantStatusIdx: index('email_outbox_tenant_id_status_idx').on(table.tenantId, table.status),
    statusAvailableAtIdx: index('email_outbox_status_available_at_idx').on(table.status, table.availableAt),
    campaignIdx: index('email_outbox_campaign_id_idx').on(table.campaignId),
    recipientIdx: index('email_outbox_recipient_id_idx').on(table.recipientId),
    createdAtIdx: index('email_outbox_created_at_idx').on(table.createdAt),
    dedupeUnique: uniqueIndex('email_outbox_dedupe_key_unique').on(table.dedupeKey)
  })
);
