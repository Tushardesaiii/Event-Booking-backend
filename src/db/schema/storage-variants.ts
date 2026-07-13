import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { storageObjects } from './storage-objects.js';

export const storageVariants = pgTable(
  'storage_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storageObjectId: uuid('storage_object_id')
      .notNull()
      .references(() => storageObjects.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(), // 'thumb', 'mobile', 'desktop', etc.
    width: integer('width'),
    height: integer('height'),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    objectKey: text('object_key').notNull(),
    checksum: text('checksum'),
    etag: text('etag'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    storageObjectIdIdx: index('storage_variants_storage_object_id_idx').on(table.storageObjectId),
    objectKeyIdx: index('storage_variants_object_key_idx').on(table.objectKey)
  })
);
