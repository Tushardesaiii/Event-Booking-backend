import { boolean, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestampColumns } from './helpers.js';
import { users } from './users.js';

// Global, platform-wide configuration curated by the superadmin. A single row
// (enforced by the unique `singleton` flag) holds settings that apply to EVERY
// tenant and transaction — e.g. the convenience fee charged on all bookings.
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Ensures only one config row can ever exist (all rows carry `true`).
    singleton: boolean('singleton').notNull().default(true),
    // Convenience fee charged on every booking, in basis points (900 = 9%).
    convenienceFeeBps: integer('convenience_fee_bps').notNull().default(900),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns
  },
  (table) => ({
    singletonUnique: uniqueIndex('platform_settings_singleton_unique').on(table.singleton)
  })
);
