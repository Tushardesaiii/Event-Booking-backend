import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const emailComplaints = pgTable(
  'email_complaints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    email: text('email').notNull(),
    complaintType: text('complaint_type'),
    userAgent: text('user_agent'),
    providerMessageId: text('provider_message_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_complaints_tenant_id_idx').on(table.tenantId),
    emailIdx: index('email_complaints_email_idx').on(table.email),
    createdAtIdx: index('email_complaints_created_at_idx').on(table.createdAt)
  })
);
