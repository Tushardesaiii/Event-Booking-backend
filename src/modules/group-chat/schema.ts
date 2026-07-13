import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { groupPlans } from '../group-plans/schema.js';

export const groupChatRooms = pgTable(
  'group_chat_rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    groupPlanId: uuid('group_plan_id').references(() => groupPlans.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
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
    tenantIdx: index('group_chat_rooms_tenant_id_idx').on(table.tenantId),
    groupPlanIdx: index('group_chat_rooms_group_plan_id_idx').on(table.groupPlanId)
  })
);

export const groupChatMembers = pgTable(
  'group_chat_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id').notNull().references(() => groupChatRooms.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    role: text('role').notNull().default('member'), // 'admin' | 'member'
    joinedAt: timestamp('joined_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow(),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    roomIdx: index('group_chat_members_room_id_idx').on(table.roomId),
    userIdx: index('group_chat_members_user_id_idx').on(table.userId)
  })
);

export const groupChatMessages = pgTable(
  'group_chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id').notNull().references(() => groupChatRooms.id, {
      onDelete: 'restrict'
    }),
    senderUserId: uuid('sender_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    message: text('message').notNull(),
    replyToMessageId: uuid('reply_to_message_id'), // Self-reference lazy evaluation in business layer or direct nullable UUID
    isEdited: boolean('is_edited').notNull().default(false),
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
    roomIdx: index('group_chat_messages_room_id_idx').on(table.roomId),
    senderIdx: index('group_chat_messages_sender_user_id_idx').on(table.senderUserId),
    createdAtIdx: index('group_chat_messages_created_at_idx').on(table.createdAt)
  })
);

export const groupChatReactions = pgTable(
  'group_chat_reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => groupChatMessages.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    reaction: text('reaction').notNull(),
    ...timestampColumns
  },
  (table) => ({
    messageIdx: index('group_chat_reactions_message_id_idx').on(table.messageId),
    userReactionUnique: uniqueIndex('group_chat_reactions_msg_usr_react_unique').on(table.messageId, table.userId, table.reaction)
  })
);

export const groupChatAttachments = pgTable(
  'group_chat_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => groupChatMessages.id, {
      onDelete: 'restrict'
    }),
    fileUrl: text('file_url').notNull(),
    fileType: text('file_type'),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    ...timestampColumns
  },
  (table) => ({
    messageIdx: index('group_chat_attachments_message_id_idx').on(table.messageId)
  })
);
