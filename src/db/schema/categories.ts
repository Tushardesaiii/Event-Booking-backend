import {
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('categories_tenant_id_idx').on(table.tenantId),
    tenantSlugIdx: index('categories_tenant_id_slug_idx').on(table.tenantId, table.slug),
    slugUnique: uniqueIndex('categories_slug_unique').on(table.slug),
    createdAtIdx: index('categories_created_at_idx').on(table.createdAt)
  })
);
