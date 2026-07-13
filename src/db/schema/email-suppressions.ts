import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { timestampColumns } from './helpers.js';
import { emailCampaigns } from './email-campaigns.js';
import { emailSubscribers } from './email-subscribers.js';
import { tenants } from './tenants.js';

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    subscriberId: uuid('subscriber_id').references(() => emailSubscribers.id, {
      onDelete: 'set null'
    }),
    campaignId: uuid('campaign_id').references(() => emailCampaigns.id, {
      onDelete: 'set null'
    }),
    email: text('email').notNull(),
    reason: text('reason').notNull(), // unsubscribe, bounce, complaint, manual
    scope: text('scope').notNull().default('individual'), // individual, domain
    provider: text('provider'),
    source: text('source').notNull().default('system'), // user_action, webhook_sync, manual
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_suppressions_tenant_id_idx').on(table.tenantId),
    tenantReasonIdx: index('email_suppressions_tenant_id_reason_idx').on(table.tenantId, table.reason),
    tenantEmailUnique: uniqueIndex('email_suppressions_tenant_id_email_unique').on(table.tenantId, table.email),
    createdAtIdx: index('email_suppressions_created_at_idx').on(table.createdAt)
  })
);
