import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { attendees } from './attendees.js';
import { bookingOrderItems } from './booking-order-items.js';
import { bookingOrders } from './booking-orders.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const bookingOrderItemAttendees = pgTable(
  'booking_order_item_attendees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id').notNull().references(() => bookingOrders.id, { onDelete: 'restrict' }),
    bookingOrderItemId: uuid('booking_order_item_id').notNull().references(() => bookingOrderItems.id, { onDelete: 'restrict' }),
    attendeeId: uuid('attendee_id').notNull().references(() => attendees.id, { onDelete: 'restrict' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('booking_order_item_attendees_tenant_id_idx').on(table.tenantId),
    orderIdx: index('booking_order_item_attendees_booking_order_id_idx').on(table.bookingOrderId),
    itemIdx: index('booking_order_item_attendees_booking_order_item_id_idx').on(table.bookingOrderItemId),
    attendeeIdx: index('booking_order_item_attendees_attendee_id_idx').on(table.attendeeId),
    activeAttendeeUnique: uniqueIndex('booking_order_item_attendees_active_attendee_unique')
      .on(table.tenantId, table.attendeeId)
      .where(sql`deleted_at is null`),
    activeItemAttendeeUnique: uniqueIndex('booking_order_item_attendees_active_item_attendee_unique')
      .on(table.bookingOrderItemId, table.attendeeId)
      .where(sql`deleted_at is null`),
    createdAtIdx: index('booking_order_item_attendees_created_at_idx').on(table.createdAt)
  })
);
