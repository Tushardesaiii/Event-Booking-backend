import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { tenants } from './tenants.js';
import { timestampColumns } from './helpers.js';

// A distinct date/time an event runs. An event can offer MULTIPLE selectable
// dates; the buyer books a ticket for one specific date. The event's own
// start_date_time/end_date_time remain the overall span (earliest → latest) for
// listing/sorting, while these rows are the concrete, bookable occurrences.
export const eventDates = pgTable(
  'event_dates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    eventId: uuid('event_id').notNull().references(() => events.id, {
      onDelete: 'cascade'
    }),
    startDateTime: timestamp('start_date_time', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    endDateTime: timestamp('end_date_time', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    ...timestampColumns
  },
  (table) => ({
    eventIdx: index('event_dates_event_id_idx').on(table.eventId),
    tenantIdx: index('event_dates_tenant_id_idx').on(table.tenantId),
    eventOrderIdx: index('event_dates_event_order_idx').on(table.eventId, table.displayOrder)
  })
);
