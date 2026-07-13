import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    htmlContent: text('html_content').notNull(),
    textContent: text('text_content'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('email_templates_tenant_id_idx').on(table.tenantId),
    tenantActiveIdx: index('email_templates_tenant_id_is_active_idx').on(table.tenantId, table.isActive),
    createdAtIdx: index('email_templates_created_at_idx').on(table.createdAt),
    tenantNameUnique: uniqueIndex('email_templates_tenant_id_name_unique').on(table.tenantId, table.name)
  })
);
