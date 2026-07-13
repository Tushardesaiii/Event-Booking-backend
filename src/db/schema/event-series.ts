import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const eventSeries = pgTable(
  'event_series',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    timezone: text('timezone').notNull(),
    startDateTime: timestamp('start_date_time', {
      withTimezone: true,
      mode: 'date'
    }),
    endDateTime: timestamp('end_date_time', {
      withTimezone: true,
      mode: 'date'
    }),
    isActive: boolean('is_active').notNull().default(true),
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
    tenantIdx: index('event_series_tenant_id_idx').on(table.tenantId),
    tenantSlugIdx: index('event_series_tenant_id_slug_idx').on(table.tenantId, table.slug),
    slugIdx: index('event_series_slug_idx').on(table.slug),
    startDateTimeIdx: index('event_series_start_date_time_idx').on(table.startDateTime),
    createdAtIdx: index('event_series_created_at_idx').on(table.createdAt),
    slugUnique: uniqueIndex('event_series_slug_unique').on(table.slug)
  })
);
