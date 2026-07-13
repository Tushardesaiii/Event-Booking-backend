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

import { timestampColumns } from './helpers.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    phoneNumber: text('phone_number'),
    // Consumer email — collected during the mobile onboarding (phone-OTP users
    // have no auth-account email). Nullable so organizer/staff signup is
    // unaffected.
    email: text('email'),
    phoneVerifiedAt: timestamp('phone_verified_at', {
      withTimezone: true,
      mode: 'date'
    }),
    emailVerifiedAt: timestamp('email_verified_at', {
      withTimezone: true,
      mode: 'date'
    }),
    marketingOptIn: boolean('marketing_opt_in'),
    avatarAssetId: uuid('avatar_asset_id'),
    // Consumer avatar: a preset URL, an uploaded CDN URL, or a (dev) data-URI.
    // Kept separate from avatarAssetId so the consumer app can set it directly.
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    // Consumer onboarding fields (collected by the mobile app). Nullable so
    // they don't affect the organizer/staff signup flow.
    city: text('city'),
    gender: text('gender'),
    dateOfBirth: text('date_of_birth'),
    interests: jsonb('interests').$type<string[]>(),
    trustedContacts: jsonb('trusted_contacts').$type<
      Array<{ name: string; relation?: string; phone: string }>
    >(),
    // Platform/super admin — runs the Revelis console across all tenants.
    // Distinct from tenant-scoped RBAC roles (owner/admin/…).
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    ...timestampColumns
  },
  (table) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(table.username),
    phoneNumberUnique: uniqueIndex('users_phone_number_unique').on(table.phoneNumber),
    avatarAssetIdx: index('users_avatar_asset_id_idx').on(table.avatarAssetId),
    createdAtIdx: index('users_created_at_idx').on(table.createdAt)
  })
);
