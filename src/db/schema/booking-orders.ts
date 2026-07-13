import { sql } from 'drizzle-orm';
import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { bookingOrderSourceEnum, bookingOrderStatusEnum } from './enums.js';
import { eventDates } from './event-dates.js';
import { events } from './events.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const bookingOrders = pgTable(
  'booking_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    // The specific event date this order is for. Nullable: legacy orders and
    // single-date events fall back to the event's own start_date_time.
    eventDateId: uuid('event_date_id').references(() => eventDates.id, { onDelete: 'set null' }),
    purchaserUserId: uuid('purchaser_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    orderNumber: text('order_number').notNull(),
    status: bookingOrderStatusEnum('status').notNull().default('pending'),
    currency: text('currency').notNull(),
    subtotalAmount: numeric('subtotal_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    source: bookingOrderSourceEnum('source').notNull().default('web'),
    notes: text('notes'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancellationReason: text('cancellation_reason'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('booking_orders_tenant_id_idx').on(table.tenantId),
    eventIdx: index('booking_orders_event_id_idx').on(table.eventId),
    purchaserIdx: index('booking_orders_purchaser_user_id_idx').on(table.purchaserUserId),
    orderNumberIdx: index('booking_orders_order_number_idx').on(table.orderNumber),
    statusIdx: index('booking_orders_status_idx').on(table.status),
    tenantStatusIdx: index('booking_orders_tenant_status_idx').on(table.tenantId, table.status).where(sql`${table.deletedAt} is null`),
    sourceIdx: index('booking_orders_source_idx').on(table.source),
    createdAtIdx: index('booking_orders_created_at_idx').on(table.createdAt),
    uniqueTenantOrderNumber: uniqueIndex('booking_orders_tenant_order_number_unique').on(table.tenantId, table.orderNumber)
  })
);
