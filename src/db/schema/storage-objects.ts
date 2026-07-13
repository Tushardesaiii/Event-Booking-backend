import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { timestampColumns, softDeleteColumn } from './helpers.js';
import { sql } from 'drizzle-orm';

export const storageObjects: any = pgTable(
  'storage_objects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id'),
    module: text('module').notNull(), // 'users', 'organizers', 'events', 'tickets', 'payments', 'emails', 'exports'
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    version: integer('version').default(1).notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    checksum: text('checksum'),
    etag: text('etag'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    visibility: text('visibility').notNull().default('private'), // 'public' | 'private'
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    
    // Phase 15 additions
    activeVersion: boolean('active_version').default(true).notNull(),
    processingStatus: text('processing_status').default('pending').notNull(), // pending, uploaded, metadata_extracted, virus_scanned, variant_generation, optimization, ready, failed, deleted
    variantCount: integer('variant_count').default(0).notNull(),
    scanStatus: text('scan_status'), // pending, clean, infected, skipped
    scanProvider: text('scan_provider'),
    scanCompletedAt: timestamp('scan_completed_at', { withTimezone: true }),
    scanResult: text('scan_result'),
    lifecycleState: text('lifecycle_state').default('active').notNull(), // active, cold, archived, deleted
    originalId: uuid('original_id').references((): AnyPgColumn => storageObjects.id, { onDelete: 'set null' }),

    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('storage_objects_tenant_id_idx').on(table.tenantId),
    ownerIdx: index('storage_objects_owner_id_idx').on(table.ownerId),
    moduleIdx: index('storage_objects_module_idx').on(table.module),
    objectKeyVersionUniqueIdx: uniqueIndex('storage_objects_object_key_version_unique_idx').on(table.objectKey, table.version),
    objectKeyIdx: index('storage_objects_object_key_idx').on(table.objectKey),
    uploadedByIdx: index('storage_objects_uploaded_by_idx').on(table.uploadedBy),
    createdAtIdx: index('storage_objects_created_at_idx').on(table.createdAt)
  })
);
