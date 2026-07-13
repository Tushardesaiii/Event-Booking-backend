import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { assets } from './assets.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    landmark: text('landmark'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    country: text('country').notNull(),
    postalCode: text('postal_code'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    capacity: integer('capacity'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    website: text('website'),
    coverAssetId: uuid('cover_asset_id').references(() => assets.id, {
      onDelete: 'set null'
    }),
    isActive: boolean('is_active').notNull().default(true),
    isVerified: boolean('is_verified').notNull().default(false),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, {
      onDelete: 'restrict'
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('venues_tenant_id_idx').on(table.tenantId),
    tenantNameIdx: index('venues_tenant_name_idx').on(table.tenantId, table.name),
    tenantCityIdx: index('venues_tenant_city_idx').on(table.tenantId, table.city),
    tenantStatusIdx: index('venues_tenant_is_active_idx').on(table.tenantId, table.isActive),
    tenantVerifiedIdx: index('venues_tenant_is_verified_idx').on(table.tenantId, table.isVerified),
    tenantCreatedAtIdx: index('venues_tenant_created_at_idx').on(table.tenantId, table.createdAt),
    slugIdx: index('venues_slug_idx').on(table.slug),
    cityIdx: index('venues_city_idx').on(table.city),
    createdAtIdx: index('venues_created_at_idx').on(table.createdAt),
    slugUnique: uniqueIndex('venues_slug_unique').on(table.slug)
  })
);
