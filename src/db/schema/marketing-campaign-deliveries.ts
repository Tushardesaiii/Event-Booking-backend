import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { marketingCampaigns } from './marketing-campaigns.js';
import { marketingSubscribers } from './marketing-subscribers.js';
import { timestampColumns } from './helpers.js';

export const marketingCampaignDeliveries = pgTable(
  'marketing_campaign_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull().references(() => marketingCampaigns.id, { onDelete: 'restrict' }),
    subscriberId: uuid('subscriber_id').notNull().references(() => marketingSubscribers.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    providerMessageId: text('provider_message_id'),
    deliveryStatus: text('delivery_status').notNull(), // 'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed'
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }),
    clickedAt: timestamp('clicked_at', { withTimezone: true, mode: 'date' }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true, mode: 'date' }),
    metadata: jsonb('metadata'),
    ...timestampColumns
  },
  (table) => ({
    campaignIdIdx: index('marketing_campaign_deliveries_campaign_id_idx').on(table.campaignId),
    subscriberIdIdx: index('marketing_campaign_deliveries_subscriber_id_idx').on(table.subscriberId),
    deliveryStatusIdx: index('marketing_campaign_deliveries_status_idx').on(table.deliveryStatus)
  })
);
