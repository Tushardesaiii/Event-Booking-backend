import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const emailSegments = pgTable(
  'email_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    description: text('description'),
    filtersJson: jsonb('filters_json').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('email_segments_tenant_id_idx').on(table.tenantId),
    createdAtIdx: index('email_segments_created_at_idx').on(table.createdAt),
    tenantNameUnique: uniqueIndex('email_segments_tenant_id_name_unique').on(table.tenantId, table.name)
  })
);
