import {
  index,
  pgTable,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { organizers } from '../organizer-profiles/schema.js';

export const userFollows = pgTable(
  'user_follows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    followerUserId: uuid('follower_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    followingUserId: uuid('following_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('user_follows_tenant_id_idx').on(table.tenantId),
    followerIdx: index('user_follows_follower_id_idx').on(table.followerUserId),
    followingIdx: index('user_follows_following_id_idx').on(table.followingUserId),
    uniqueFollow: uniqueIndex('user_follows_tenant_follower_following_unique').on(table.tenantId, table.followerUserId, table.followingUserId)
  })
);

export const organizerFollows = pgTable(
  'organizer_follows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('organizer_follows_tenant_id_idx').on(table.tenantId),
    userIdx: index('organizer_follows_user_id_idx').on(table.userId),
    organizerIdx: index('organizer_follows_organizer_id_idx').on(table.organizerId),
    uniqueFollow: uniqueIndex('organizer_follows_tenant_user_org_unique').on(table.tenantId, table.userId, table.organizerId)
  })
);

export const artistFollows = pgTable(
  'artist_follows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    artistId: uuid('artist_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }), // Artists are mapped to user accounts representing their public artist profile
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('artist_follows_tenant_id_idx').on(table.tenantId),
    userIdx: index('artist_follows_user_id_idx').on(table.userId),
    artistIdx: index('artist_follows_artist_id_idx').on(table.artistId),
    uniqueFollow: uniqueIndex('artist_follows_tenant_user_artist_unique').on(table.tenantId, table.userId, table.artistId)
  })
);
