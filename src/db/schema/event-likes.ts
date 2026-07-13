import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { users } from './users.js';

// A consumer's "like" on an event. Cross-tenant (public events span tenants), so
// unlike wishlists this is keyed only by (event, user). The public like COUNT is
// derived from these rows; a user can like an event at most once.
export const eventLikes = pgTable(
  'event_likes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    eventUserUnique: uniqueIndex('event_likes_event_user_unique').on(table.eventId, table.userId),
    eventIdx: index('event_likes_event_id_idx').on(table.eventId),
    userIdx: index('event_likes_user_id_idx').on(table.userId)
  })
);
