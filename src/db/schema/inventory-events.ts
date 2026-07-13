import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { inventoryEventTypeEnum } from './enums.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { ticketTypes } from './ticket-types.js';
import { inventoryReservations } from './inventory-reservations.js';
import { bookingOrders } from './booking-orders.js';

export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id').references(() => inventoryReservations.id, { onDelete: 'set null' }),
    bookingOrderId: uuid('booking_order_id').references(() => bookingOrders.id, { onDelete: 'set null' }),
    eventType: inventoryEventTypeEnum('event_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    correlationId: text('correlation_id'),
    previousValues: jsonb('previous_values').notNull().default(sql`'{}'::jsonb`),
    newValues: jsonb('new_values').notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('inventory_events_tenant_id_idx').on(table.tenantId),
    eventIdx: index('inventory_events_event_id_idx').on(table.eventId),
    ticketTypeIdx: index('inventory_events_ticket_type_id_idx').on(table.ticketTypeId),
    reservationIdx: index('inventory_events_reservation_id_idx').on(table.reservationId),
    bookingOrderIdx: index('inventory_events_booking_order_id_idx').on(table.bookingOrderId),
    eventTypeIdx: index('inventory_events_event_type_idx').on(table.eventType),
    createdAtIdx: index('inventory_events_created_at_idx').on(table.createdAt),
    tenantCreatedAtIdx: index('inventory_events_tenant_created_at_idx').on(table.tenantId, table.createdAt)
  })
);
