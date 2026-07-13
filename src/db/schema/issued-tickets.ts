import { sql } from 'drizzle-orm';
import { index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, timestamp } from 'drizzle-orm/pg-core';

import { attendees } from './attendees.js';
import { bookingOrderItems } from './booking-order-items.js';
import { bookingOrders } from './booking-orders.js';
import { eventDates } from './event-dates.js';
import { events } from './events.js';
import { issuedTicketStatusEnum } from './enums.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { ticketTypes } from './ticket-types.js';

export const issuedTickets = pgTable(
  'issued_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    // The specific event date this ticket admits to (copied from the order).
    // Nullable: legacy/single-date tickets fall back to the event start.
    eventDateId: uuid('event_date_id').references(() => eventDates.id, { onDelete: 'set null' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    attendeeId: uuid('attendee_id').references(() => attendees.id, { onDelete: 'set null' }),
    checkedInByUserId: uuid('checked_in_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    transferredByUserId: uuid('transferred_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true, mode: 'date' }),
    lastValidatedByUserId: uuid('last_validated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    validationCount: integer('validation_count').notNull().default(0),
    successfulValidationCount: integer('successful_validation_count').notNull().default(0),
    failedValidationCount: integer('failed_validation_count').notNull().default(0),
    lastValidationAttemptAt: timestamp('last_validation_attempt_at', { withTimezone: true, mode: 'date' }),
    lastSuccessfulValidationAt: timestamp('last_successful_validation_at', { withTimezone: true, mode: 'date' }),
    lastValidationFailureReason: text('last_validation_failure_reason'),
    lastValidationSource: text('last_validation_source'),
    lastScannerDeviceId: text('last_scanner_device_id'),
    lastScannerGate: text('last_scanner_gate'),
    lastScannerOperatorUserId: uuid('last_scanner_operator_user_id').references(() => users.id, { onDelete: 'set null' }),
    bookingOrderId: uuid('booking_order_id').notNull().references(() => bookingOrders.id, { onDelete: 'restrict' }),
    bookingOrderItemId: uuid('booking_order_item_id').notNull().references(() => bookingOrderItems.id, { onDelete: 'restrict' }),
    refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'date' }),
    refundedByUserId: uuid('refunded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ticketNumber: text('ticket_number').notNull(),
    qrCodeToken: text('qr_code_token').notNull(),
    status: issuedTicketStatusEnum('status').notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'date' }),
    transferredAt: timestamp('transferred_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    ticketTypeNameSnapshot: text('ticket_type_name_snapshot').notNull(),
    ticketTypeSlugSnapshot: text('ticket_type_slug_snapshot').notNull(),
    unitPriceSnapshot: numeric('unit_price_snapshot', { precision: 14, scale: 2 }).notNull(),
    currencySnapshot: text('currency_snapshot').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('issued_tickets_tenant_id_idx').on(table.tenantId),
    eventIdx: index('issued_tickets_event_id_idx').on(table.eventId),
    ticketTypeIdx: index('issued_tickets_ticket_type_id_idx').on(table.ticketTypeId),
    attendeeIdx: index('issued_tickets_attendee_id_idx').on(table.attendeeId),
    bookingOrderIdx: index('issued_tickets_booking_order_id_idx').on(table.bookingOrderId),
    bookingOrderItemIdx: index('issued_tickets_booking_order_item_id_idx').on(table.bookingOrderItemId),
    tenantBookingOrderIdx: index('issued_tickets_tenant_booking_order_id_idx').on(table.tenantId, table.bookingOrderId).where(sql`${table.deletedAt} is null`),
    tenantBookingOrderItemIdx: index('issued_tickets_tenant_booking_order_item_id_idx').on(table.tenantId, table.bookingOrderItemId).where(sql`${table.deletedAt} is null`),
    tenantIssuedAtIdx: index('issued_tickets_tenant_issued_at_idx').on(table.tenantId, table.issuedAt).where(sql`${table.deletedAt} is null`),
    tenantStatusIdx: index('issued_tickets_tenant_status_idx').on(table.tenantId, table.status).where(sql`${table.deletedAt} is null`),
    tenantValidationAttemptIdx: index('issued_tickets_tenant_validation_attempt_idx').on(table.tenantId, table.lastValidationAttemptAt).where(sql`${table.deletedAt} is null`),
    tenantSuccessfulValidationIdx: index('issued_tickets_tenant_successful_validation_idx').on(table.tenantId, table.lastSuccessfulValidationAt).where(sql`${table.deletedAt} is null`),
    tenantScannerDeviceIdx: index('issued_tickets_tenant_scanner_device_idx').on(table.tenantId, table.lastScannerDeviceId).where(sql`${table.deletedAt} is null`),
    ticketNumberUnique: uniqueIndex('issued_tickets_tenant_ticket_number_unique').on(table.tenantId, table.ticketNumber),
    qrCodeTokenUnique: uniqueIndex('issued_tickets_qr_code_token_unique').on(table.qrCodeToken),
    activeAttendeeIdx: index('issued_tickets_tenant_attendee_active_idx')
      .on(table.tenantId, table.attendeeId)
      .where(sql`${table.attendeeId} is not null and ${table.deletedAt} is null`),
    statusIdx: index('issued_tickets_status_idx').on(table.status),
    issuedAtIdx: index('issued_tickets_issued_at_idx').on(table.issuedAt),
    checkedInAtIdx: index('issued_tickets_checked_in_at_idx').on(table.checkedInAt),
    createdAtIdx: index('issued_tickets_created_at_idx').on(table.createdAt)
  })
);
