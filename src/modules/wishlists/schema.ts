import {
  index,
  pgTable,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { events } from '../../db/schema/events.js';

export const wishlists = pgTable(
  'wishlists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    eventId: uuid('event_id').notNull().references(() => events.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('wishlists_tenant_id_idx').on(table.tenantId),
    userIdx: index('wishlists_user_id_idx').on(table.userId),
    eventIdx: index('wishlists_event_id_idx').on(table.eventId),
    uniqueWishlist: uniqueIndex('wishlists_tenant_user_event_unique').on(table.tenantId, table.userId, table.eventId)
  })
);
