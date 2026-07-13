import {
  index,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { verificationTokenTypeEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { users } from './users.js';

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    type: verificationTokenTypeEnum('type').notNull(),
    target: text('target').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    usedAt: timestamp('used_at', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    userIdx: index('verification_tokens_user_id_idx').on(table.userId),
    typeIdx: index('verification_tokens_type_idx').on(table.type),
    targetIdx: index('verification_tokens_target_idx').on(table.target),
    expiresAtIdx: index('verification_tokens_expires_at_idx').on(table.expiresAt)
  })
);
