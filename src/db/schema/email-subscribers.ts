import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { emailSubscriberStatusEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const emailSubscribers = pgTable(
  'email_subscribers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    status: emailSubscriberStatusEnum('status').notNull().default('subscribed'),
    source: text('source').notNull().default('manual'),
    subscribedAt: timestamp('subscribed_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_subscribers_tenant_id_idx').on(table.tenantId),
    tenantStatusIdx: index('email_subscribers_tenant_id_status_idx').on(table.tenantId, table.status),
    tenantUserIdx: index('email_subscribers_tenant_id_user_id_idx').on(table.tenantId, table.userId),
    createdAtIdx: index('email_subscribers_created_at_idx').on(table.createdAt),
    tenantEmailUnique: uniqueIndex('email_subscribers_tenant_id_email_unique').on(table.tenantId, table.email)
  })
);
