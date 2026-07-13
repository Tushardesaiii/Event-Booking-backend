import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { events } from '../../db/schema/events.js';

export const groupPlans = pgTable(
  'group_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    description: text('description'),
    eventId: uuid('event_id').references(() => events.id, {
      onDelete: 'set null'
    }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    isActive: boolean('is_active').notNull().default(true),
    isArchived: boolean('is_archived').notNull().default(false),
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
    tenantIdx: index('group_plans_tenant_id_idx').on(table.tenantId),
    eventIdIdx: index('group_plans_event_id_idx').on(table.eventId),
    ownerIdx: index('group_plans_owner_user_id_idx').on(table.ownerUserId),
    createdAtIdx: index('group_plans_created_at_idx').on(table.createdAt)
  })
);

export const groupPlanMembers = pgTable(
  'group_plan_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupPlanId: uuid('group_plan_id').notNull().references(() => groupPlans.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
    joinedAt: timestamp('joined_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull().defaultNow(),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    groupPlanIdx: index('group_plan_members_group_plan_id_idx').on(table.groupPlanId),
    userIdx: index('group_plan_members_user_id_idx').on(table.userId),
    uniqueMember: uniqueIndex('group_plan_members_plan_user_unique').on(table.groupPlanId, table.userId).where(sql`deleted_at is null`)
  })
);

export const groupPlanInvites = pgTable(
  'group_plan_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupPlanId: uuid('group_plan_id').notNull().references(() => groupPlans.id, {
      onDelete: 'restrict'
    }),
    invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    inviteeUserId: uuid('invitee_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
    ...timestampColumns
  },
  (table) => ({
    groupPlanIdx: index('group_plan_invites_group_plan_id_idx').on(table.groupPlanId),
    inviteeIdx: index('group_plan_invites_invitee_user_id_idx').on(table.inviteeUserId)
  })
);

export const groupPlanActivity = pgTable(
  'group_plan_activity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupPlanId: uuid('group_plan_id').notNull().references(() => groupPlans.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    activityType: text('activity_type').notNull(),
    details: jsonb('details').notNull().default('{}'),
    ...timestampColumns
  },
  (table) => ({
    groupPlanIdx: index('group_plan_activity_group_plan_id_idx').on(table.groupPlanId)
  })
);
