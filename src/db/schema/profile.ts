// src/db/schema/profile.ts
import { pgTable, serial, uuid, varchar, text, timestamp, boolean, integer, numeric, jsonb, pgEnum, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { events } from './events.js';

export const profileVisibilityEnum = pgEnum('profile_visibility', ['public', 'followers_only', 'private']);

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  username: varchar('username', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  coverImageUrl: text('cover_url'),
  bio: text('bio'),
  city: varchar('city', { length: 255 }),
  state: varchar('state', { length: 255 }),
  country: varchar('country', { length: 255 }),
  gender: varchar('gender', { length: 50 }),
  dateOfBirth: timestamp('date_of_birth', { withTimezone: true }),
  phoneVisibility: boolean('phone_visibility').notNull().default(false),
  emailVisibility: boolean('email_visibility').notNull().default(false),
  profileVisibility: profileVisibilityEnum('profile_visibility').notNull().default('public'),
  version: integer('version').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    usernameTenantUnique: uniqueIndex('profiles_username_tenant_unique_idx').on(table.tenantId, table.username),
    tenantIdx: index('profiles_tenant_idx').on(table.tenantId),
    deletedAtIdx: index('profiles_deleted_at_idx').on(table.deletedAt),
    cityIdx: index('profiles_city_idx').on(table.city)
  };
});

export const profilePreferences = pgTable('profile_preferences', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  preferredCities: jsonb('preferred_cities').$type<string[]>().notNull().default([]),
  preferredCategories: jsonb('preferred_categories').$type<string[]>().notNull().default([]),
  preferredArtists: jsonb('preferred_artists').$type<string[]>().notNull().default([]),
  preferredPriceRangeMin: numeric('preferred_price_range_min', { precision: 14, scale: 2 }),
  preferredPriceRangeMax: numeric('preferred_price_range_max', { precision: 14, scale: 2 }),
  preferredEventTypes: jsonb('preferred_event_types').$type<string[]>().notNull().default([]),
  preferredLanguages: jsonb('preferred_languages').$type<string[]>().notNull().default([]),
  discoveryRadiusKm: integer('discovery_radius_km').notNull().default(50),
  notificationPreferences: jsonb('notification_preferences').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const trustedContacts = pgTable('trusted_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 100 }).notNull(),
  relationship: varchar('relationship', { length: 100 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileIdx: index('trusted_contacts_profile_idx').on(table.profileId),
    tenantIdx: index('trusted_contacts_tenant_idx').on(table.tenantId)
  };
});

export const profileInterests = pgTable('profile_interests', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  interest: varchar('interest', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileInterestUnique: uniqueIndex('profile_interests_unique_idx').on(table.profileId, table.interest),
    tenantIdx: index('profile_interests_tenant_idx').on(table.tenantId)
  };
});

export const profileSocialLinks = pgTable('profile_social_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  platform: varchar('platform', { length: 50 }).notNull(), // Instagram, LinkedIn, Twitter, Website
  url: text('url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileIdx: index('profile_social_links_profile_idx').on(table.profileId),
    tenantIdx: index('profile_social_links_tenant_idx').on(table.tenantId)
  };
});

export const profileFollowers = pgTable('profile_followers', {
  followerProfileId: uuid('follower_profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  followingProfileId: uuid('following_profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.followerProfileId, table.followingProfileId] }),
    tenantIdx: index('profile_followers_tenant_idx').on(table.tenantId)
  };
});

export const profileBadges = pgTable('profile_badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  badgeType: varchar('badge_type', { length: 100 }).notNull(), // Early Adopter, Garba Lover, etc.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileBadgeUnique: uniqueIndex('profile_badges_unique_idx').on(table.profileId, table.badgeType),
    tenantIdx: index('profile_badges_tenant_idx').on(table.tenantId)
  };
});

export const profileAchievements = pgTable('profile_achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  achievementType: varchar('achievement_type', { length: 100 }).notNull(),
  currentValue: integer('current_value').notNull().default(0),
  targetValue: integer('target_value').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileTypeUnique: uniqueIndex('profile_achievements_unique_idx').on(table.profileId, table.achievementType),
    tenantIdx: index('profile_achievements_tenant_idx').on(table.tenantId)
  };
});

export const profileReviews = pgTable('profile_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  targetType: varchar('target_type', { length: 50 }).notNull(), // event, artist, organizer
  targetId: uuid('target_id').notNull(),
  rating: integer('rating').notNull(), // 1-5
  reviewText: text('review_text'),
  moderated: boolean('moderated').notNull().default(false),
  moderationReason: text('moderation_reason'),
  version: integer('version').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileReviewUnique: uniqueIndex('profile_reviews_unique_idx').on(table.profileId, table.targetType, table.targetId),
    tenantIdx: index('profile_reviews_tenant_idx').on(table.tenantId)
  };
});

export const profileSavedEvents = pgTable('profile_saved_events', {
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.profileId, table.eventId] }),
    tenantIdx: index('profile_saved_events_tenant_idx').on(table.tenantId)
  };
});

export const profileActivity = pgTable('profile_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  activityType: varchar('activity_type', { length: 100 }).notNull(), // Joined Event, Followed User, etc.
  targetId: uuid('target_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    profileIdx: index('profile_activity_profile_idx').on(table.profileId),
    tenantIdx: index('profile_activity_tenant_idx').on(table.tenantId),
    createdAtIdx: index('profile_activity_created_at_idx').on(table.createdAt)
  };
});

export const profileVerificationRequests = pgTable('profile_verification_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  verificationType: varchar('verification_type', { length: 100 }).notNull(), // Identity Verified, etc.
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, approved, rejected
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' })
}, (table) => {
  return {
    profileIdx: index('profile_verification_requests_profile_idx').on(table.profileId),
    tenantIdx: index('profile_verification_requests_tenant_idx').on(table.tenantId)
  };
});

export const buddyPreferences = pgTable('buddy_preferences', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  enabled: boolean('enabled').notNull().default(false),
  bio: text('bio'),
  ageRangeMin: integer('age_range_min').notNull().default(18),
  ageRangeMax: integer('age_range_max').notNull().default(99),
  genderPreference: varchar('gender_preference', { length: 50 }).notNull().default('any'),
  preferredCategories: jsonb('preferred_categories').$type<string[]>().notNull().default([]),
  preferredCities: jsonb('preferred_cities').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// Relations
export const profilesRelations = relations(profiles, ({ one, many }) => ({
  preferences: one(profilePreferences, {
    fields: [profiles.id],
    references: [profilePreferences.profileId]
  }),
  buddyPreferences: one(buddyPreferences, {
    fields: [profiles.id],
    references: [buddyPreferences.profileId]
  }),
  interests: many(profileInterests),
  socialLinks: many(profileSocialLinks),
  followers: many(profileFollowers, { relationName: 'followers' }),
  following: many(profileFollowers, { relationName: 'following' }),
  badges: many(profileBadges),
  achievements: many(profileAchievements),
  reviews: many(profileReviews),
  savedEvents: many(profileSavedEvents),
  activities: many(profileActivity),
  verifications: many(profileVerificationRequests),
  trustedContacts: many(trustedContacts)
}));
