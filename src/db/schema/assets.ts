import {
  index,
  integer,
  pgTable,
  text,
  uuid
} from 'drizzle-orm/pg-core';

import { timestampColumns } from './helpers.js';
import { users } from './users.js';

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns
  },
  (table) => ({
    uploadedByIdx: index('assets_uploaded_by_idx').on(table.uploadedBy),
    createdAtIdx: index('assets_created_at_idx').on(table.createdAt)
  })
);
