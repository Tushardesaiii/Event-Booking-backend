import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { users } from './users.js';

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    userIdIdx: index('email_verification_tokens_user_id_idx').on(table.userId),
    tokenHashIdx: index('email_verification_tokens_token_hash_idx').on(table.tokenHash),
    expiresAtIdx: index('email_verification_tokens_expires_at_idx').on(table.expiresAt)
  })
);
