import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { events } from '../../db/schema/events.js';
import { users } from '../../db/schema/users.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';

export const groupBookings = pgTable(
  'group_bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id').notNull().references(() => bookingOrders.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'), // 'draft' | 'active' | 'completed' | 'cancelled' | 'expired'
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    collectedAmount: numeric('collected_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn,
    version: integer('version').notNull().default(1)
  },
  (table) => ({
    tenantIdx: index('group_bookings_tenant_id_idx').on(table.tenantId),
    eventIdx: index('group_bookings_event_id_idx').on(table.eventId),
    bookingOrderIdx: index('group_bookings_booking_order_id_idx').on(table.bookingOrderId),
    createdByIdx: index('group_bookings_created_by_user_id_idx').on(table.createdByUserId),
    statusIdx: index('group_bookings_status_idx').on(table.status)
  })
);

export const groupBookingMembers = pgTable(
  'group_booking_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupBookingId: uuid('group_booking_id').notNull().references(() => groupBookings.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull().default('member'), // 'owner' | 'member'
    inviteStatus: text('invite_status').notNull().default('invited'), // 'invited' | 'accepted' | 'declined'
    contributionAmount: numeric('contribution_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn,
    version: integer('version').notNull().default(1)
  },
  (table) => ({
    groupBookingIdx: index('group_booking_members_group_booking_id_idx').on(table.groupBookingId),
    userIdx: index('group_booking_members_user_id_idx').on(table.userId),
    roleIdx: index('group_booking_members_role_idx').on(table.role),
    inviteStatusIdx: index('group_booking_members_invite_status_idx').on(table.inviteStatus)
  })
);

export const groupBookingActivity = pgTable(
  'group_booking_activity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupBookingId: uuid('group_booking_id').notNull().references(() => groupBookings.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // 'created' | 'member_invited' | 'member_joined' | 'member_declined' | 'share_updated' | 'booking_completed' | 'booking_expired' | 'member_removed' | 'booking_cancelled'
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    groupBookingIdx: index('group_booking_activity_group_booking_id_idx').on(table.groupBookingId)
  })
);
