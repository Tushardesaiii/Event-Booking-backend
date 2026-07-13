import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { inventoryReservationStatusEnum } from './enums.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { ticketTypes } from './ticket-types.js';
import { bookingOrders } from './booking-orders.js';

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id').references(() => bookingOrders.id, { onDelete: 'set null' }),
    reservationToken: text('reservation_token').notNull(),
    quantity: integer('quantity').notNull(),
    status: inventoryReservationStatusEnum('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'date' }),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),
    version: integer('version').notNull().default(1),
    extensionCount: integer('extension_count').notNull().default(0),
    maxExtensions: integer('max_extensions').notNull().default(3),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('inventory_reservations_tenant_id_idx').on(table.tenantId),
    eventIdx: index('inventory_reservations_event_id_idx').on(table.eventId),
    ticketTypeIdx: index('inventory_reservations_ticket_type_id_idx').on(table.ticketTypeId),
    bookingOrderIdx: index('inventory_reservations_booking_order_id_idx').on(table.bookingOrderId),
    statusIdx: index('inventory_reservations_status_idx').on(table.status),
    expiresAtIdx: index('inventory_reservations_expires_at_idx').on(table.expiresAt),
    tenantStatusExpiresIdx: index('inventory_reservations_tenant_status_expires_idx')
      .on(table.tenantId, table.ticketTypeId, table.status, table.expiresAt)
      .where(sql`${table.deletedAt} is null and ${table.status} = 'active'`),
    tenantTokenUnique: uniqueIndex('inventory_reservations_tenant_token_unique').on(table.tenantId, table.reservationToken),
    tenantBookingOrderTicketUnique: uniqueIndex('inventory_reservations_tenant_booking_order_ticket_unique')
      .on(table.tenantId, table.bookingOrderId, table.ticketTypeId)
      .where(sql`${table.deletedAt} is null and ${table.bookingOrderId} is not null`)
  })
);
