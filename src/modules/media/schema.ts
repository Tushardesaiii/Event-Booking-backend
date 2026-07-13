import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';

export const moderationStatusEnum = pgEnum('moderation_status', ['pending', 'approved', 'rejected', 'flagged', 'under_review']);
export const processingStatusEnum = pgEnum('processing_status', ['uploading', 'processing', 'ready', 'failed', 'deleted']);
export const virusScanStatusEnum = pgEnum('virus_scan_status', ['pending', 'clean', 'infected']);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    uploaderUserId: uuid('uploader_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    storageProvider: text('storage_provider').notNull(),
    bucket: text('bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    checksum: text('checksum'),
    blurHash: text('blur_hash'),
    dominantColor: text('dominant_color'),
    moderationStatus: moderationStatusEnum('moderation_status').notNull().default('pending'),
    processingStatus: processingStatusEnum('processing_status').notNull().default('uploading'),
    metadata: jsonb('metadata'),
    version: integer('version').default(0).notNull(),
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true, mode: 'date' }),
    moderationReason: text('moderation_reason'),
    moderationHistory: jsonb('moderation_history').default([]),
    scanStatus: virusScanStatusEnum('scan_status').notNull().default('pending'),
    scanCompletedAt: timestamp('scan_completed_at', { withTimezone: true, mode: 'date' }),
    originalUploaderId: uuid('original_uploader_id').references(() => users.id, { onDelete: 'set null' }),
    currentOwnerId: uuid('current_owner_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('media_assets_tenant_id_idx').on(table.tenantId),
    uploaderIdx: index('media_assets_uploader_user_id_idx').on(table.uploaderUserId),
    deletedAtIdx: index('media_assets_deleted_at_idx').on(table.deletedAt),
    checksumIdx: index('media_assets_checksum_idx').on(table.checksum)
  })
);

export const mediaLinks = pgTable(
  'media_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    mediaAssetId: uuid('media_asset_id').notNull().references(() => mediaAssets.id, {
      onDelete: 'restrict'
    }),
    entityType: text('entity_type').notNull(), // 'event', 'artist', 'organizer', etc.
    entityId: uuid('entity_id').notNull(),
    role: text('role').notNull(), // 'hero', 'thumbnail', 'gallery', etc.
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => ({
    tenantIdx: index('media_links_tenant_id_idx').on(table.tenantId),
    mediaAssetIdx: index('media_links_media_asset_id_idx').on(table.mediaAssetId),
    entityIdx: index('media_links_entity_idx').on(table.entityType, table.entityId),
    roleIdx: index('media_links_role_idx').on(table.role)
  })
);

export const tenantStorageQuotas = pgTable(
  'tenant_storage_quotas',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'restrict' }),
    maxStorageBytes: bigint('max_storage_bytes', { mode: 'bigint' }).notNull().default(sql`10737418240`), // 10 GB
    currentStorageBytes: bigint('current_storage_bytes', { mode: 'bigint' }).notNull().default(sql`0`),
    imageCount: integer('image_count').notNull().default(0),
    videoCount: integer('video_count').notNull().default(0),
    documentCount: integer('document_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  }
);

export const userStorageQuotas = pgTable(
  'user_storage_quotas',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    maxStorageBytes: bigint('max_storage_bytes', { mode: 'bigint' }).notNull().default(sql`1073741824`), // 1 GB
    currentStorageBytes: bigint('current_storage_bytes', { mode: 'bigint' }).notNull().default(sql`0`),
    imageCount: integer('image_count').notNull().default(0),
    videoCount: integer('video_count').notNull().default(0),
    documentCount: integer('document_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId] })
  })
);
