import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { emailEventTypeEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { emailCampaigns } from './email-campaigns.js';
import { emailCampaignRecipients } from './email-campaign-recipients.js';
import { tenants } from './tenants.js';

export const emailEvents = pgTable(
  'email_events',
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
    providerEventId: text('provider_event_id').notNull(),
    eventType: emailEventTypeEnum('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_events_tenant_id_idx').on(table.tenantId),
    campaignIdx: index('email_events_campaign_id_idx').on(table.campaignId),
    recipientIdx: index('email_events_recipient_id_idx').on(table.recipientId),
    eventTypeIdx: index('email_events_event_type_idx').on(table.eventType),
    createdAtIdx: index('email_events_created_at_idx').on(table.createdAt),
    providerEventUnique: uniqueIndex('email_events_provider_event_id_unique').on(table.providerEventId)
  })
);
