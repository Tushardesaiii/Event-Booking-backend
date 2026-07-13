import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { emailCampaignRecipientStatusEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { emailCampaigns } from './email-campaigns.js';
import { emailSubscribers } from './email-subscribers.js';
import { tenants } from './tenants.js';

export const emailCampaignRecipients = pgTable(
  'email_campaign_recipients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, {
      onDelete: 'restrict'
    }),
    subscriberId: uuid('subscriber_id').notNull().references(() => emailSubscribers.id, {
      onDelete: 'restrict'
    }),
    status: emailCampaignRecipientStatusEnum('status').notNull().default('pending'),
    providerMessageId: text('provider_message_id'),
    providerBatchId: text('provider_batch_id'),
    deliveredAt: timestamp('delivered_at', {
      withTimezone: true,
      mode: 'date'
    }),
    openedAt: timestamp('opened_at', {
      withTimezone: true,
      mode: 'date'
    }),
    clickedAt: timestamp('clicked_at', {
      withTimezone: true,
      mode: 'date'
    }),
    bouncedAt: timestamp('bounced_at', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_campaign_recipients_tenant_id_idx').on(table.tenantId),
    campaignIdx: index('email_campaign_recipients_campaign_id_idx').on(table.campaignId),
    campaignStatusIdx: index('email_campaign_recipients_campaign_id_status_idx').on(table.campaignId, table.status),
    subscriberIdx: index('email_campaign_recipients_subscriber_id_idx').on(table.subscriberId),
    createdAtIdx: index('email_campaign_recipients_created_at_idx').on(table.createdAt),
    campaignSubscriberUnique: uniqueIndex('email_campaign_recipients_campaign_id_subscriber_id_unique').on(table.campaignId, table.subscriberId)
  })
);
