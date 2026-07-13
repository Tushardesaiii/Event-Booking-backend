import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const marketingSubscribers = pgTable(
  'marketing_subscribers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true, mode: 'date' }),
    source: text('source').notNull(),
    metadata: jsonb('metadata'),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex('marketing_subscribers_email_unique_idx').on(table.email),
    tenantIdIdx: index('marketing_subscribers_tenant_id_idx').on(table.tenantId)
  })
);
