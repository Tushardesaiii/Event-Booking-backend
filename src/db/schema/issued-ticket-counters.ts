import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { ticketTypes } from './ticket-types.js';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const issuedTicketCounters = pgTable(
  'issued_ticket_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    year: integer('year').notNull(),
    prefix: text('prefix').notNull(),
    nextSequence: integer('next_sequence').notNull().default(1),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('issued_ticket_counters_tenant_id_idx').on(table.tenantId),
    eventIdx: index('issued_ticket_counters_event_id_idx').on(table.eventId),
    ticketTypeIdx: index('issued_ticket_counters_ticket_type_id_idx').on(table.ticketTypeId),
    yearIdx: index('issued_ticket_counters_year_idx').on(table.year),
    uniqueTenantEventYearPrefix: uniqueIndex('issued_ticket_counters_tenant_event_year_prefix_unique').on(
      table.tenantId,
      table.eventId,
      table.year,
      table.prefix
    )
  })
);
