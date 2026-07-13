import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const emailBounces = pgTable(
  'email_bounces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    email: text('email').notNull(),
    bounceType: text('bounce_type').notNull(), // e.g. hard, soft, invalid_email
    bounceSubType: text('bounce_sub_type'),
    description: text('description'),
    providerMessageId: text('provider_message_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_bounces_tenant_id_idx').on(table.tenantId),
    emailIdx: index('email_bounces_email_idx').on(table.email),
    createdAtIdx: index('email_bounces_created_at_idx').on(table.createdAt)
  })
);
