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
import { events } from '../../db/schema/events.js';

export const organizers = pgTable(
  'organizers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(), // maps to display name or fallback name
    displayName: text('display_name'),
    username: text('username'),
    slug: text('slug').notNull(),
    description: text('description'),
    logoAssetId: uuid('logo_asset_id'),
    bannerAssetId: uuid('banner_asset_id'),
    logo: text('logo'),
    coverImage: text('cover_image'),
    bio: text('bio'),
    website: text('website'),
    instagram: text('instagram'),
    facebook: text('facebook'),
    twitterX: text('twitter_x'),
    youtube: text('youtube'),
    verificationStatus: text('verification_status').default('pending').notNull(),
    supportEmail: text('support_email'),
    supportPhone: text('support_phone'),
    emergencyHelplineNumber: text('emergency_helpline_number'),
    emergencyWhatsappNumber: text('emergency_whatsapp_number'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    version: integer('version').default(0).notNull(),
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
    tenantIdx: index('organizers_tenant_id_idx').on(table.tenantId),
    slugUnique: uniqueIndex('organizers_slug_unique').on(table.slug),
    createdAtIdx: index('organizers_created_at_idx').on(table.createdAt)
  })
);

export const organizerSocialLinks = pgTable(
  'organizer_social_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    platform: text('platform').notNull(),
    url: text('url').notNull(),
    ...timestampColumns
  },
  (table) => ({
    organizerIdx: index('organizer_social_links_organizer_id_idx').on(table.organizerId)
  })
);

export const organizerReviews = pgTable(
  'organizer_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    reviewerUserId: uuid('reviewer_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    title: text('title'),
    reviewText: text('review_text'),
    visitEventId: uuid('visit_event_id').references(() => events.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    organizerIdx: index('organizer_reviews_organizer_id_idx').on(table.organizerId),
    reviewerIdx: index('organizer_reviews_reviewer_user_id_idx').on(table.reviewerUserId)
  })
);

export const organizerLikes = pgTable(
  'organizer_likes',
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
    tenantIdx: index('organizer_likes_tenant_id_idx').on(table.tenantId),
    userIdx: index('organizer_likes_user_id_idx').on(table.userId),
    organizerIdx: index('organizer_likes_organizer_id_idx').on(table.organizerId),
    uniqueLike: uniqueIndex('organizer_likes_tenant_user_org_unique').on(table.tenantId, table.userId, table.organizerId)
  })
);

export const organizerSafetyProfiles = pgTable(
  'organizer_safety_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    emergencyHelplineNumber: text('emergency_helpline_number'),
    emergencyWhatsappNumber: text('emergency_whatsapp_number'),
    medicalHelpDeskInfo: text('medical_help_desk_info'),
    lostAndFoundDeskInfo: text('lost_and_found_desk_info'),
    womenSafetyDeskInfo: text('women_safety_desk_info'),
    securityDeskInfo: text('security_desk_info'),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('organizer_safety_profiles_tenant_id_idx').on(table.tenantId),
    organizerIdx: index('organizer_safety_profiles_organizer_id_idx').on(table.organizerId)
  })
);

export const organizerVerifications = pgTable(
  'organizer_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    status: text('status').notNull().default('pending'), // 'pending', 'verified', 'rejected'
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    reason: text('reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('organizer_verifications_tenant_id_idx').on(table.tenantId),
    organizerIdx: index('organizer_verifications_organizer_id_idx').on(table.organizerId)
  })
);

export const sosAlerts = pgTable(
  'sos_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'restrict'
    }),
    eventId: uuid('event_id').references(() => events.id, {
      onDelete: 'restrict'
    }),
    organizerId: uuid('organizer_id').references(() => organizers.id, {
      onDelete: 'restrict'
    }),
    locationName: text('location_name'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    issueCategory: text('issue_category').notNull(), // medical, harassment, security, lost, crowd, emergency, other
    severity: text('severity').notNull(), // low, medium, high, critical
    // Console dispatch lifecycle: active → acknowledged → resolved (cancelled is terminal).
    status: text('status').notNull().default('active'),
    details: text('details'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('sos_alerts_tenant_id_idx').on(table.tenantId),
    eventIdx: index('sos_alerts_event_id_idx').on(table.eventId),
    organizerIdx: index('sos_alerts_organizer_id_idx').on(table.organizerId),
    statusIdx: index('sos_alerts_status_idx').on(table.status)
  })
);
