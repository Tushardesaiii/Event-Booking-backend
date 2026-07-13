import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { assets } from './assets.js';
import { users } from './users.js';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    logoAssetId: uuid('logo_asset_id').references(() => assets.id, {
      onDelete: 'set null'
    }),
    coverAssetId: uuid('cover_asset_id').references(() => assets.id, {
      onDelete: 'set null'
    }),
    website: text('website'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    isVerified: boolean('is_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    // Organizer onboarding approval — gates dashboard access. A tenant is the
    // workspace an organizer signs into, so the "become an organizer" approval
    // state lives here. New registrations start 'pending'; a superadmin moves
    // them to 'approved' or 'rejected'. `rejectionReason` is shown to the
    // organizer on the rejected screen. (Existing tenants were backfilled to
    // 'approved' by the alter-tenants-approval migration.)
    approvalStatus: text('approval_status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    rejectionReason: text('rejection_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    slugUnique: uniqueIndex('tenants_slug_unique').on(table.slug),
    nameIdx: index('tenants_name_idx').on(table.name),
    createdByUserIdIdx: index('tenants_created_by_user_id_idx').on(table.createdByUserId),
    isActiveIdx: index('tenants_is_active_idx').on(table.isActive),
    approvalStatusIdx: index('tenants_approval_status_idx').on(table.approvalStatus),
    createdAtIdx: index('tenants_created_at_idx').on(table.createdAt)
  })
);
