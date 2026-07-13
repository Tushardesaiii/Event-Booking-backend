import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { timestampColumns } from './helpers.js';
import { events } from './events.js';
import { tags } from './tags.js';
import { tenants } from './tenants.js';

export const eventTags = pgTable(
  'event_tags',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    eventId: uuid('event_id').notNull().references(() => events.id, {
      onDelete: 'restrict'
    }),
    tagId: uuid('tag_id').notNull().references(() => tags.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.eventId, table.tagId] }),
    tenantIdx: index('event_tags_tenant_id_idx').on(table.tenantId),
    tenantTagIdx: index('event_tags_tenant_id_tag_id_event_id_idx').on(table.tenantId, table.tagId, table.eventId),
    eventIdx: index('event_tags_event_id_idx').on(table.eventId),
    tagIdx: index('event_tags_tag_id_idx').on(table.tagId)
  })
);
