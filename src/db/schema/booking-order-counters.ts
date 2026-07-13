import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const bookingOrderCounters = pgTable(
  'booking_order_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    year: integer('year').notNull(),
    prefix: text('prefix').notNull(),
    nextSequence: integer('next_sequence').notNull().default(1),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('booking_order_counters_tenant_id_idx').on(table.tenantId),
    eventIdx: index('booking_order_counters_event_id_idx').on(table.eventId),
    yearIdx: index('booking_order_counters_year_idx').on(table.year),
    uniqueTenantEventYear: uniqueIndex('booking_order_counters_tenant_event_year_unique').on(
      table.tenantId,
      table.eventId,
      table.year
    )
  })
);
