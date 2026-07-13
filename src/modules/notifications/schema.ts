import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    title: text('title').notNull(),
    message: text('message').notNull(),
    type: text('type').notNull(), // 'invited_to_group' | 'invite_accepted' | 'booking_confirmed' | 'poll_created' | 'poll_closed' | 'story_reply_received' | 'friend_joined_event'
    readAt: timestamp('read_at', {
      withTimezone: true,
      mode: 'date'
    }),
    entityType: text('entity_type'), // e.g., 'group_plan', 'booking', 'story', 'poll'
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('notifications_tenant_id_idx').on(table.tenantId),
    userIdx: index('notifications_user_id_idx').on(table.userId),
    readIdx: index('notifications_read_at_idx').on(table.readAt),
    createdAtIdx: index('notifications_created_at_idx').on(table.createdAt)
  })
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    smsEnabled: boolean('sms_enabled').notNull().default(true),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    preferences: jsonb('preferences').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('notification_preferences_tenant_id_idx').on(table.tenantId),
    userIdx: index('notification_preferences_user_id_idx').on(table.userId),
    uniqueUserPreference: uniqueIndex('notification_preferences_tenant_user_unique').on(table.tenantId, table.userId)
  })
);
