import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { timestampColumns } from './helpers.js';

export const marketingCampaigns = pgTable(
  'marketing_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    templateType: text('template_type').notNull(),
    status: text('status').notNull(), // 'draft', 'scheduled', 'sending', 'completed', 'cancelled'
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    metadata: jsonb('metadata'),
    ...timestampColumns
  },
  (table) => ({
    tenantIdIdx: index('marketing_campaigns_tenant_id_idx').on(table.tenantId),
    createdAtIdx: index('marketing_campaigns_created_at_idx').on(table.createdAt)
  })
);
