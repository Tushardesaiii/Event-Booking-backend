import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { events } from '../../db/schema/events.js';
import { users } from '../../db/schema/users.js';

// Organizer-configured accessible inventory per event (e.g. "Wheelchair spots
// (Gate 1)", companion seats, low-stimulation zones).
export const accessibilityZones = pgTable(
  'accessibility_zones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    gate: text('gate'),
    total: integer('total').notNull().default(0),
    used: integer('used').notNull().default(0),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('accessibility_zones_tenant_id_idx').on(table.tenantId),
    eventIdx: index('accessibility_zones_event_id_idx').on(table.eventId)
  })
);

// Accessibility booking requests for an event (created from the organizer
// console or, in future, the consumer checkout). Organizers confirm/cancel them.
export const accessibilityRequests = pgTable(
  'accessibility_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    attendeeName: text('attendee_name').notNull(),
    contact: text('contact'),
    need: text('need').notNull(),
    gate: text('gate'),
    status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'cancelled'
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('accessibility_requests_tenant_id_idx').on(table.tenantId),
    eventIdx: index('accessibility_requests_event_id_idx').on(table.eventId),
    statusIdx: index('accessibility_requests_status_idx').on(table.status)
  })
);
