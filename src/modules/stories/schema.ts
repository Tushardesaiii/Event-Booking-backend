import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    ownerType: text('owner_type').notNull(), // 'user' | 'organizer' | 'event'
    ownerId: uuid('owner_id').notNull(), // corresponding user ID, organizer ID, or event ID
    mediaUrl: text('media_url').notNull(),
    mediaType: text('media_type').notNull().default('image'), // 'image' | 'video'
    caption: text('caption'),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    viewerCount: integer('viewer_count').notNull().default(0),
    coverMetadata: jsonb('cover_metadata'),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('stories_tenant_id_idx').on(table.tenantId),
    ownerIdx: index('stories_owner_type_id_idx').on(table.ownerType, table.ownerId),
    expiresIdx: index('stories_expires_at_idx').on(table.expiresAt),
    createdAtIdx: index('stories_created_at_idx').on(table.createdAt)
  })
);

export const storyViews = pgTable(
  'story_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storyId: uuid('story_id').notNull().references(() => stories.id, {
      onDelete: 'restrict'
    }),
    viewerUserId: uuid('viewer_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    storyIdx: index('story_views_story_id_idx').on(table.storyId),
    viewerIdx: index('story_views_viewer_user_id_idx').on(table.viewerUserId)
  })
);

export const storyReactions = pgTable(
  'story_reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storyId: uuid('story_id').notNull().references(() => stories.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    reactionType: text('reaction_type').notNull(), // emoji or reaction code
    ...timestampColumns
  },
  (table) => ({
    storyIdx: index('story_reactions_story_id_idx').on(table.storyId),
    userIdx: index('story_reactions_user_id_idx').on(table.userId)
  })
);

export const storyReplies = pgTable(
  'story_replies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storyId: uuid('story_id').notNull().references(() => stories.id, {
      onDelete: 'restrict'
    }),
    senderUserId: uuid('sender_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    message: text('message').notNull(),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    storyIdx: index('story_replies_story_id_idx').on(table.storyId),
    senderIdx: index('story_replies_sender_user_id_idx').on(table.senderUserId)
  })
);
