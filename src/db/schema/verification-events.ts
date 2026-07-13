import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from './tenants.js';

export const verificationEvents = pgTable(
  'verification_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    source: text('source').notNull(), // 'email', 'otp', 'marketing'
    email: text('email'),
    phoneNumber: text('phone_number'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    providerStatus: text('provider_status'),
    providerResponse: text('provider_response'),
    correlationId: text('correlation_id'),
    requestId: text('request_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    actorUserIdIdx: index('verification_events_actor_user_id_idx').on(table.actorUserId),
    tenantIdIdx: index('verification_events_tenant_id_idx').on(table.tenantId),
    createdAtIdx: index('verification_events_created_at_idx').on(table.createdAt),
    emailIdx: index('verification_events_email_idx').on(table.email),
    phoneIdx: index('verification_events_phone_idx').on(table.phoneNumber)
  })
);
