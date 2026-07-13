import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { issuedTickets } from './issued-tickets.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const issuedTicketEventTypeEnum = pgEnum('issued_ticket_event_type', [
  'ticket_validated',
  'ticket_checked_in',
  'ticket_invalidated',
  'ticket_refunded',
  'ticket_cancelled',
  'ticket_transferred',
  'ticket_validation_rejected'
]);

export const issuedTicketValidationOutcomeEnum = pgEnum('issued_ticket_validation_outcome', [
  'valid',
  'already_checked_in',
  'cancelled',
  'invalidated',
  'refunded',
  'deleted',
  'tenant_mismatch',
  'stale_ticket',
  'invalid_qr',
  'unauthorized_scanner'
]);

export const issuedTicketEvents = pgTable(
  'issued_ticket_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    issuedTicketId: uuid('issued_ticket_id').references(() => issuedTickets.id, { onDelete: 'restrict' }),
    eventType: issuedTicketEventTypeEnum('event_type').notNull(),
    outcome: issuedTicketValidationOutcomeEnum('outcome').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    scannerDeviceId: text('scanner_device_id'),
    scannerGate: text('scanner_gate'),
    scannerOperatorUserId: uuid('scanner_operator_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    details: jsonb('details').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('issued_ticket_events_tenant_id_idx').on(table.tenantId),
    ticketIdx: index('issued_ticket_events_issued_ticket_id_idx').on(table.issuedTicketId),
    eventTypeIdx: index('issued_ticket_events_event_type_idx').on(table.eventType),
    createdAtIdx: index('issued_ticket_events_created_at_idx').on(table.createdAt),
    tenantCreatedAtIdx: index('issued_ticket_events_tenant_created_at_idx').on(table.tenantId, table.createdAt)
  })
);
