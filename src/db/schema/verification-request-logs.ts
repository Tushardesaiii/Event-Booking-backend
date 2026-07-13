import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const verificationRequestLogs = pgTable(
  'verification_request_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestType: text('request_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    phoneNumber: text('phone_number'),
    email: text('email'),
    responseReference: jsonb('response_reference'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    idempotencyKeyUniqueIdx: uniqueIndex('verification_request_logs_idempotency_key_unique_idx').on(table.idempotencyKey),
    createdAtIdx: index('verification_request_logs_created_at_idx').on(table.createdAt)
  })
);
