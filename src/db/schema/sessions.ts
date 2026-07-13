import {
  index,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow()
  },
  (table) => ({
    userIdx: index('sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt)
  })
);
