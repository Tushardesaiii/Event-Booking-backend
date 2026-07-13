import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenantMemberRoleEnum } from './enums.js';
import { timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    role: tenantMemberRoleEnum('role').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    joinedAt: timestamp('joined_at', {
      withTimezone: true,
      mode: 'date'
    })
      .notNull()
      .defaultNow(),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('tenant_members_tenant_id_idx').on(table.tenantId),
    userIdx: index('tenant_members_user_id_idx').on(table.userId),
    roleIdx: index('tenant_members_role_idx').on(table.role),
    createdAtIdx: index('tenant_members_created_at_idx').on(table.createdAt),
    membershipUnique: uniqueIndex('tenant_members_tenant_user_unique').on(
      table.tenantId,
      table.userId
    )
  })
);
