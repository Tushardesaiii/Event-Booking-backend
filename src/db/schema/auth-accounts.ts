import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { authProviderEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { users } from './users.js';

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    provider: authProviderEnum('provider').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    providerAccountId: text('provider_account_id'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    userIdx: index('auth_accounts_user_id_idx').on(table.userId),
    providerIdx: index('auth_accounts_provider_idx').on(table.provider),
    emailIdx: index('auth_accounts_email_idx').on(table.email),
    phoneIdx: index('auth_accounts_phone_idx').on(table.phone),
    providerAccountUnique: uniqueIndex('auth_accounts_provider_account_unique')
      .on(table.provider, table.providerAccountId)
      .where(sql`${table.providerAccountId} is not null`),
    primaryAccountUnique: uniqueIndex('auth_accounts_primary_unique')
      .on(table.userId)
      .where(sql`${table.isPrimary} = true`)
  })
);
