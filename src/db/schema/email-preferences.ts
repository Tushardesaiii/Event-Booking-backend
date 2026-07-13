import { index, pgTable, text, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const emailPreferences = pgTable(
  'email_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'cascade'
    }),
    email: text('email').notNull(),
    marketing: boolean('marketing').notNull().default(true),
    campaign: boolean('campaign').notNull().default(true),
    notification: boolean('notification').notNull().default(true),
    unsubscribeToken: text('unsubscribe_token').notNull(),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_preferences_tenant_id_idx').on(table.tenantId),
    userIdx: index('email_preferences_user_id_idx').on(table.userId),
    emailIdx: index('email_preferences_email_idx').on(table.email),
    tokenIdx: uniqueIndex('email_preferences_unsubscribe_token_idx').on(table.unsubscribeToken),
    tenantEmailUnique: uniqueIndex('email_preferences_tenant_email_unique').on(table.tenantId, table.email),
    createdAtIdx: index('email_preferences_created_at_idx').on(table.createdAt)
  })
);
