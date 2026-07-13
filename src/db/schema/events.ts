import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import {
  eventStatusEnum,
  eventVisibilityEnum
} from './enums.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { assets } from './assets.js';
import { categories } from './categories.js';
import { eventSeries } from './event-series.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { venues } from './venues.js';

import { organizers } from '../../modules/organizer-profiles/schema.js';

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    venueId: uuid('venue_id').references(() => venues.id, {
      onDelete: 'set null'
    }),
    eventSeriesId: uuid('event_series_id').references(() => eventSeries.id, {
      onDelete: 'set null'
    }),
    organizerId: uuid('organizer_id').references(() => organizers.id, {
      onDelete: 'set null'
    }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null'
    }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    startDateTime: timestamp('start_date_time', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    endDateTime: timestamp('end_date_time', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    timezone: text('timezone').notNull(),
    bannerAssetId: uuid('banner_asset_id').references(() => assets.id, {
      onDelete: 'set null'
    }),
    thumbnailAssetId: uuid('thumbnail_asset_id').references(() => assets.id, {
      onDelete: 'set null'
    }),
    maxCapacity: integer('max_capacity'),
    status: eventStatusEnum('status').notNull().default('draft'),
    visibility: eventVisibilityEnum('visibility').notNull().default('public'),
    publishedAt: timestamp('published_at', {
      withTimezone: true,
      mode: 'date'
    }),
    isFeatured: boolean('is_featured').notNull().default(false),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    termsAndConditions: text('terms_and_conditions'),
    cancellationPolicy: text('cancellation_policy'),
    // Organizer-authored FAQ shown on the app event page: [{question, answer}].
    faq: jsonb('faq').$type<{ question: string; answer: string }[]>(),
    // Reason supplied by a platform admin when an event is rejected in review.
    rejectionReason: text('rejection_reason'),
    emergencyContact: text('emergency_contact'),
    medicalDesk: text('medical_desk'),
    securityDesk: text('security_desk'),
    womenSafetyDesk: text('women_safety_desk'),
    lostAndFoundDesk: text('lost_and_found_desk'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'restrict'
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('events_tenant_id_idx').on(table.tenantId),
    tenantCategoryIdx: index('events_tenant_id_category_id_idx').on(table.tenantId, table.categoryId),
    tenantStartDateTimeIdx: index('events_tenant_id_start_date_time_idx').on(table.tenantId, table.startDateTime),
    venueIdx: index('events_venue_id_idx').on(table.venueId),
    eventSeriesIdx: index('events_event_series_id_idx').on(table.eventSeriesId),
    categoryIdx: index('events_category_id_idx').on(table.categoryId),
    statusIdx: index('events_status_idx').on(table.status),
    visibilityIdx: index('events_visibility_idx').on(table.visibility),
    startDateTimeIdx: index('events_start_date_time_idx').on(table.startDateTime),
    publishedAtIdx: index('events_published_at_idx').on(table.publishedAt),
    featuredIdx: index('events_is_featured_idx').on(table.isFeatured),
    slugIdx: index('events_slug_idx').on(table.slug),
    createdAtIdx: index('events_created_at_idx').on(table.createdAt),
    slugUnique: uniqueIndex('events_slug_unique').on(table.slug)
  })
);
