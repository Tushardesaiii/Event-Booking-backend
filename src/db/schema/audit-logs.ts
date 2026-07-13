import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { auditActorTypeEnum, auditEventTypeEnum } from './enums.js';
import { users } from './users.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: auditEventTypeEnum('event_type').notNull(),
    actorType: auditActorTypeEnum('actor_type').notNull().default('anonymous'),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    phoneNumber: text('phone_number'),
    email: text('email'),
    username: text('username'),
    correlationId: text('correlation_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow()
  },
  (table) => ({
    eventTypeIdx: index('audit_logs_event_type_idx').on(table.eventType),
    actorUserIdx: index('audit_logs_actor_user_id_idx').on(table.actorUserId),
    phoneNumberIdx: index('audit_logs_phone_number_idx').on(table.phoneNumber),
    ipAddressIdx: index('audit_logs_ip_address_idx').on(table.ipAddress),
    correlationIdIdx: index('audit_logs_correlation_id_idx').on(table.correlationId),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt)
  })
);
