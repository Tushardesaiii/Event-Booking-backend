import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { attendeeStatusEnum } from './enums.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { events } from './events.js';
import { tenants } from './tenants.js';
import { ticketTypes } from './ticket-types.js';
import { users } from './users.js';

export const attendees = pgTable(
  'attendees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id'),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    gender: text('gender'),
    dateOfBirth: date('date_of_birth', { mode: 'date' }),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    notes: text('notes'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'date' }),
    checkedInByUserId: uuid('checked_in_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: attendeeStatusEnum('status').notNull().default('pending'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('attendees_tenant_id_idx').on(table.tenantId),
    eventIdx: index('attendees_event_id_idx').on(table.eventId),
    ticketTypeIdx: index('attendees_ticket_type_id_idx').on(table.ticketTypeId),
    statusIdx: index('attendees_status_idx').on(table.status),
    checkedInAtIdx: index('attendees_checked_in_at_idx').on(table.checkedInAt),
    emailIdx: index('attendees_email_idx').on(table.email),
    phoneIdx: index('attendees_phone_idx').on(table.phone),
    createdAtIdx: index('attendees_created_at_idx').on(table.createdAt)
  })
);
