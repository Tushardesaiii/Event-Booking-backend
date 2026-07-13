import { sql } from 'drizzle-orm';
import { index, jsonb, integer, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { bookingOrders } from './booking-orders.js';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { ticketTypes } from './ticket-types.js';

export const bookingOrderItems = pgTable(
  'booking_order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id').notNull().references(() => bookingOrders.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    subtotalAmount: numeric('subtotal_amount', { precision: 14, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    ticketNameSnapshot: text('ticket_name_snapshot').notNull(),
    ticketSlugSnapshot: text('ticket_slug_snapshot').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('booking_order_items_tenant_id_idx').on(table.tenantId),
    bookingOrderIdx: index('booking_order_items_booking_order_id_idx').on(table.bookingOrderId),
    ticketTypeIdx: index('booking_order_items_ticket_type_id_idx').on(table.ticketTypeId),
    tenantTicketTypeIdx: index('booking_order_items_tenant_ticket_type_idx').on(table.tenantId, table.ticketTypeId),
    orderTicketUnique: uniqueIndex('booking_order_items_order_ticket_unique').on(table.bookingOrderId, table.ticketTypeId),
    createdAtIdx: index('booking_order_items_created_at_idx').on(table.createdAt)
  })
);
